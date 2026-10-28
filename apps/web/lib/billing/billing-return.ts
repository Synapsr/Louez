// "Back to Louez" from the billing pages (louez-billing docs/api, README §10 step 4):
// the route that pulls the store's policies, where it then sends the owner, and the
// toast it asks that page for.

/** The route the service's `return_url` must name. */
export const BILLING_RETURN_PATH = "/dashboard/billing/return";

/** The settings page the route redirects to. */
export const BILLING_RETURN_TARGET = "/dashboard/settings";

/** The query parameter that carries the toast to show. */
export const BILLING_RETURN_PARAM = "billing";

/**
 * `refreshed`: the pull answered and Louez cached every version in it. `pending`: Louez
 * kept its cache, or refused or kept back part of the answer.
 */
export type BillingReturnOutcome = "refreshed" | "pending";

export function billingReturnTarget(outcome: BillingReturnOutcome): string {
  return `${BILLING_RETURN_TARGET}?${BILLING_RETURN_PARAM}=${outcome}`;
}

export function readBillingReturnOutcome(value: string | null): BillingReturnOutcome | null {
  return value === "refreshed" || value === "pending" ? value : null;
}
