import { localizedLabel } from "@/lib/billing/billing-overview";
import type { PolicyLabel } from "@/lib/billing/reservation-gate-banner";
import { type PlanRow, planInForce } from "@/lib/plan-limits";
import { hasLiveSubscription } from "@/lib/stripe/subscription-status";

// What the plan page shows a store the billing service bills (louez-billing docs/api,
// README §8.7): the plans as Louez sells them to every store, and for pay-as-you-go the
// service's words, never Louez's ladder, free reservations or usage estimate.

/** What the page reads of the store's `subscriptions` row. */
export type NewStorePlanRow = PlanRow & { readonly stripeCustomerId: string | null };

/** What the page reads of an EffectivePolicy: the cached version's offer label. */
type OfferPolicy = {
  readonly policy: { readonly labels: { readonly offer: PolicyLabel } } | null;
};

export type NewStoreSubscriptionPage =
  /** `?payg=1` on a plan: the offer the store returns to, and the switch to it. */
  | { readonly kind: "payg_preview"; readonly offerLabel: string | null }
  | {
      readonly kind: "plans";
      readonly offerLabel: string | null;
      /** The plan buttons change the live subscription in place (changeSubscriptionPlan). */
      readonly hasLiveSubscription: boolean;
      /** Stripe's portal shows the plan's invoices, on the row's customer. */
      readonly canAccessBillingPortal: boolean;
    };

/**
 * The page of a store the billing service bills. `policy` is the store's policy now;
 * `defaultPolicy` is the `*` version for a store created now (getUncreatedStorePolicy).
 * While no plan is in force, the store pays its own policy's offer. On a plan, its
 * policy is the plan's, so the pay-as-you-go card names the offer it returns to.
 */
export function describeNewStoreSubscriptionPage(input: {
  readonly row: NewStorePlanRow | null;
  readonly wantsPayAsYouGoPreview: boolean;
  readonly policy: OfferPolicy;
  readonly defaultPolicy: OfferPolicy;
  readonly locale: string;
}): NewStoreSubscriptionPage {
  const onPlan = planInForce(input.row);
  const offer = (onPlan ? input.defaultPolicy : input.policy).policy?.labels.offer;
  const offerLabel = offer ? localizedLabel(offer, input.locale) : null;
  if (onPlan && input.wantsPayAsYouGoPreview) return { kind: "payg_preview", offerLabel };
  return {
    kind: "plans",
    offerLabel,
    hasLiveSubscription: hasLiveSubscription(input.row),
    canAccessBillingPortal: Boolean(input.row?.stripeCustomerId),
  };
}
