import { localizedLabel } from "@/lib/billing/billing-overview";
import type { EffectivePolicy } from "@/lib/billing/policy";

/**
 * What the reeent step's pricing slide says of a store created now. While Louez's own
 * billing would bill it, Louez's pay-as-you-go pricing. Otherwise the offer label of
 * the policy the billing service sets for it (design §2.1: Louez's copy names no rate
 * and no price), or none while Louez holds no such policy.
 */
export type ReeentIntroPricing =
  | { readonly kind: "legacy" }
  | { readonly kind: "offer"; readonly offer: string | null };

/** `policy` is getUncreatedStorePolicy's, at the time the step is shown. */
export function describeReeentIntroPricing(
  policy: EffectivePolicy,
  locale: string,
): ReeentIntroPricing {
  if (policy.legacyBillingApplies) return { kind: "legacy" };
  return {
    kind: "offer",
    offer: policy.policy ? localizedLabel(policy.policy.labels.offer, locale) : null,
  };
}
