import { readBillingReturnOutcome, withBillingReturnOutcome } from "@/lib/billing/billing-return";
import { BILLING_CARD_STEP_PATH, billingHandoffHref } from "@/lib/billing/billing-routes";

import { ONBOARDING_END_PATH } from "../_lib/steps";

export type BillingCardStepView =
  | { readonly kind: "redirect"; readonly to: string }
  | { readonly kind: "show"; readonly cardHref: string };

/**
 * What `/onboarding/billing` answers. `shown`: whether the active store's owner sees
 * the step (lib/billing/billing-card-step.ts). `billing`: the `?billing=` toast the
 * return from the billing pages brought.
 */
export function billingCardStepView(input: {
  readonly shown: boolean;
  /** Whether the source step is still due, as in the layout's flow. */
  readonly needsSource: boolean;
  readonly billing: string | null;
}): BillingCardStepView {
  const outcome = readBillingReturnOutcome(input.billing);
  if (!input.shown) {
    // Once the store no longer asks for a card, or never did, the next step gets the toast.
    const next = input.needsSource ? "/onboarding/source" : ONBOARDING_END_PATH;
    return { kind: "redirect", to: outcome ? withBillingReturnOutcome(next, outcome) : next };
  }
  // Back from the billing pages while the store still asks for a card: the pull found no
  // version that records one yet, so "up to date" would contradict the step.
  if (outcome === "refreshed") {
    return { kind: "redirect", to: withBillingReturnOutcome(BILLING_CARD_STEP_PATH, "pending") };
  }
  // The hand-off brings the owner back here, not to the settings.
  return { kind: "show", cardHref: billingHandoffHref("/payment-method", "onboarding") };
}
