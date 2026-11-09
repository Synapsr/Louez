import { z } from "zod";

import { ORPCError } from "@orpc/server";

import type { ConnectAccountStatus } from "../../adapters/stripe-connect";
import {
  openStripeDashboardInput,
  openStripeDashboardOutput,
  startStripeOnboardingInput,
  startStripeOnboardingOutput,
  syncStripeStatusInput,
  syncStripeStatusOutput,
  type StripeStatus,
} from "../../contracts/stripe-connect";
import { dashboardPageLinks } from "../../platform/links";
import type { ProcedureScope } from "../../platform/permissions";
import { storeProcedure } from "../../platform/procedures";
import { dashboardProcedure } from "../../procedures";
import { bookingModeOf } from "../../services/launch";
import {
  requireConnectClient,
  stripeConnectErrors,
  syncConnectStatus,
} from "../../services/stripe-connect";
import { completeActiveHandoff } from "../../services/handoffs";
import { toORPCError } from "../../utils/orpc-error";
import { HANDOFF_HELP, startHandoff } from "./handoffs";
import type { ProductContext } from "./product-context";

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
    // The answer holds the link: whoever has it may continue the step.
    secretOutput: true,
    mcp: {
      name: "payments_start_stripe_onboarding",
      title: "Connect Stripe",
      description: `Connect the store to Stripe so it takes online payments, or finish a connection left midway. Stripe asks the user for their identity and bank details on its own pages, which only they can fill in. ${HANDOFF_HELP} Once it is completed, payments_sync_stripe_status reads where Stripe stands: it may still review the details before charges are enabled, and the storefront takes requests rather than payments until then. Refused when the store already takes payments (STRIPE_ALREADY_CONNECTED) or when this Louez has no Stripe (STRIPE_NOT_CONFIGURED).`,
      bundle: "settings",
      annotations: { openWorldHint: true },
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
    secretOutput: true,
    mcp: {
      name: "payments_open_stripe_dashboard",
      title: "Open Stripe Dashboard",
      description: `Send the user to the store's own Stripe dashboard (payouts, disputes, bank details), where they sign in to Stripe. ${HANDOFF_HELP} The handoff completes once the user is on their way to Stripe. Refused without a Stripe account (NO_STRIPE_ACCOUNT).`,
      bundle: "settings",
      annotations: { openWorldHint: true },
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
        "Read the store's Stripe account from Stripe now and save it in Louez: whether it takes charges and payouts, whether the user submitted their details, what Stripe still asks for, and the booking mode the storefront applies (payment mode takes requests until charges are enabled). Use it after a Stripe handoff completes, or when the user says Stripe sent them something. Its `links` hold the payment settings page: give the user that URL. Refused without a Stripe account (NO_STRIPE_ACCOUNT).",
      bundle: "settings",
      annotations: { idempotentHint: true, openWorldHint: true },
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

export const dashboardPaymentsRouter = {
  payouts,
  startStripeOnboarding,
  openStripeDashboard,
  syncStripeStatus,
};
