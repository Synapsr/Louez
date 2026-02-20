import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'

import { getCurrentStore } from '@/lib/store-context'
import { BusinessHoursForm } from './business-hours-form'

export default async function HoursPage() {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const t = await getTranslations('dashboard.settings')

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <p className="text-muted-foreground">
        {t('businessHours.description')}
      </p>

      <BusinessHoursForm store={store} />
    </div>
  )
}
