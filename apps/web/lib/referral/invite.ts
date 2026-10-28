import { cookies } from 'next/headers';

import { eq } from 'drizzle-orm';

import { db } from '@louez/db';
import { stores } from '@louez/db';

import { isBillingEnabled } from '@/lib/billing/mode';
import { isValidReferralCode } from '@/lib/utils/referral';

import { getReferralProgramConfig } from './defaults';

export interface ReferralInviteContext {
  /** The Referrer's store name, when resolvable (for "X invited you"). */
  referrerName: string | null;
  /**
   * The program's welcome reward for a Referred Store, for analytics only. A store the
   * billing service bills gets none (insertNewStoreSubscription), so the banner names none.
   */
  freeReservations: number;
}

/**
 * Read the pending referral cookie and resolve who invited the visitor, so login/sign-up
 * can surface an invitation banner. Returns null when there is no valid pending referral,
 * or when the instance does not bill its stores (the program's rewards are billing
 * credits). Server-only.
 */
export async function getReferralInviteContext(): Promise<ReferralInviteContext | null> {
  if (!isBillingEnabled()) return null;
  const code = (await cookies()).get('louez_referral')?.value;
  if (!code || !isValidReferralCode(code)) return null;

  const referrer = await db.query.stores.findFirst({
    where: eq(stores.referralCode, code),
    columns: { name: true },
  });
  if (!referrer) return null;

  return {
    referrerName: referrer.name,
    freeReservations: getReferralProgramConfig().referredRewardFreeReservations,
  };
}
