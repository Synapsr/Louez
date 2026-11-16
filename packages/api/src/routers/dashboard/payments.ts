import { z } from "zod";

import { ORPCError } from "@orpc/server";

import type { ConnectAccountStatus } from "../../adapters/stripe-connect";
import {
  deletePaymentInput,
  deletePaymentOutput,
  recordDepositReturnInput,
  recordDepositReturnOutput,
  recordPaymentInput,
  recordPaymentOutput,
  recordRefundInput,
  recordRefundOutput,
} from "../../contracts/payment-records";
import {
  openStripeDashboardInput,
  openStripeDashboardOutput,
  startStripeOnboardingInput,
  startStripeOnboardingOutput,
  syncStripeStatusInput,
  syncStripeStatusOutput,
  type StripeStatus,
} from "../../contracts/stripe-connect";
import {
  STRIPE_MAY_STILL_REFUSE,
  approvalAsked,
  restApprovalAsked,
} from "../../platform/approval-help";
import { CONFIRMATION_HEADER, checkConfirmation } from "../../platform/confirmation";
import {
  getRefundInput,
  refundPaymentInput,
  refundPaymentOutput,
  stripeRefundErrors,
} from "../../contracts/stripe-refunds";
import {
  getOnlineRefund,
  recoverOnlineRefund,
  refundOnlinePayment,
} from "../../services/stripe-refunds";
import { apiError } from "../../platform/errors";
import { dashboardPageLinks, reservationLinks } from "../../platform/links";
import type { ProcedureScope } from "../../platform/permissions";
import { storeProcedure } from "../../platform/procedures";
import { dashboardProcedure } from "../../procedures";
import { bookingModeOf } from "../../services/launch";
import {
  deletePayment,
  recordDepositReturn,
  recordPayment,
  recordPaymentRefund,
  type PaymentWriteCaller,
} from "../../services/payment-records";
import {
  requireConnectClient,
  stripeConnectErrors,
  syncConnectStatus,
} from "../../services/stripe-connect";
import { completeActiveHandoff, upgradeStoredLink } from "../../services/handoffs";
import { toORPCError } from "../../utils/orpc-error";
import { HANDOFF_HELP, REST_HANDOFF_HELP, startHandoff } from "./handoffs";
import { mayRead, type ProductContext } from "./product-context";

const payoutCursorSchema = z
  .string()
  .max(255)
  .regex(/^po_[A-Za-z0-9]+$/);

const payoutSchema = z.object({
  id: z.string(),
  amount: z.number(),
  currency: z.string(),
  status: z.enum(["paid", "pending", "in_transit", "failed", "canceled", "unknown"]),
  createdAt: z.number(),
  arrivalAt: z.number(),
  destinationLast4: z.string().nullable(),
});

const payouts = dashboardProcedure
  .input(z.object({ cursor: payoutCursorSchema.optional() }))
  .output(
    z.object({
      items: z.array(payoutSchema),
      nextCursor: z.string().nullable(),
    }),
  )
  .handler(async ({ context, input }) => {
    try {
      const fn = context.getConnectedAccountPayoutPage;
      if (!fn) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "getConnectedAccountPayoutPage not provided in context",
        });
      }

      const { stripeAccountId, stripeChargesEnabled } = context.store;
      if (!stripeAccountId || !stripeChargesEnabled) {
        throw new ORPCError("FORBIDDEN", {
          message: "errors.noStripeAccount",
        });
      }

      return await fn({ accountId: stripeAccountId, cursor: input.cursor });
    } catch (error) {
      throw toORPCError(error);
    }
  });

// --- Stripe Connect ----------------------------------------------------------

/** The dashboard lets only members who manage settings connect Stripe. */
const STRIPE_WRITE: ProcedureScope = {
  domain: "settings",
  level: "write",
  role: "manage_settings",
};

function stripeStatusOf(
  context: ProductContext,
  status: ConnectAccountStatus,
  accountId: string,
): StripeStatus {
  const mode = bookingModeOf({
    settings: context.store.settings,
    stripeAccountId: accountId,
    stripeChargesEnabled: status.chargesEnabled,
  });
  return {
    connected: true,
    chargesEnabled: status.chargesEnabled,
    payoutsEnabled: status.payoutsEnabled,
    detailsSubmitted: status.detailsSubmitted,
    requirements: {
      currentlyDue: status.requirements.currentlyDue,
      pastDue: status.requirements.pastDue,
      eventuallyDue: status.requirements.eventuallyDue,
    },
    bookingMode: { intended: mode.intended, effective: mode.effective },
    links: dashboardPageLinks(context.ports.urls, context.store, "/dashboard/settings/payments"),
  };
}

const startStripeOnboarding = storeProcedure
  .meta({
    capability: "payments.startStripeOnboarding",
    scope: STRIPE_WRITE,
    // Its answers stored before views carried `decision` replay with it.
    upgradeReplay: upgradeStoredLink,
    mcp: {
      name: "payments_start_stripe_onboarding",
      title: "Connect Stripe",
      description: `Connect the store to Stripe so it takes online payments, or finish a connection left midway. Stripe asks the user for their identity and bank details on its own pages, which only they can fill in. ${HANDOFF_HELP} Once it is completed, payments_sync_stripe_status reads where Stripe stands: it may still review the details before charges are enabled, and the storefront takes requests rather than payments until then. Refused when the store already takes payments (STRIPE_ALREADY_CONNECTED) or when this Louez has no Stripe (STRIPE_NOT_CONFIGURED).`,
      bundle: "settings",
      effect: "overwrite",
      reach: "provider",
    },
  })
  .route({
    method: "POST",
    path: "/payments/stripe/onboarding",
    description: `Starts connecting the store to Stripe so it takes online payments, or finishes a setup left midway. Stripe asks the person for their identity and bank details on its own pages, which only they can fill in. ${REST_HANDOFF_HELP} When a Stripe account must be created for the store, the step fails with \`failure.code\` \`store_email_required\` if neither the store's contact e-mail (\`PATCH /settings/store-info\` sets it) nor its owner's is usable. Once it is completed, \`POST /payments/stripe/sync\` reads where Stripe stands: Stripe may still review the details before charges are enabled, and the online store takes requests rather than payments until then. Refused with \`STRIPE_ALREADY_CONNECTED\` when the store already takes payments, and \`STRIPE_NOT_CONFIGURED\` when this Louez has no Stripe.`,
  })
  .input(startStripeOnboardingInput)
  .output(startStripeOnboardingOutput)
  .handler(({ context }) => {
    requireConnectClient(context.ports);
    if (context.store.stripeAccountId && context.store.stripeChargesEnabled) {
      throw stripeConnectErrors.alreadyConnected();
    }
    return startHandoff(context, "stripe_connect_onboarding");
  });

const openStripeDashboard = storeProcedure
  .meta({
    capability: "payments.getStripeDashboardUrl",
    scope: STRIPE_WRITE,
    // Its answers stored before views carried `decision` replay with it.
    upgradeReplay: upgradeStoredLink,
    mcp: {
      name: "payments_open_stripe_dashboard",
      title: "Open Stripe Dashboard",
      description: `Send the user to the store's own Stripe dashboard (payouts, disputes, bank details), where they sign in to Stripe. ${HANDOFF_HELP} The handoff completes once the user is on their way to Stripe. Refused without a Stripe account (NO_STRIPE_ACCOUNT).`,
      bundle: "settings",
      effect: "overwrite",
      reach: "provider",
    },
  })
  .route({
    method: "POST",
    path: "/payments/stripe/dashboard",
    description: `Starts a visit to the store's own Stripe dashboard (payouts, disputes, bank details), where the person signs in to Stripe. ${REST_HANDOFF_HELP} The step completes once the person is on their way to Stripe. Refused with \`NO_STRIPE_ACCOUNT\` when the store has no Stripe account, and \`STRIPE_NOT_CONFIGURED\` when this Louez has no Stripe.`,
  })
  .input(openStripeDashboardInput)
  .output(openStripeDashboardOutput)
  .handler(({ context }) => {
    requireConnectClient(context.ports);
    if (!context.store.stripeAccountId) throw stripeConnectErrors.noAccount();
    return startHandoff(context, "stripe_dashboard");
  });

const syncStripeStatus = storeProcedure
  .meta({
    capability: "payments.syncStripeStatus",
    scope: STRIPE_WRITE,
    mcp: {
      name: "payments_sync_stripe_status",
      title: "Refresh Stripe Status",
      description:
        "Read the store's Stripe account from Stripe now and save it in Louez: whether it takes charges and payouts, whether the user submitted their details, what Stripe still asks for, and the booking mode the storefront applies (payment mode takes requests until charges are enabled). Its `links` hold the payment settings page, the URL to give the user. Refused without a Stripe account (NO_STRIPE_ACCOUNT).",
      bundle: "settings",
      effect: "overwrite",
      reach: "provider",
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "POST",
    path: "/payments/stripe/sync",
    description:
      "Reads the store's Stripe account from Stripe now and saves it in Louez. Returns whether it takes charges (`chargesEnabled`) and payouts (`payoutsEnabled`), whether its details were submitted (`detailsSubmitted`), what Stripe still asks for (`requirements`, by Stripe's own field names), the booking mode the store chose and the one its online store applies (`bookingMode`: payment mode takes requests until charges are enabled), and `links.dashboard`, the payment settings page in the Louez dashboard. Once the details are submitted, it also completes the step `POST /payments/stripe/onboarding` started. Refused with `NO_STRIPE_ACCOUNT` when the store has no Stripe account, `STRIPE_NOT_CONFIGURED` when this Louez has no Stripe, and `STRIPE_UNAVAILABLE` (retryable) when Stripe does not answer as expected.",
  })
  .input(syncStripeStatusInput)
  .output(syncStripeStatusOutput)
  .handler(async ({ context }) => {
    const client = requireConnectClient(context.ports);
    const accountId = context.store.stripeAccountId;
    const status = await syncConnectStatus({ client, storeId: context.actor.storeId, accountId });
    if (status.detailsSubmitted) {
      await completeActiveHandoff(context.actor.storeId, "stripe_connect_onboarding");
    }
    return stripeStatusOf(context, status, accountId ?? "");
  });

// --- Payments recorded by hand -------------------------------------------------

const PAYMENTS_WRITE: ProcedureScope = { domain: "payments", level: "write" };

/**
 * What the payment writes take from their context: the app's writer they
 * use (`paymentRecords`, or `paymentRefunds` for a refund), and the
 * confirmation asked in the write's transaction. All four record, give back
 * or erase money, the deletion included: they declare `money`, so every key
 * and token needs a person's approval whatever its setting, and a session is
 * never asked. The preview's details open with its kind, as the hand-written
 * tools showed them. The presentation's identity facts, with
 * `PAYMENTS_WRITE`, are what a person's approval is about.
 */
function paymentRecordsCaller<Port>(
  context: ProductContext,
  path: readonly string[],
  input: unknown,
  sensitive: "money" | "destructive",
  port: Port | undefined,
): PaymentWriteCaller<Port> {
  if (!port) {
    throw apiError("INTERNAL_SERVER_ERROR", "NOT_AVAILABLE_TO_THIS_AGENT", {
      message: "This Louez cannot record payments.",
    });
  }
  return {
    storeId: context.actor.storeId,
    storeSettings: context.store.settings ?? null,
    port,
    confirm: (tx, { preview, state, presentation }) =>
      checkConfirmation({
        consequences: ["money"],
        executor: tx,
        actor: context.actor,
        headers: context.headers,
        procedure: path.join("."),
        input,
        state,
        preview: { summary: preview.summary, details: { sensitive, ...preview.details } },
        display: presentation?.display,
        approval: presentation
          ? { facts: presentation.facts, scope: PAYMENTS_WRITE, urls: context.ports.urls }
          : undefined,
      }),
  };
}

/** The reservation's dashboard page, for a caller who may read reservations. */
function reservationLinksFor(
  context: Pick<ProductContext, "actor" | "store" | "ports">,
  reservationId: string,
) {
  return mayRead(context, "reservations")
    ? { links: reservationLinks(context.ports.urls, context.store, { id: reservationId }) }
    : {};
}

/** The REST reference's own texts (`.route({ description })`), for a developer. */
const REST_LINKS_NOTE =
  "Returns the reservation's number and, with a key that can read reservations, its `links.dashboard`.";

const LINKS_NOTE =
  "Returns the reservation's number and, when the connection may read reservations, its `links`: its dashboard page, to give the user.";

const record = storeProcedure
  .meta({
    capability: "reservations.recordPayment",
    scope: PAYMENTS_WRITE,
    sensitive: "money",
    personApproval: true,
    mcp: {
      name: "record_payment",
      title: "Record Payment",
      description: `Record a payment the store received by hand on a reservation (cash, card, transfer, check or other), or money it paid back as a negative adjustment: adds it to the reservation's payments. It moves no money. Refused, before anything is asked, for an amount that is zero or not a plain decimal with at most 8 digits before the point and 2 after (such as "150" or "-20.50"), or with more decimals than the reservation's currency (none in yen), a reservation in a three-decimal currency, a negative amount of another type than adjustment, and a cancelled or rejected reservation. ${approvalAsked("a preview of the payment")} ${LINKS_NOTE}`,
      bundle: "daily",
      effect: "additive",
    },
  })
  .route({
    method: "POST",
    path: "/reservations/{reservationId}/payments",
    description: `Records a payment row the store handled itself on a reservation: its \`type\` (\`rental\`, \`deposit\`, \`deposit_return\`, \`damage\` or \`adjustment\`), its amount and how it was paid (cash, card, transfer, check or other). Money the store paid back is a negative \`adjustment\`. It moves no money. A \`deposit_return\` recorded here is not checked against the deposit collected: to record a deposit given back against that balance, use \`POST /reservations/{reservationId}/deposit-returns\`. Refused, before anything is asked, for an amount that is zero, not a plain decimal with at most 8 digits before the point and 2 after, or with more decimals than the reservation's currency, such as decimals in yen (\`PAYMENT_AMOUNT_INVALID\`, whose \`details\` then give the currency and its decimals), a reservation in a three-decimal currency, which Louez's billing does not count (\`PAYMENT_CURRENCY_NOT_SUPPORTED\`), a negative amount of another type than \`adjustment\`, and a cancelled or rejected reservation. ${restApprovalAsked("a preview of the payment")} ${REST_LINKS_NOTE}`,
  })
  .input(recordPaymentInput)
  .output(recordPaymentOutput)
  .handler(async ({ context, input, path }) => {
    const recorded = await recordPayment(
      paymentRecordsCaller(context, path, input, "money", context.ports.paymentRecords),
      input,
    );
    return { ...recorded, ...reservationLinksFor(context, recorded.reservationId) };
  });

const recordDepositReturnProcedure = storeProcedure
  .meta({
    capability: "reservations.returnDeposit",
    scope: PAYMENTS_WRITE,
    sensitive: "money",
    personApproval: true,
    mcp: {
      name: "record_deposit_return",
      title: "Record Deposit Return",
      description: `Record a deposit return the store has already made: adds it to the reservation's payments, as the amount given back and how (cash, card, transfer, check or other). It moves no money: nothing is refunded or released, through Stripe or otherwise. Refused above the deposit collected and not yet returned, for an amount with more decimals than the reservation's currency (none in yen), and for a reservation in a three-decimal currency. ${approvalAsked("a preview showing that balance")} ${LINKS_NOTE}`,
      bundle: "daily",
      effect: "additive",
    },
  })
  .route({
    method: "POST",
    path: "/reservations/{reservationId}/deposit-returns",
    description: `Records a deposit the store has already given back: the amount and how (cash, card, transfer, check or other). It moves no money: nothing is refunded or released, through Stripe or otherwise. Refused with \`DEPOSIT_RETURN_AMOUNT_INVALID\` for an amount that is zero, negative, not a plain decimal with at most 8 digits before the point and 2 after, or with more decimals than the reservation's currency (its \`details\` then give the currency and its decimals), with \`PAYMENT_CURRENCY_NOT_SUPPORTED\` for a reservation in a three-decimal currency, and with \`DEPOSIT_RETURN_EXCEEDS_BALANCE\` above the returnable balance: the reservation's completed \`deposit\` rows minus its completed \`deposit_return\` rows. Stripe deposit holds and captures are not in that balance. The check is this operation's own: a \`deposit_return\` recorded with \`POST /reservations/{reservationId}/payments\` is not checked. ${restApprovalAsked("a preview showing that balance")} ${REST_LINKS_NOTE}`,
  })
  .input(recordDepositReturnInput)
  .output(recordDepositReturnOutput)
  .handler(async ({ context, input, path }) => {
    const recorded = await recordDepositReturn(
      paymentRecordsCaller(context, path, input, "money", context.ports.paymentRecords),
      input,
    );
    return { ...recorded, ...reservationLinksFor(context, recorded.reservationId) };
  });

/**
 * The refusals a refund answers before anything is asked, each with its
 * code: as it is in the tool's text, in backticks in the reference's.
 */
const inBackticks = (name: string) => "`" + name + "`";
const refundRefusals = (code: (name: string) => string) =>
  `a payment the store does not have (${code("PAYMENT_NOT_FOUND")}); an amount that is zero, negative, not a plain decimal with at most 8 digits before the point and 2 after, or with a digit past the minor unit of the payment's currency, such as decimals in yen (${code("REFUND_AMOUNT_INVALID")}); a payment in a three-decimal currency, which Louez's billing does not count (${code("REFUND_CURRENCY_NOT_SUPPORTED")}); a payment that is itself a refund (${code("REFUND_OF_REFUND")}); a deposit, a deposit return or a deposit hold (${code("REFUND_PAYMENT_TYPE_NOT_REFUNDABLE")}); a payment not completed (${code("REFUND_PAYMENT_NOT_COMPLETED")}); a payment taken online through Stripe, which is refunded by refunding the payment instead (${code("REFUND_STRIPE_PAYMENT")}); a payment of zero or below (${code("REFUND_PAYMENT_NOT_RECEIVED")}); and an amount above the payment's amount less every completed refund already recorded against it (${code("REFUND_EXCEEDS_REFUNDABLE")}, whose details give the amounts paid, already refunded and refundable, and the currency)`;

const recordRefund = storeProcedure
  .meta({
    capability: "reservations.refundManualPayment",
    scope: PAYMENTS_WRITE,
    sensitive: "money",
    personApproval: true,
    mcp: {
      name: "record_refund",
      title: "Record Refund",
      description: `Record a refund the store already gave by hand (cash, card terminal, transfer, check or other) against one payment of a reservation, taken by hand: a rental, damage, adjustment or kept deposit (deposit_capture) payment, by its id among the payments reservations_get returns. It moves no money: Louez only records it, the payment keeps its amount, and the refund, in the payment's own currency, comes off what the reservation received. Partial refunds may follow one another up to the payment's amount. Refused, before anything is asked, for ${refundRefusals(String)}. ${approvalAsked("a preview of the refund, the payment and what is left to refund")} Returns the refund's id, its currency and its creditNote: issued with its number, pending (owed: Louez issues it, retrying on its own), or not_applicable (the store issues no invoices, or the payment has none). The refund stands whatever its creditNote says. ${LINKS_NOTE}`,
      bundle: "daily",
      effect: "additive",
    },
  })
  .route({
    method: "POST",
    path: "/payments/{paymentId}/refund-records",
    description: `Records a refund the store already gave by hand (cash, card terminal, bank transfer, check or other) against one payment it took by hand: a \`rental\`, \`damage\`, \`adjustment\` or \`deposit_capture\` payment. It moves no money. The refund is its own positive \`completed\` row pointing at the payment, in the payment's own currency; the payment keeps its amount. Partial refunds may follow one another, up to the payment's amount less every completed refund already recorded against it, counted under the reservation's lock. Refused, before anything is asked, for ${refundRefusals(inBackticks)}. ${restApprovalAsked("a preview of the refund, the payment and what is left to refund")} Returns the refund's id (\`refundId\`), its \`currency\` and \`creditNote\`: \`status\` \`issued\` with its \`number\`, \`pending\` (owed: Louez issues it, retrying on its own), or \`not_applicable\` (the store issues no invoices, or the payment refunded has none). The refund stands whatever \`creditNote\` says. ${REST_LINKS_NOTE}`,
  })
  .input(recordRefundInput)
  .output(recordRefundOutput)
  .handler(async ({ context, input, path }) => {
    const refund = await recordPaymentRefund(
      {
        ...paymentRecordsCaller(context, path, input, "money", context.ports.paymentRefunds),
        dispatchEffects: context.ports.dispatchEffects,
      },
      input,
      { source: "api_record_refund" },
    );
    return { ...refund, ...reservationLinksFor(context, refund.reservationId) };
  });

const deletePaymentProcedure = storeProcedure
  .meta({
    capability: "reservations.deletePayment",
    scope: PAYMENTS_WRITE,
    sensitive: "destructive",
    personApproval: true,
    mcp: {
      name: "delete_payment",
      title: "Delete Payment",
      description: `Delete a payment of a reservation: it leaves the reservation's balance and the billing figures. A Stripe payment is refused: its refunds are made in Stripe. ${approvalAsked("a preview of the payment")} ${LINKS_NOTE}`,
      bundle: "daily",
      effect: "delete",
    },
  })
  .route({
    method: "DELETE",
    path: "/payments/{paymentId}",
    description: `Deletes a payment recorded on a reservation: it leaves the reservation's balance and the billing figures. A payment made through Stripe is refused: refund it in Stripe. ${restApprovalAsked("a preview of the payment")} ${REST_LINKS_NOTE}`,
  })
  .input(deletePaymentInput)
  .output(deletePaymentOutput)
  .handler(async ({ context, input, path }) => {
    const deleted = await deletePayment(
      paymentRecordsCaller(context, path, input, "destructive", context.ports.paymentRecords),
      input,
    );
    return { ...deleted, ...reservationLinksFor(context, deleted.reservationId) };
  });

// --- Refunds of payments taken online ----------------------------------------------

const PAYMENTS_READ: ProcedureScope = { domain: "payments", level: "read" };

/** An approval's id as presented: 21 characters of the alphabet ids use. */
const PRESENTED_APPROVAL = /^[A-Za-z0-9_-]{21}$/;

/** The refusals the refund of an online payment answers before anything is asked. */
const onlineRefundRefusals = (code: (name: string) => string) =>
  `a payment the store does not have (${code("PAYMENT_NOT_FOUND")}); one taken by hand, whose refund is recorded instead (${code("REFUND_PAYMENT_TAKEN_BY_HAND")}); an amount that is zero, negative, or has more decimals than the payment's currency (${code("REFUND_AMOUNT_INVALID")}); a three-decimal currency (${code("REFUND_CURRENCY_NOT_SUPPORTED")}); a deposit hold, a refund row or a failed payment (${code("PAYMENT_NOT_REFUNDABLE")}); a payment not settled at Stripe (${code("PAYMENT_NOT_SETTLED")}); an open dispute (${code("PAYMENT_DISPUTED")}); a charge recorded on several reservations (${code("PAYMENT_CHARGE_SHARED")}); no Stripe account (${code("NO_STRIPE_ACCOUNT")}); and an amount above what the charge can still give back, refunds given by hand and refunds in progress counted (${code("REFUND_EXCEEDS_REFUNDABLE")}, whose details give the amounts paid, refunded, being refunded and refundable, and the currency). Stripe not answering the first read refuses with ${code("STRIPE_UNAVAILABLE")}, nothing asked`;

const REFUND_STATES =
  "The answer is the refund's state: `pending` while Stripe has not given the final outcome (`detail` `sending` while Louez may still send it, `awaiting_provider` once only Stripe's own account of the charge settles it, `processing` once Stripe has issued the refund and the bank is processing it: recorded among the reservation's payments, not yet received by the customer, and it may still fail), `succeeded` once Stripe states the refund succeeded, or `failed` with `failure`. It never answers an error once the refund is recorded.";

const refund = storeProcedure
  .meta({
    capability: "reservations.refundStripePayment",
    scope: PAYMENTS_WRITE,
    sensitive: "money",
    personApproval: true,
    // Its answer lost after the commit: the refund it recorded, as it is now.
    recoverUnknown: async (targetId, context) => {
      const port = context.ports.stripeRefunds;
      if (!port) throw stripeRefundErrors.unavailable();
      const recovered = await recoverOnlineRefund(
        { storeId: context.actor.storeId, port },
        targetId,
      );
      return { ...recovered, ...reservationLinksFor(context, recovered.reservationId) };
    },
    mcp: {
      name: "refund_payment",
      title: "Refund Payment",
      description: `Refund all or part of a payment taken online, back to the card or means that paid it, through Stripe: a rental, damage, adjustment or kept deposit (deposit_capture) payment, by its id among the payments reservations_get returns. The amount is in the payment's own currency. Partial refunds may follow one another up to what the payment can still give back. No message is sent to the customer. Refused, before anything is asked, for ${onlineRefundRefusals(String)}. ${approvalAsked("a preview of the refund, the payment and what stays refundable")} ${STRIPE_MAY_STILL_REFUSE} ${REFUND_STATES} A repeat with the same idempotency key answers the same refund, as first answered or, if that answer was lost, as it is now; it may be pending: get_refund reads the refund's outcome, and repeating the refund is not needed for it. ${LINKS_NOTE}`,
      bundle: "daily",
      effect: "additive",
    },
  })
  .route({
    method: "POST",
    path: "/payments/{paymentId}/refunds",
    description: `Refunds all or part of a payment the store took online, back to the means that paid it, through Stripe: a \`rental\`, \`damage\`, \`adjustment\` or \`deposit_capture\` payment. The amount is in the payment's own currency, with at most its decimals. Partial refunds may follow one another. One refund is one durable operation: it reaches Stripe at most once, and its outcome can always be read with \`GET /payments/{paymentId}/refunds/{refundId}\`. No message is sent to the customer. Refused, before anything is asked, for ${onlineRefundRefusals(inBackticks)}. A dashboard session is refused with \`REFUND_NOT_FROM_DASHBOARD\`. ${restApprovalAsked("a preview of the refund, the payment and what stays refundable")} ${STRIPE_MAY_STILL_REFUSE} ${REFUND_STATES} The platform's \`Idempotency-Key\` answers the same refund, as first answered or, if that answer was lost, as it is now (\`Louez-Replayed\`); it may be \`pending\`: read the refund for its outcome rather than repeating the request. ${REST_LINKS_NOTE}`,
  })
  .input(refundPaymentInput)
  .output(refundPaymentOutput)
  .handler(async ({ context, input, path }) => {
    const { credential } = context.actor;
    // A plain dashboard session has no screen in front of this yet.
    if (credential.kind === "session" && credential.assistant !== true) {
      throw stripeRefundErrors.notFromDashboard();
    }
    const port = context.ports.stripeRefunds;
    if (!port) throw stripeRefundErrors.unavailable();
    const presented = context.headers.get(CONFIRMATION_HEADER);
    const refunded = await refundOnlinePayment(
      {
        ...paymentRecordsCaller(context, path, input, "money", port),
        requestedBy: { userId: credential.userId, credentialId: credential.id },
        approvalId: presented && PRESENTED_APPROVAL.test(presented) ? presented : null,
      },
      input,
    );
    return { ...refunded, ...reservationLinksFor(context, refunded.reservationId) };
  });

const getRefund = storeProcedure
  .meta({
    capability: "reservations.refundStripePayment",
    scope: PAYMENTS_READ,
    mcp: {
      name: "get_refund",
      title: "Get Refund",
      description: `Read a refund made with refund_payment, by the payment's id and the refund's id: ${REFUND_STATES} While it is pending, reading it may settle it with Stripe once, under the refund's own rules, at most every 30 seconds (more often, it answers the state as it stands); read it again later rather than refunding again. A refund made in Stripe's own dashboard has no refund here (REFUND_NOT_FOUND): it shows among the reservation's payments. ${LINKS_NOTE}`,
      bundle: "daily",
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "GET",
    path: "/payments/{paymentId}/refunds/{refundId}",
    description: `Reads a refund made with \`POST /payments/{paymentId}/refunds\`. ${REFUND_STATES} While it is pending, a read may settle it with Stripe once, under the refund's own rules (never a second request to Stripe beyond them), at most every 30 seconds and less often as the refund ages: a read in between answers the state as it stands. A refund made in Stripe's own dashboard has no refund here: 404 \`REFUND_NOT_FOUND\`, by design; it shows among the reservation's payments. ${REST_LINKS_NOTE}`,
  })
  .input(getRefundInput)
  .output(refundPaymentOutput)
  .handler(async ({ context, input }) => {
    const port = context.ports.stripeRefunds;
    if (!port) throw stripeRefundErrors.unavailable();
    const read = await getOnlineRefund({ storeId: context.actor.storeId, port }, input);
    return { ...read, ...reservationLinksFor(context, read.reservationId) };
  });

export const dashboardPaymentsRouter = {
  payouts,
  record,
  recordDepositReturn: recordDepositReturnProcedure,
  recordRefund,
  refund,
  getRefund,
  delete: deletePaymentProcedure,
  startStripeOnboarding,
  openStripeDashboard,
  syncStripeStatus,
};
