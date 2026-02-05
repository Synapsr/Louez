'use client'

import { Check, AlertCircle, XCircle, Wallet } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Badge } from '@louez/ui'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@louez/ui'
import { cn, getCurrencySymbol } from '@louez/utils'

interface PaymentStatusBadgeProps {
  rentalAmount: number
  rentalPaid: number
  depositAmount: number
  depositCollected: number
  depositReturned: number
  className?: string
  showDetails?: boolean
  currency?: string
}

export function PaymentStatusBadge({
  rentalAmount,
  rentalPaid,
  depositAmount,
  depositCollected,
  depositReturned,
  className,
  showDetails = true,
  currency = 'EUR',
}: PaymentStatusBadgeProps) {
  const t = useTranslations('dashboard.reservations')
  const currencySymbol = getCurrencySymbol(currency)

  const isRentalFullyPaid = rentalPaid >= rentalAmount
  const isDepositFullyCollected = depositCollected >= depositAmount
  const depositToReturn = depositCollected - depositReturned
  const isDepositFullyReturned = depositToReturn <= 0 && depositCollected > 0

  // Calcul du statut global de paiement
  const getPaymentStatus = () => {
    if (isRentalFullyPaid && (depositAmount === 0 || isDepositFullyCollected)) {
      return 'paid'
    }
    if (rentalPaid > 0 || depositCollected > 0) {
      return 'partial'
    }
    return 'unpaid'
  }

  const paymentStatus = getPaymentStatus()

  // Calcul du statut de la caution
  const getDepositStatus = () => {
    if (depositAmount === 0) return null
    if (!isDepositFullyCollected) return 'to_collect'
    if (depositToReturn > 0) return 'to_return'
    return 'returned'
  }

  const depositStatus = getDepositStatus()

  const paymentStatusConfig = {
    paid: {
      label: t('paymentBadge.paid'),
      icon: Check,
      className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800',
    },
    partial: {
      label: t('paymentBadge.partial'),
      icon: AlertCircle,
      className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800',
    },
    unpaid: {
      label: t('paymentBadge.unpaid'),
      icon: XCircle,
      className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800',
    },
  }

  const depositStatusConfig = {
    to_collect: {
      label: t('paymentBadge.depositToCollect'),
      className: 'border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400',
    },
    to_return: {
      label: t('paymentBadge.depositToReturn'),
      className: 'border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400',
    },
    returned: {
      label: t('paymentBadge.depositReturned'),
      className: 'border-gray-300 text-gray-500 dark:border-gray-600 dark:text-gray-400',
    },
  }

  const currentPaymentConfig = paymentStatusConfig[paymentStatus]
  const currentDepositConfig = depositStatus ? depositStatusConfig[depositStatus] : null
  const PaymentIcon = currentPaymentConfig.icon

  const tooltipContent = (
    <div className="space-y-1.5 text-xs">
      <div className="flex items-center justify-between gap-4">
        <span>{t('payment.rental')}:</span>
        <span className="font-mono">
          {rentalPaid.toFixed(2)}{currencySymbol} / {rentalAmount.toFixed(2)}{currencySymbol}
        </span>
      </div>
      {depositAmount > 0 && (
        <>
          <div className="flex items-center justify-between gap-4">
            <span>{t('payment.deposit')}:</span>
            <span className="font-mono">
              {depositCollected.toFixed(2)}{currencySymbol} / {depositAmount.toFixed(2)}{currencySymbol}
            </span>
          </div>
          {depositReturned > 0 && (
            <div className="flex items-center justify-between gap-4">
              <span>{t('payment.returned')}:</span>
              <span className="font-mono text-emerald-600">
                -{depositReturned.toFixed(2)}{currencySymbol}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  )

  return (
    <TooltipProvider>
      <div className={cn('flex items-center gap-1.5 flex-wrap', className)}>
        {/* Badge statut paiement principal */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className={cn(
                'cursor-default transition-colors',
                currentPaymentConfig.className
              )}
            >
              <PaymentIcon className="h-3 w-3" />
              {currentPaymentConfig.label}
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            {tooltipContent}
          </TooltipContent>
        </Tooltip>

        {/* Badge statut caution */}
        {showDetails && currentDepositConfig && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className={cn(
                  'cursor-default transition-colors',
                  currentDepositConfig.className
                )}
              >
                <Wallet className="h-3 w-3" />
                {currentDepositConfig.label}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {depositStatus === 'to_collect' && (
                <span>
                  {t('paymentBadge.depositToCollectAmount', {
                    formattedAmount: `${(depositAmount - depositCollected).toFixed(2)}${currencySymbol}`,
                  })}
                </span>
              )}
              {depositStatus === 'to_return' && (
                <span>
                  {t('paymentBadge.depositToReturnAmount', {
                    formattedAmount: `${depositToReturn.toFixed(2)}${currencySymbol}`,
                  })}
                </span>
              )}
              {depositStatus === 'returned' && (
                <span>{t('paymentBadge.depositFullyReturned')}</span>
              )}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  )
}
