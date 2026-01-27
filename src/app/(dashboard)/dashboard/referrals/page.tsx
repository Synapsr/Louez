import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getCurrentStore } from '@/lib/store-context'
import { getReferralData } from './actions'
import { ReferralStats } from './referral-stats'
import { ReferralLink } from './referral-link'
import { ReferralsList } from './referrals-list'

export default async function ReferralsPage() {
  const store = await getCurrentStore()
  if (!store) redirect('/onboarding')

  const t = await getTranslations('dashboard.referrals')
  const data = await getReferralData()

  if (!data) redirect('/onboarding')

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-muted-foreground">{t('description')}</p>
      </div>

      <ReferralLink referralUrl={data.referralUrl} />
      <ReferralStats stats={data.stats} />
      <ReferralsList referrals={data.referrals} />
    </div>
  )
}
