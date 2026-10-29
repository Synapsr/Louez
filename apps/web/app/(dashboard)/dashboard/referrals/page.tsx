import { connection } from 'next/server';
import { redirect } from 'next/navigation';

import { getTranslations } from 'next-intl/server';

import { requireLegacyBilling, requirePlatformBilling } from '@/lib/billing/require-billing';
import { getCurrentStore } from '@/lib/store-context';

import { getReferralData } from './actions';
import { ReferralHowItWorks } from './referral-how-it-works';
import { ReferralHubViewedTracker } from './referral-hub-viewed-tracker';
import { ReferralLink } from './referral-link';
import { ReferralStats } from './referral-stats';
import { ReferralsList } from './referrals-list';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export default async function ReferralsPage() {
  // Read LOUEZ_BILLING at request time: before a dynamic API, Cache Components
  // would run this check during the build, which has no LOUEZ_BILLING, and serve a 404.
  await connection();
  requirePlatformBilling();
  const store = await getCurrentStore();
  if (!store) redirect('/onboarding');
  // The rewards are credits on Louez's own billing (maybeGrantReferrerReward).
  await requireLegacyBilling(store.id);

  const t = await getTranslations('dashboard.referrals');
  const data = await getReferralData();

  if (!data) redirect('/onboarding');

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <ReferralHubViewedTracker
        storeId={data.storeId}
        totalReferrals={data.stats.total}
        qualifiedReferrals={data.stats.qualified}
        freeReservationsEarned={data.stats.freeReservationsEarned}
        rewardValueCents={data.stats.rewardValueCents}
        freeReservationsRemaining={data.stats.freeReservationsRemaining}
        rewardKind={data.program.referrerRewardKind}
        referrerReward={data.program.referrerReward}
        referredReward={data.program.referredReward}
        minQualifyingAmountCents={data.program.minQualifyingAmountCents}
        currency={data.program.currency}
      />

      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <ReferralHowItWorks
            referrerReward={data.program.referrerReward}
            referrerRewardKind={data.program.referrerRewardKind}
            minQualifyingAmountCents={data.program.minQualifyingAmountCents}
            currency={data.program.currency}
          />
        </div>
        <p className="text-muted-foreground mt-1">{t('description')}</p>
      </div>

      <ReferralLink
        storeId={data.storeId}
        referralUrl={data.referralUrl}
        referrerReward={data.program.referrerReward}
        referredReward={data.program.referredReward}
        rewardKind={data.program.referrerRewardKind}
        rewardValueCents={data.program.rewardValueCents}
        currency={data.program.currency}
      />
      <ReferralStats stats={data.stats} />
      <ReferralsList referrals={data.referrals} />
    </div>
  );
}
