'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Loader2, Lock, CreditCard } from 'lucide-react'

import { Button } from '@louez/ui'
import { Card, CardContent } from '@louez/ui'
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

  const primaryColor = store.theme?.primaryColor || '#18181b'
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
    <div>
      {/* Store branding */}
      <div className="text-center mb-8">
        {store.logoUrl ? (
          <Image
            src={store.logoUrl}
            alt={store.name}
            width={120}
            height={40}
            className="h-10 w-auto mx-auto mb-2 object-contain"
          />
        ) : (
          <h1 className="text-xl font-semibold text-gray-900 mb-2">{store.name}</h1>
        )}
        <p className="text-sm text-gray-500">
          {t('subtitle', { number: reservation.number })}
        </p>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {/* Amount header */}
          <div className="px-6 pt-8 pb-6 text-center border-b border-gray-100">
            <p className="text-sm text-gray-500 mb-1">{t('amountDue')}</p>
            <p className="text-4xl font-bold tracking-tight text-gray-900">
              {formattedAmount}
            </p>
            <p className="text-sm text-gray-500 mt-2">
              {paymentRequest.description}
            </p>
          </div>

          {/* Greeting + Pay button */}
          <div className="px-6 py-6">
            <p className="text-sm text-gray-600 mb-6">
              {t('greeting', { name: customerFirstName, store: store.name })}
            </p>

            {error && (
              <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <Button
              onClick={handlePay}
              disabled={isPending}
              className="w-full h-12 text-base font-medium rounded-xl"
              style={{ backgroundColor: primaryColor }}
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  {t('redirecting')}
                </>
              ) : (
                <>
                  <CreditCard className="mr-2 h-5 w-5" />
                  {t('payButton', { amount: formattedAmount })}
                </>
              )}
            </Button>

            {/* Secure badge */}
            <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-gray-400">
              <Lock className="h-3 w-3" />
              {t('securePayment')}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
