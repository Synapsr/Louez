// The owner's return from Stripe Checkout with a card (louez-billing docs/api, README
// §10 step 5): the page Checkout comes back to saves the card and pulls the store's
// policies (card-return.ts), then shows this toast once.

/** The query parameter that carries the toast to show. */
export const BILLING_RETURN_PARAM = "billing";

/**
 * `refreshed`: the card is saved and Louez cached every version the pull brought.
 * `pending`: Louez kept its cache, or the card is not confirmed yet.
 */
export type BillingReturnOutcome = "refreshed" | "pending";

/** `path` with the toast of `outcome`. */
export function withBillingReturnOutcome(path: string, outcome: BillingReturnOutcome): string {
  return `${path}?${BILLING_RETURN_PARAM}=${outcome}`;
}

export function readBillingReturnOutcome(value: string | null): BillingReturnOutcome | null {
  return value === "refreshed" || value === "pending" ? value : null;
}
