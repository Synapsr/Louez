'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toastManager } from '@louez/ui'

import { StripeConnectCard } from './stripe-connect-card'
import { PaymentFlowExplanation } from './payment-flow-explanation'
import { startStripeOnboarding } from './actions'

interface PaymentsContentProps {
  stripeAccountId: string | null
  stripeChargesEnabled: boolean
  stripeOnboardingComplete: boolean
  reservationMode: 'payment' | 'request'
  stripeConfigured: boolean
}

export function PaymentsContent({
  stripeAccountId,
  stripeChargesEnabled,
  stripeOnboardingComplete,
  reservationMode,
  stripeConfigured,
}: PaymentsContentProps) {
  const [isConnecting, setIsConnecting] = useState(false)
  const tErrors = useTranslations('errors')

  const handleConnectStripe = async () => {
    setIsConnecting(true)
    try {
      const result = await startStripeOnboarding()
      if (result.error) {
        toastManager.add({ title: tErrors(result.error.replace('errors.', '')), type: 'error' })
      } else if (result.url) {
        window.location.href = result.url
      }
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' })
    } finally {
      setIsConnecting(false)
    }
  }

  // Instance has no Stripe keys: online payments cannot be enabled from the
  // dashboard, so say it instead of offering a connect flow that would fail.
  if (!stripeConfigured) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-sm">
        {tErrors('stripeNotConfigured')}
      </div>
    )
  }

  return (
    <>
      <StripeConnectCard
        stripeAccountId={stripeAccountId}
        stripeChargesEnabled={stripeChargesEnabled}
        stripeOnboardingComplete={stripeOnboardingComplete}
      />

      <PaymentFlowExplanation
        reservationMode={reservationMode}
        stripeChargesEnabled={stripeChargesEnabled}
        onConnectStripe={handleConnectStripe}
        isConnecting={isConnecting}
      />
    </>
  )
}
