import type { BillingReturnOutcome } from "@/lib/billing/billing-return";
import { createBillingAlerts } from "@/lib/billing-sync/alerts";
import { finishCardSetup } from "@/lib/billing-sync/pages";
import { pullStorePolicies } from "@/lib/billing-sync/policies";
import { log } from "@/lib/evlog";

// The owner's return from Stripe Checkout with a card (louez-billing docs/api, README
// §10 step 5). Checkout comes back to the page that opened it, the billing settings or
// the onboarding's card step, with `?checkout=<session id>`: that page saves the card
// here, then shows the toast of the outcome.

/** The `?checkout=` Stripe puts in the return URL: a Checkout Session id, or null. */
export function readCheckoutSessionId(value: string | null | undefined): string | null {
  return value && /^cs_[A-Za-z0-9_]{1,250}$/.test(value) ? value : null;
}

/**
 * Asks the service to save the session's card now rather than at its webhook, then
 * pulls the store's policies, so a card added reopens bookings within seconds.
 * `refreshed` once both went through; `pending` otherwise, and Louez keeps its cache.
 * The caller has checked that the viewer is the store's owner.
 */
export async function finishCardReturn(input: {
  readonly storeId: string;
  readonly checkoutSessionId: string;
  /** `after` from next/server: an alert's Discord part runs after the answer. */
  readonly after: (task: () => Promise<void>) => void;
}): Promise<BillingReturnOutcome> {
  const finished = await finishCardSetup(input.storeId, input.checkoutSessionId);
  // `pending`: Stripe has not confirmed the card; its webhook saves it later.
  if (!finished.ok || finished.value.status === "pending") return "pending";
  try {
    const result = await pullStorePolicies(input.storeId, {
      alerts: createBillingAlerts({ schedule: input.after }),
    });
    // Refused or conflicting versions leave the cache as it was: nothing to announce.
    if (result.outcome === "updated" && result.invalid === 0 && result.conflicts === 0) {
      return "refreshed";
    }
  } catch (error) {
    log.error(
      "billing",
      `the policy pull of store ${input.storeId} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return "pending";
}
