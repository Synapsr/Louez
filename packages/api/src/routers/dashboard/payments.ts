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
  type PaymentRecordsCaller,
} from "../../services/payment-records";
import {
  requireConnectClient,
  stripeConnectErrors,
  syncConnectStatus,
} from "../../services/stripe-connect";
import { completeActiveHandoff, upgradeStoredLink } from "../../services/handoffs";
import { toORPCError } from "../../utils/orpc-error";
import { HANDOFF_HELP, startHandoff } from "./handoffs";
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
  .route({ method: "POST", path: "/payments/stripe/onboarding" })
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
  .route({ method: "POST", path: "/payments/stripe/dashboard" })
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
  .route({ method: "POST", path: "/payments/stripe/sync" })
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

const ALWAYS_CONFIRMED =
  "It always asks for a confirmation, whatever the connection's confirmation setting: the first call answers CONFIRMATION_REQUIRED with a preview";

/**
 * What the payment writes take from their context: the app's writer, and
 * the confirmation asked in the write's transaction. All three record, give
 * back or erase money, the deletion included: they declare `money`, so every
 * key and token is asked whatever its setting, and a session never. The
 * preview's details open with its kind, as the hand-written tools showed them.
 */
function paymentRecordsCaller(
  context: ProductContext,
  path: readonly string[],
  input: unknown,
  sensitive: "money" | "destructive",
): PaymentRecordsCaller {
  const port = context.ports.paymentRecords;
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
      }),
  };
}

/** The reservation's dashboard page, for a caller who may read reservations. */
function reservationLinksFor(context: ProductContext, reservationId: string) {
  return mayRead(context, "reservations")
    ? { links: reservationLinks(context.ports.urls, context.store, { id: reservationId }) }
    : {};
}

const LINKS_NOTE =
  "Returns the reservation's number and, when the connection may read reservations, its `links`: its dashboard page, to give the user.";

const record = storeProcedure
  .meta({
    capability: "reservations.recordPayment",
    scope: PAYMENTS_WRITE,
    sensitive: "money",
    mcp: {
      name: "record_payment",
      title: "Record Payment",
      description: `Record a payment the store received by hand on a reservation (cash, card, transfer, check or other), or money it paid back as a negative adjustment: adds it to the reservation's payments. It moves no money. Refused for an amount that is zero or not a number, a negative amount of another type than adjustment, and a cancelled or rejected reservation. ${ALWAYS_CONFIRMED} of the payment. ${LINKS_NOTE}`,
      bundle: "daily",
      effect: "additive",
    },
  })
  .route({ method: "POST", path: "/reservations/{reservationId}/payments" })
  .input(recordPaymentInput)
  .output(recordPaymentOutput)
  .handler(async ({ context, input, path }) => {
    const recorded = await recordPayment(
      paymentRecordsCaller(context, path, input, "money"),
      input,
    );
    return { ...recorded, ...reservationLinksFor(context, recorded.reservationId) };
  });

const recordDepositReturnProcedure = storeProcedure
  .meta({
    capability: "reservations.returnDeposit",
    scope: PAYMENTS_WRITE,
    sensitive: "money",
    mcp: {
      name: "record_deposit_return",
      title: "Record Deposit Return",
      description: `Record a deposit return the store has already made: adds it to the reservation's payments, as the amount given back and how (cash, card, transfer, check or other). It moves no money: nothing is refunded or released, through Stripe or otherwise. Refused above the deposit collected and not yet returned. ${ALWAYS_CONFIRMED} showing that balance. ${LINKS_NOTE}`,
      bundle: "daily",
      effect: "additive",
    },
  })
  .route({ method: "POST", path: "/reservations/{reservationId}/deposit-returns" })
  .input(recordDepositReturnInput)
  .output(recordDepositReturnOutput)
  .handler(async ({ context, input, path }) => {
    const recorded = await recordDepositReturn(
      paymentRecordsCaller(context, path, input, "money"),
      input,
    );
    return { ...recorded, ...reservationLinksFor(context, recorded.reservationId) };
  });

const deletePaymentProcedure = storeProcedure
  .meta({
    capability: "reservations.deletePayment",
    scope: PAYMENTS_WRITE,
    sensitive: "destructive",
    mcp: {
      name: "delete_payment",
      title: "Delete Payment",
      description: `Delete a payment of a reservation: it leaves the reservation's balance and the billing figures. A Stripe payment is refused: its refunds are made in Stripe. ${ALWAYS_CONFIRMED} of the payment. ${LINKS_NOTE}`,
      bundle: "daily",
      effect: "delete",
    },
  })
  .route({ method: "DELETE", path: "/payments/{paymentId}" })
  .input(deletePaymentInput)
  .output(deletePaymentOutput)
  .handler(async ({ context, input, path }) => {
    const deleted = await deletePayment(
      paymentRecordsCaller(context, path, input, "destructive"),
      input,
    );
    return { ...deleted, ...reservationLinksFor(context, deleted.reservationId) };
  });

export const dashboardPaymentsRouter = {
  payouts,
  record,
  recordDepositReturn: recordDepositReturnProcedure,
  delete: deletePaymentProcedure,
  startStripeOnboarding,
  openStripeDashboard,
  syncStripeStatus,
};
