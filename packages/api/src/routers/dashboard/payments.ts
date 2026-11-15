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
import { approvalAsked, restApprovalAsked } from "../../platform/approval-help";
import { checkConfirmation } from "../../platform/confirmation";
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
function reservationLinksFor(context: ProductContext, reservationId: string) {
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
      description: `Record a payment the store received by hand on a reservation (cash, card, transfer, check or other), or money it paid back as a negative adjustment: adds it to the reservation's payments. It moves no money. Refused, before anything is asked, for an amount that is zero or not a plain decimal with at most 8 digits before the point and 2 after (such as "150" or "-20.50"), a negative amount of another type than adjustment, and a cancelled or rejected reservation. ${approvalAsked("a preview of the payment")} ${LINKS_NOTE}`,
      bundle: "daily",
      effect: "additive",
    },
  })
  .route({
    method: "POST",
    path: "/reservations/{reservationId}/payments",
    description: `Records a payment row the store handled itself on a reservation: its \`type\` (\`rental\`, \`deposit\`, \`deposit_return\`, \`damage\` or \`adjustment\`), its amount and how it was paid (cash, card, transfer, check or other). Money the store paid back is a negative \`adjustment\`. It moves no money. A \`deposit_return\` recorded here is not checked against the deposit collected: to record a deposit given back against that balance, use \`POST /reservations/{reservationId}/deposit-returns\`. Refused, before anything is asked, for an amount that is zero or not a plain decimal with at most 8 digits before the point and 2 after (\`PAYMENT_AMOUNT_INVALID\`), a negative amount of another type than \`adjustment\`, and a cancelled or rejected reservation. ${restApprovalAsked("a preview of the payment")} ${REST_LINKS_NOTE}`,
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
      description: `Record a deposit return the store has already made: adds it to the reservation's payments, as the amount given back and how (cash, card, transfer, check or other). It moves no money: nothing is refunded or released, through Stripe or otherwise. Refused above the deposit collected and not yet returned. ${approvalAsked("a preview showing that balance")} ${LINKS_NOTE}`,
      bundle: "daily",
      effect: "additive",
    },
  })
  .route({
    method: "POST",
    path: "/reservations/{reservationId}/deposit-returns",
    description: `Records a deposit the store has already given back: the amount and how (cash, card, transfer, check or other). It moves no money: nothing is refunded or released, through Stripe or otherwise. Refused with \`DEPOSIT_RETURN_EXCEEDS_BALANCE\` above the returnable balance: the reservation's completed \`deposit\` rows minus its completed \`deposit_return\` rows. Stripe deposit holds and captures are not in that balance. The check is this operation's own: a \`deposit_return\` recorded with \`POST /reservations/{reservationId}/payments\` is not checked. ${restApprovalAsked("a preview showing that balance")} ${REST_LINKS_NOTE}`,
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
  `a payment the store does not have (${code("PAYMENT_NOT_FOUND")}); an amount that is zero, negative or not a plain decimal with at most 8 digits before the point and 2 after (${code("REFUND_AMOUNT_INVALID")}); a payment that is itself a refund (${code("REFUND_OF_REFUND")}); a deposit, a deposit return or a deposit hold (${code("REFUND_PAYMENT_TYPE_NOT_REFUNDABLE")}); a payment not completed (${code("REFUND_PAYMENT_NOT_COMPLETED")}); a payment taken online through Stripe, whose refunds are not available through this action yet (${code("REFUND_STRIPE_PAYMENT")}); a payment of zero or below (${code("REFUND_PAYMENT_NOT_RECEIVED")}); and an amount above the payment's amount less every completed refund already recorded against it (${code("REFUND_EXCEEDS_REFUNDABLE")}, whose details give the amounts paid, already refunded and refundable, and the currency)`;

const recordRefund = storeProcedure
  .meta({
    capability: "reservations.refundManualPayment",
    scope: PAYMENTS_WRITE,
    sensitive: "money",
    personApproval: true,
    mcp: {
      name: "record_refund",
      title: "Record Refund",
      description: `Record a refund the store already gave by hand (cash, card terminal, transfer, check or other) against one payment of a reservation, taken by hand: a rental, damage, adjustment or kept deposit (deposit_capture) payment, by its id among the payments reservations_get returns. It moves no money: Louez only records it, the payment keeps its amount, and the refund, in the payment's own currency, comes off what the reservation received. Partial refunds may follow one another up to the payment's amount. Refused, before anything is asked, for ${refundRefusals(String)}. ${approvalAsked("a preview of the refund, the payment and what is left to refund")} Returns the refund's id, its currency and, when the store issues invoices, its credit note's number (null when none was issued: the refund stands). ${LINKS_NOTE}`,
      bundle: "daily",
      effect: "additive",
    },
  })
  .route({
    method: "POST",
    path: "/payments/{paymentId}/refunds",
    description: `Records a refund the store already gave by hand (cash, card terminal, bank transfer, check or other) against one payment it took by hand: a \`rental\`, \`damage\`, \`adjustment\` or \`deposit_capture\` payment. It moves no money. The refund is its own positive \`completed\` row pointing at the payment, in the payment's own currency; the payment keeps its amount. Partial refunds may follow one another, up to the payment's amount less every completed refund already recorded against it, counted under the reservation's lock. Refused, before anything is asked, for ${refundRefusals(inBackticks)}. ${restApprovalAsked("a preview of the refund, the payment and what is left to refund")} Returns the refund's id (\`refundId\`), its \`currency\` and \`creditNoteNumber\`, the credit note's number when the store issues invoices, null when none was issued (the refund stands). ${REST_LINKS_NOTE}`,
  })
  .input(recordRefundInput)
  .output(recordRefundOutput)
  .handler(async ({ context, input, path }) => {
    const refund = await recordPaymentRefund(
      paymentRecordsCaller(context, path, input, "money", context.ports.paymentRefunds),
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

export const dashboardPaymentsRouter = {
  payouts,
  record,
  recordDepositReturn: recordDepositReturnProcedure,
  recordRefund,
  delete: deletePaymentProcedure,
  startStripeOnboarding,
  openStripeDashboard,
  syncStripeStatus,
};
