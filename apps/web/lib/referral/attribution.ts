import { isValidReferralCode } from '../utils/referral';

/** Minimal view of a candidate Referrer Store needed to resolve attribution. */
export interface ReferrerStoreRef {
  id: string;
  /** The owner user id — used to block self-referral. */
  userId: string;
}

export interface ReferralAttribution {
  referredByUserId: string;
  referredByStoreId: string;
}

/**
 * Resolve who referred a new Store from a referral cookie value. Returns null when the
 * code is malformed, the Referrer Store is unknown, or it is a self-referral (a Store
 * owner cannot refer themselves — compared at the user level, not the store level). Pure.
 */
export function resolveReferralAttribution(params: {
  refCode: string | null | undefined;
  referrerStore: ReferrerStoreRef | null | undefined;
  currentUserId: string;
}): ReferralAttribution | null {
  const { refCode, referrerStore, currentUserId } = params;

  if (!refCode || !isValidReferralCode(refCode)) return null;
  if (!referrerStore) return null;
  if (referrerStore.userId === currentUserId) return null; // self-referral

  return {
    referredByUserId: referrerStore.userId,
    referredByStoreId: referrerStore.id,
  };
}
