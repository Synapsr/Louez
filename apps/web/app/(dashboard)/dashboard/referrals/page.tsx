import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getCurrentStore } from '@/lib/store-context'
import { getReferralData } from './actions'
import { ReferralStats } from './referral-stats'
import { ReferralLink } from './referral-link'
import { ReferralsList } from './referrals-list'
import { ReferralHowItWorks } from './referral-how-it-works'

export default async function ReferralsPage() {
  const store = await getCurrentStore()
  if (!store) redirect('/onboarding')

  const t = await getTranslations('dashboard.referrals')
  const data = await getReferralData()

  if (!data) redirect('/onboarding')

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <ReferralHowItWorks
            referrerReward={data.program.referrerReward}
            referredReward={data.program.referredReward}
            minQualifyingAmountCents={data.program.minQualifyingAmountCents}
            currency={data.program.currency}
          />
        </div>
        <p className="mt-1 text-muted-foreground">{t('description')}</p>
      </div>

      <ReferralLink
        referralUrl={data.referralUrl}
        referrerReward={data.program.referrerReward}
        referredReward={data.program.referredReward}
        rewardValueCents={data.program.rewardValueCents}
        currency={data.program.currency}
      />
      <ReferralStats stats={data.stats} />
      <ReferralsList referrals={data.referrals} />
    </div>
  )
}
