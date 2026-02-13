import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'

import { getCurrentStore } from '@/lib/store-context'
import { DeliverySettingsForm } from './delivery-settings-form'

export default async function DeliverySettingsPage() {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const t = await getTranslations('dashboard.settings')

  // Check if store has coordinates configured
  const hasCoordinates = Boolean(store.latitude && store.longitude)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <p className="text-muted-foreground">{t('delivery.description')}</p>

      <DeliverySettingsForm store={store} hasCoordinates={hasCoordinates} />
    </div>
  )
}
