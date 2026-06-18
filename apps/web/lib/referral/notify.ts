import { eq } from 'drizzle-orm';

import { db } from '@louez/db';
import { stores, users } from '@louez/db';
import { getLogoForLightBackground } from '@louez/utils';

import { env } from '@/env';
import { getLocaleFromCountry } from '@/lib/email/i18n';
import { sendRewardUnlockedEmail } from '@/lib/email/send';
import { formatCurrency } from '@/lib/utils';

import type { ReferralRewardKind } from './reward';

interface NotifyReferrerRewardInput {
  referrerStoreId: string;
  referredStoreName: string;
  /** Whether the reward was granted as free reservations or a euro invoice credit. */
  kind: ReferralRewardKind;
  /** Free reservations granted (0 for an invoice-credit reward). */
  freeReservations: number;
  displayValueCents: number;
}

/**
 * Notify a Referrer by email that a referral reached its Qualifying Event and a reward
 * was granted. Best-effort — never throws to the caller (the reward is already recorded).
 */
export async function notifyReferrerRewardGranted(
  input: NotifyReferrerRewardInput,
): Promise<void> {
  try {
    const store = await db.query.stores.findFirst({
      where: eq(stores.id, input.referrerStoreId),
      columns: {
        name: true,
        userId: true,
        email: true,
        logoUrl: true,
        theme: true,
        settings: true,
      },
    });
    if (!store) return;

    const owner = await db.query.users.findFirst({
      where: eq(users.id, store.userId),
      columns: { email: true },
    });
    const to = owner?.email ?? store.email;
    if (!to) return;

    const currency = (store.settings?.currency || 'EUR').toUpperCase();
    const rewardValue = formatCurrency(input.displayValueCents / 100, currency);

    await sendRewardUnlockedEmail({
      to,
      storeName: store.name,
      storeLogoUrl: getLogoForLightBackground({
        logoUrl: store.logoUrl,
        theme: store.theme,
      }),
      primaryColor: store.theme?.primaryColor ?? undefined,
      referredStoreName: input.referredStoreName,
      kind: input.kind,
      freeReservations: input.freeReservations,
      rewardValue,
      ctaUrl: `${env.NEXT_PUBLIC_APP_URL}/dashboard/referrals`,
      locale: getLocaleFromCountry(store.settings?.country),
    });
  } catch (error) {
    console.warn('[referral] failed to notify referrer of reward', {
      referrerStoreId: input.referrerStoreId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
