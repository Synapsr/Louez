'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  CheckCircle,
  Clock,
  CreditCard,
  Loader2,
  Wifi,
} from 'lucide-react'

import { Badge } from '@louez/ui'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@louez/ui'
import { getCurrencySymbol } from '@louez/utils'

import { formatStoreDate } from '@/lib/utils/store-date'
import { useStoreTimezone } from '@/contexts/store-context'
import { getReservationPaymentMethod } from '../actions'

interface Payment {
  id: string
  amount: string
  type: 'rental' | 'deposit' | 'deposit_return' | 'damage' | 'deposit_hold' | 'deposit_capture' | 'adjustment'
  method: 'stripe' | 'cash' | 'card' | 'transfer' | 'check' | 'other'
  status: 'pending' | 'completed' | 'failed' | 'refunded' | 'authorized' | 'cancelled'
  paidAt: Date | null
  stripeChargeId: string | null
  stripePaymentIntentId: string | null
  stripeCheckoutSessionId: string | null
}

interface PaymentMethodInfo {
  id: string
  brand: string | null
  last4: string | null
  expMonth: number | null
  expYear: number | null
}

interface OnlinePaymentStatusProps {
  reservationId: string
  payments: Payment[]
  stripePaymentMethodId: string | null
  depositStatus: string | null
  currency?: string
}

const CARD_BRANDS: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  diners: 'Diners Club',
  jcb: 'JCB',
  unionpay: 'UnionPay',
}

export function OnlinePaymentStatus({
  reservationId,
  payments,
  stripePaymentMethodId,
  depositStatus,
  currency = 'EUR',
}: OnlinePaymentStatusProps) {
  const t = useTranslations('dashboard.reservations.onlinePayment')
  const timezone = useStoreTimezone()
  const currencySymbol = getCurrencySymbol(currency)

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodInfo | null>(null)

  // Find Stripe rental payment (completed or pending)
  const stripeRentalPayment = payments.find(
    (p) => p.method === 'stripe' && p.type === 'rental' && p.status === 'completed'
  )
  const stripePendingPayment = payments.find(
    (p) => p.method === 'stripe' && p.type === 'rental' && p.status === 'pending'
  )

  // Determine if we should show anything
  const hasStripePayment = stripeRentalPayment || stripePendingPayment

  // Fetch payment method details (must be called before any conditional returns)
  useEffect(() => {
    if (stripePaymentMethodId && hasStripePayment) {
      getReservationPaymentMethod(reservationId).then(setPaymentMethod)
    }
  }, [reservationId, stripePaymentMethodId, hasStripePayment])

  // If no Stripe payment at all, don't render
  if (!hasStripePayment) {
    return null
  }

  // Payment is pending - show waiting state
  if (stripePendingPayment && !stripeRentalPayment) {
    const paymentAmount = parseFloat(stripePendingPayment.amount)

    return (
      <Card className="border-amber-200 dark:border-amber-800 bg-gradient-to-br from-amber-50/50 to-white dark:from-amber-950/20 dark:to-background">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Wifi className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              {t('title')}
            </CardTitle>
            <Badge
              variant="secondary"
              className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
            >
              <Clock className="h-3 w-3 mr-1" />
              {t('pending')}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {/* Payment in progress */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-white dark:bg-background border border-amber-200 dark:border-amber-800">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-amber-100 dark:bg-amber-900/30">
                <Loader2 className="h-4 w-4 text-amber-600 dark:text-amber-400 animate-spin" />
              </div>
              <div>
                <p className="text-sm font-medium">{t('paymentInProgress')}</p>
                <p className="text-xs text-muted-foreground">{t('paymentInProgressDescription')}</p>
              </div>
            </div>
            <p className="text-lg font-semibold text-amber-700 dark:text-amber-400">
              {paymentAmount.toFixed(2)}{currencySymbol}
            </p>
          </div>

          {/* Checkout session info */}
          {stripePendingPayment.stripeCheckoutSessionId && (
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground">
                Session: <span className="font-mono text-[10px]">{stripePendingPayment.stripeCheckoutSessionId.slice(0, 20)}...</span>
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  // Payment completed
  if (stripeRentalPayment) {
    const paymentAmount = parseFloat(stripeRentalPayment.amount)
    const paymentDate = stripeRentalPayment.paidAt
      ? formatStoreDate(new Date(stripeRentalPayment.paidAt), timezone, 'DATE_AT_TIME')
      : null

    const hasCardSaved = !!stripePaymentMethodId && depositStatus !== 'pending'

    return (
      <Card className="border-emerald-200 dark:border-emerald-800 bg-gradient-to-br from-emerald-50/50 to-white dark:from-emerald-950/20 dark:to-background">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Wifi className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              {t('title')}
            </CardTitle>
            <Badge
              variant="secondary"
              className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
            >
              <CheckCircle className="h-3 w-3 mr-1" />
              {t('received')}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {/* Payment amount and date */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-white dark:bg-background border">
            <div>
              <p className="text-sm text-muted-foreground">{t('rentalPayment')}</p>
              <p className="text-lg font-semibold text-emerald-700 dark:text-emerald-400">
                {paymentAmount.toFixed(2)}{currencySymbol}
              </p>
            </div>
            {paymentDate && (
              <div className="text-right">
                <p className="text-xs text-muted-foreground">{t('paidOn')}</p>
                <p className="text-sm">{paymentDate}</p>
              </div>
            )}
          </div>

          {/* Saved card info */}
          {paymentMethod && hasCardSaved && (
            <div className="flex items-center justify-between p-3 rounded-lg bg-white dark:bg-background border">
              <div className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">
                    {CARD_BRANDS[paymentMethod.brand || ''] || paymentMethod.brand}
                    {' '}
                    <span className="font-mono">****{paymentMethod.last4}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{t('cardSavedForDeposit')}</p>
                </div>
              </div>
              {paymentMethod.expMonth && paymentMethod.expYear && (
                <span className="text-xs text-muted-foreground">
                  {String(paymentMethod.expMonth).padStart(2, '0')}/{String(paymentMethod.expYear).slice(-2)}
                </span>
              )}
            </div>
          )}

          {/* Card not saved warning */}
          {!hasCardSaved && depositStatus === 'pending' && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
              <CreditCard className="h-4 w-4 text-amber-500 shrink-0" />
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {t('cardNotSaved')}
              </p>
            </div>
          )}

          {/* Stripe transaction ID */}
          {stripeRentalPayment.stripePaymentIntentId && (
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground">
                {t('transactionId')}: <span className="font-mono text-[10px]">{stripeRentalPayment.stripePaymentIntentId}</span>
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  return null
}
