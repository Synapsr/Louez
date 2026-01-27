import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'

import { getCurrentStore } from '@/lib/store-context'
import { getStorePlan } from '@/lib/plan-limits'
import { ReviewBoosterForm } from './review-booster-form'
import { getLocaleFromCountry } from '@/lib/email/i18n'

export default async function ReviewBoosterPage() {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const plan = await getStorePlan(store.id)
  const t = await getTranslations('dashboard.settings')
  const storeLocale = getLocaleFromCountry(store.settings?.country)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <p className="text-muted-foreground">{t('reviewBooster.description')}</p>

      <ReviewBoosterForm
        store={store}
        hasFeatureAccess={plan.features.reviewBooster}
        planSlug={plan.slug}
        storeLocale={storeLocale}
      />
    </div>
  )
}
