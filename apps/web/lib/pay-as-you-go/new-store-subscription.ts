import {
  type PolicyExecutor,
  legacyBillingAppliesAt,
  markLegacyStore,
  subscriptions,
} from "@louez/db";

import { getReferralProgramConfig } from "@/lib/referral/defaults";

import { getNewStorePricing } from "./defaults";

/**
 * Writes the subscription row of a store onboarding has just created, in the
 * transaction that created it: pay-as-you-go with the current offer for new stores,
 * which the store keeps even if the offer later changes, and the welcome gift of free
 * reservations, larger for a store that signed up through a referral. The owner can
 * switch to a subscription plan from the subscription page.
 *
 * Writes nothing unless Louez's legacy code bills the store (legacyBillingApplies at
 * its creation, README §8.3): without platform billing a store gets no billing row,
 * and a store the billing service bills gets no legacy pricing (design §4.8). True
 * when it wrote the row, which it marks in the store's legacy_store snapshot.
 */
export async function insertNewStoreSubscription(
  tx: PolicyExecutor,
  input: { readonly storeId: string; readonly currency: string; readonly referred: boolean },
): Promise<boolean> {
  if (!(await legacyBillingAppliesAt(tx, input.storeId, new Date()))) return false;
  const pricing = getNewStorePricing(input.currency);
  await tx.insert(subscriptions).values({
    storeId: input.storeId,
    planSlug: "pay_as_you_go",
    billingMode: "pay_as_you_go",
    ...pricing,
    freeReservationsGranted: input.referred
      ? getReferralProgramConfig().referredRewardFreeReservations
      : pricing.freeReservationsGranted,
  });
  await markLegacyStore(tx, input.storeId);
  return true;
}
