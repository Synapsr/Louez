'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

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
        toast.error(tErrors(result.error.replace('errors.', '')))
      } else if (result.url) {
        window.location.href = result.url
      }
    } catch {
      toast.error(tErrors('generic'))
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
