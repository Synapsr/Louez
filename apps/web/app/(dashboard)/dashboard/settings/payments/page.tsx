import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'

import { getCurrentStore } from '@/lib/store-context'
import { PaymentsContent } from './payments-content'

export default async function PaymentsSettingsPage() {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const t = await getTranslations('dashboard.settings')
  const reservationMode = store.settings?.reservationMode ?? 'request'

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <p className="text-muted-foreground">{t('payments.description')}</p>

      <PaymentsContent
        stripeAccountId={store.stripeAccountId}
        stripeChargesEnabled={store.stripeChargesEnabled ?? false}
        stripeOnboardingComplete={store.stripeOnboardingComplete ?? false}
        reservationMode={reservationMode}
      />
    </div>
  )
}
