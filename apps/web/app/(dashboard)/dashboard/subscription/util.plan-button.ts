/**
 * What a plan card's button does: nothing for the plan and interval the store is on
 * or one it cannot buy, a Stripe Checkout without a live subscription, and otherwise a
 * change of that subscription's plan, since a second Checkout would leave the first
 * subscription billing (plans-for-new-stores decision 5).
 */
export type PlanButtonAction = "none" | "checkout" | "change";

export const planButtonAction = (input: {
  readonly isFree: boolean;
  readonly isAvailable: boolean;
  readonly isExactCurrentPlan: boolean;
  readonly hasLiveSubscription: boolean;
}): PlanButtonAction => {
  if (input.isFree || !input.isAvailable || input.isExactCurrentPlan) return "none";
  return input.hasLiveSubscription ? "change" : "checkout";
};
