import { ORPCError } from "@orpc/server";

/**
 * What a demo store (packages/db demo-stores.ts) refuses: every action that
 * reaches outside the visitor's sandbox or costs money. Everything else of the
 * dashboard works, on the sandbox's invented data.
 *
 * Procedures are named by their router path, as the dashboard router mounts
 * them (`team.invite`), matched on the end of the full path so the same entry
 * covers every transport. A procedure added to one of these domains later is
 * refused only once it is listed here: the domains below are the ones to check.
 * Reads that only answer from the store's own row (payouts, Stripe status,
 * insurer state) stay: a demo store has no Stripe account or insurer to call.
 */
export const DEMO_REFUSED_PROCEDURES: readonly string[] = [
  // Team: invitations are e-mails to real addresses; members are real accounts.
  "team.invite",
  "team.cancelInvitation",
  "team.removeMember",
  "team.resendInvitation",
  "team.invitationLink",
  // Billing: a card, a plan, an offer.
  "billing.startCardSetup",
  "billing.startPlanOffer",
  // Stores: another store under the demo account, a launch.
  "stores.create",
  "stores.updateOnboardingInfo",
  "stores.completeOnboarding",
  // Payments through Stripe: onboarding, payouts, refunds of an online payment.
  "payments.startStripeOnboarding",
  "payments.openStripeDashboard",
  "payments.refund",
  // Integrations: an insurer, a calendar, a provider account.
  "integrations.setEnabled",
  "integrations.updateGoogleCalendarSettings",
  "integrations.resyncGoogleCalendar",
  "integrations.disconnectGoogleCalendar",
  "integrations.connectTulip",
  "integrations.disconnectTulip",
  "integrations.updateTulipConfiguration",
  "integrations.upsertTulipProductMapping",
  "integrations.pushTulipProductUpdate",
  "integrations.createTulipProduct",
  // The storefront's address is global: a visitor does not take one.
  "onlineStore.updateSlug",
  // A company registry lookup calls a provider.
  "settings.searchCompanyRegistry",
  // Agents and API keys: no programmatic access to a sandbox.
  "apiKeys.create",
  "apiKeys.updateConfirmation",
  // Paid image models.
  "products.enhanceImage",
  "products.removeImageBackground",
  "agentConnections.authorize",
  "agentConnections.update",
];

/**
 * The same refusals by capability (`meta.capability` of a store procedure),
 * which names a procedure whatever its router path, for the API and the MCP.
 */
export const DEMO_REFUSED_CAPABILITIES: readonly string[] = [
  "team.inviteMember",
  "team.cancelInvitation",
  "team.getInvitationLink",
  "team.removeMember",
  "team.resendInvitation",
  "billing.startCardSetup",
  "billing.startPlanOffer",
  "stores.create",
  "stores.updateOnboardingInfo",
  "stores.completeOnboarding",
  "payments.startStripeOnboarding",
  "payments.getStripeDashboardUrl",
  "reservations.refundStripePayment",
  "online_store.updateSlug",
  "settings.searchCompanyRegistry",
  // Paid image models.
  "products.enhanceImage",
  "products.removeImageBackground",
];

const REFUSED = new Set(DEMO_REFUSED_PROCEDURES);
const REFUSED_CAPABILITIES = new Set(DEMO_REFUSED_CAPABILITIES);

/** Whether a procedure, by its router path or its capability, is refused on a demo store. */
export function isRefusedOnDemoStore(path: readonly string[], capability?: string): boolean {
  if (capability && REFUSED_CAPABILITIES.has(capability)) return true;
  for (let start = 0; start < path.length - 1; start++) {
    if (REFUSED.has(path.slice(start).join("."))) return true;
  }
  return false;
}

/** The refusal a demo store answers, translated by the dashboard (`errors.demoStoreActionDisabled`). */
export function demoStoreRefusal(): ORPCError<"FORBIDDEN", { code: "DEMO_STORE_REFUSED" }> {
  return new ORPCError("FORBIDDEN", {
    message: "errors.demoStoreActionDisabled",
    data: { code: "DEMO_STORE_REFUSED" },
  });
}
