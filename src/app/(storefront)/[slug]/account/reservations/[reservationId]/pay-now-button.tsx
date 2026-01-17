'use client'

import { useState } from 'react'
import { CreditCard, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { createReservationPaymentSession } from './actions'

interface PayNowButtonProps {
  storeSlug: string
  reservationId: string
}

export function PayNowButton({ storeSlug, reservationId }: PayNowButtonProps) {
  const t = useTranslations('storefront.account')
  const tErrors = useTranslations('errors')
  const [isLoading, setIsLoading] = useState(false)

  const handlePayment = async () => {
    setIsLoading(true)
    try {
      const result = await createReservationPaymentSession(storeSlug, reservationId)

      if (result.error) {
        toast.error(tErrors(result.error))
        setIsLoading(false)
        return
      }

      if (result.paymentUrl) {
        window.location.href = result.paymentUrl
      }
    } catch {
      toast.error(tErrors('paymentSessionError'))
      setIsLoading(false)
    }
  }

  return (
    <Button
      onClick={handlePayment}
      disabled={isLoading}
      className="w-full sm:w-auto"
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <CreditCard className="h-4 w-4 mr-2" />
      )}
      {t('payNow')}
    </Button>
  )
}
