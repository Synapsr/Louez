import {
  billingStatusSchema,
  getBillingStatusInput,
  startCardSetupInput,
  startCardSetupOutput,
} from "../../contracts/billing";
import type { ProcedureScope } from "../../platform/permissions";
import { storeProcedure } from "../../platform/procedures";
import { assertCardSetupAllowed, getBillingStatus } from "../../services/billing";
import { HANDOFF_HELP, startHandoff } from "./handoffs";

/**
 * What Louez bills the store, on every transport: `billing_get_status` and
 * `billing_start_card_setup` on MCP (billing bundle), `/api/v1/billing` on
 * OpenAPI. Plan changes and cancellation stay in the dashboard.
 */

/** The dashboard's plan and billing actions ask for `manage_settings`. */
const READ: ProcedureScope = { domain: "billing", level: "read", role: "manage_settings" };
const WRITE: ProcedureScope = { domain: "billing", level: "write", role: "manage_settings" };

const getStatus = storeProcedure
  .meta({
    capability: "billing.getStatus",
    scope: READ,
    mcp: {
      name: "billing_get_status",
      title: "Get Louez Billing Status",
      description:
        "What Louez bills the store, as its billing pages show it: who bills it (none, legacy, service), the plan in force or pay-as-you-go, the offer and the billing service's notice in its own words, Louez's pay-as-you-go fees and this month's figures, the card on file, the month-end invoices, the unpaid balance, whether Louez billing lets the store take new bookings (gate) and why not, and whether billing_start_card_setup can run now (cardSetup). Amounts are decimal strings with their currency. Read-only: changing or cancelling a plan is done by the user in Louez, at the page in `links`, the URL to give the user.",
      bundle: "billing",
      reach: "provider",
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "GET", path: "/billing" })
  .input(getBillingStatusInput)
  .output(billingStatusSchema)
  .handler(({ context }) =>
    getBillingStatus({
      storeId: context.actor.storeId,
      role: context.actor.role,
      store: context.store,
      ports: context.ports,
      locale: "en",
    }),
  );

const startCardSetup = storeProcedure
  .meta({
    capability: "billing.startCardSetup",
    scope: WRITE,
    mcp: {
      name: "billing_start_card_setup",
      title: "Add Billing Card",
      description: `Have the store's owner add or replace the card Louez charges its fees on, on Stripe's page: only they can type it. For when Louez billing stops new bookings until a card is added, or the card expired (billing_get_status, inbox_list say so). ${HANDOFF_HELP} Once completed, billing_get_status shows the card and whether new bookings are accepted again. Only for the owner of a store Louez's billing service bills (billing_get_status: cardSetup.available); otherwise CARD_SETUP_UNAVAILABLE says why.`,
      bundle: "billing",
      effect: "overwrite",
      reach: "provider",
    },
  })
  .route({ method: "POST", path: "/billing/card-setup" })
  .input(startCardSetupInput)
  .output(startCardSetupOutput)
  .handler(async ({ context }) => {
    await assertCardSetupAllowed({
      storeId: context.actor.storeId,
      role: context.actor.role,
      ports: context.ports,
    });
    return startHandoff(context, "billing_card_setup");
  });

export const dashboardBillingRouter = { getStatus, startCardSetup };
