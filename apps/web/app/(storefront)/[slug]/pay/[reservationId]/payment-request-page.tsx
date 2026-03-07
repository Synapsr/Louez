'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Loader2, CreditCard, Shield } from 'lucide-react'

import { Button } from '@louez/ui'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@louez/ui'
import { Alert, AlertDescription } from '@louez/ui'
import { formatCurrency } from '@louez/utils'
import { initiatePayment } from './actions'

interface PaymentRequestPageProps {
  store: {
    name: string
    slug: string
    logoUrl: string | null
    theme: { primaryColor: string } | null
  }
  reservation: {
    number: string
  }
  paymentRequest: {
    id: string
    amount: number
    currency: string
    description: string
  }
  customerFirstName: string
  token: string
}

export function PaymentRequestPage({
  store,
  reservation,
  paymentRequest,
  customerFirstName,
  token,
}: PaymentRequestPageProps) {
  const t = useTranslations('storefront.pay')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const formattedAmount = formatCurrency(paymentRequest.amount, paymentRequest.currency)

  function handlePay() {
    setError(null)

    startTransition(async () => {
      const result = await initiatePayment({
        paymentRequestId: paymentRequest.id,
        token,
      })

      if ('error' in result) {
        setError(t('errors.generic'))
        return
      }

      window.location.href = result.url
    })
  }

  return (
    <>
      {/* Store branding */}
      <div className="text-center mb-8">
        {store.logoUrl ? (
          <Image
            src={store.logoUrl}
            alt={store.name}
            width={120}
            height={40}
            className="h-10 w-auto mx-auto mb-4 object-contain"
          />
        ) : (
          <h1 className="text-2xl font-bold mb-4">{store.name}</h1>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            {t('amountDue')}
          </CardTitle>
          <CardDescription>
            {t('subtitle', { number: reservation.number })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Amount display */}
          <div className="mb-6 p-4 rounded-lg bg-muted/50 text-center">
            <p className="text-sm text-muted-foreground mb-1">
              {paymentRequest.description}
            </p>
            <p className="text-3xl font-bold">
              {formattedAmount}
            </p>
          </div>

          {/* Greeting */}
          <p className="text-sm text-muted-foreground mb-6">
            {t('greeting', { name: customerFirstName, store: store.name })}
          </p>

          {/* Error message */}
          {error && (
            <Alert variant="error" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Pay button */}
          <Button
            size="lg"
            className="w-full"
            onClick={handlePay}
            disabled={isPending}
            style={{
              backgroundColor: store.theme?.primaryColor || undefined,
            }}
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('redirecting')}
              </>
            ) : (
              <>
                <Shield className="mr-2 h-4 w-4" />
                {t('payButton', { amount: formattedAmount })}
              </>
            )}
          </Button>

          {/* Security note */}
          <p className="text-xs text-center text-muted-foreground mt-4">
            {t('securePayment')}
          </p>
        </CardContent>
      </Card>
    </>
  )
}
