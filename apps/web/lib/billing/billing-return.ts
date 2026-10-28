import {
  BILLING_CARD_STEP_PATH,
  BILLING_SETTINGS_PATH,
  type BillingReturnOrigin,
} from "@/lib/billing/billing-routes";

// "Back to Louez" from the billing pages (louez-billing docs/api, README §10 step 4):
// the route that pulls the store's policies, where it then sends the owner, and the
// toast it asks that page for.

/** The route the service's `return_url` must name. */
export const BILLING_RETURN_PATH = "/dashboard/billing/return";

/**
 * Where the route redirects by default: the settings' billing card, with the fresh
 * policy. A hand-off from the onboarding comes back to its card step instead.
 */
export const BILLING_RETURN_TARGET = BILLING_SETTINGS_PATH;

/** The query parameter that carries the toast to show. */
export const BILLING_RETURN_PARAM = "billing";

/**
 * Where the hand-off left from, kept until the return: the service's `return_url` takes
 * no query (README §10 step 4). Only the hand-off and its return read it.
 */
export const BILLING_RETURN_ORIGIN_COOKIE = "louez_billing_return";

/** The Louez page the return goes back to: the onboarding's card step, or the settings. */
export function billingReturnOriginPath(origin: BillingReturnOrigin | null): string {
  return origin === "onboarding" ? BILLING_CARD_STEP_PATH : BILLING_RETURN_TARGET;
}

/**
 * `refreshed`: the pull answered and Louez cached every version in it. `pending`: Louez
 * kept its cache, or refused or kept back part of the answer.
 */
export type BillingReturnOutcome = "refreshed" | "pending";

export function billingReturnTarget(
  outcome: BillingReturnOutcome,
  origin: BillingReturnOrigin | null = null,
): string {
  return withBillingReturnOutcome(billingReturnOriginPath(origin), outcome);
}

/** `path` with the toast of `outcome`. */
export function withBillingReturnOutcome(path: string, outcome: BillingReturnOutcome): string {
  return `${path}?${BILLING_RETURN_PARAM}=${outcome}`;
}

export function readBillingReturnOutcome(value: string | null): BillingReturnOutcome | null {
  return value === "refreshed" || value === "pending" ? value : null;
}
