// The billing service's pages ("Facturation"), which Louez opens through its hand-off
// route (louez-billing docs/api, README §10): the route mints the token, whose `to`
// claim names the page.

/** The pages a hand-off can open, the `to` values of README §10's token. */
export type BillingPage = "/" | "/payment-method" | "/statements" | "/details";

/** Louez's hand-off route (README §10 step 1). */
export const BILLING_HANDOFF_PATH = "/dashboard/billing";

/** The link that opens `to` on the billing pages, for the active store. */
export function billingPageHref(to: BillingPage): string {
  return `${BILLING_HANDOFF_PATH}?to=${to}`;
}
