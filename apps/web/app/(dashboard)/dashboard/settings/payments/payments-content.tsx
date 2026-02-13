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
}

export function PaymentsContent({
  stripeAccountId,
  stripeChargesEnabled,
  stripeOnboardingComplete,
  reservationMode,
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
