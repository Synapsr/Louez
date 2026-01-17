import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'

import { getCurrentStore } from '@/lib/store-context'
import { getStorePlan } from '@/lib/plan-limits'
import { SettingsNav } from '@/components/dashboard/settings-nav'
import { ReviewBoosterForm } from './review-booster-form'

export default async function ReviewBoosterPage() {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const plan = await getStorePlan(store.id)
  const t = await getTranslations('dashboard.settings')

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('reviewBooster.description')}</p>
      </div>

      <SettingsNav />

      <ReviewBoosterForm
        store={store}
        hasFeatureAccess={plan.features.reviewBooster}
        planSlug={plan.slug}
      />
    </div>
  )
}
