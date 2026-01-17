import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'

import { getCurrentStore } from '@/lib/store-context'
import { SettingsNav } from '@/components/dashboard/settings-nav'
import { StripeConnectCard } from './stripe-connect-card'
import { PaymentFlowExplanation } from './payment-flow-explanation'

export default async function PaymentsSettingsPage() {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const t = await getTranslations('dashboard.settings')
  const reservationMode = store.settings?.reservationMode ?? 'request'

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('payments.description')}</p>
      </div>

      <SettingsNav />

      <PaymentFlowExplanation
        reservationMode={reservationMode}
        stripeChargesEnabled={store.stripeChargesEnabled ?? false}
      />

      <StripeConnectCard
        stripeAccountId={store.stripeAccountId}
        stripeChargesEnabled={store.stripeChargesEnabled ?? false}
        stripeOnboardingComplete={store.stripeOnboardingComplete ?? false}
      />
    </div>
  )
}
