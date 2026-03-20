'use client'

import { ChevronRight, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button, Card, CardContent, Separator } from '@louez/ui'
import { cn } from '@louez/utils'

import type { ReservationCalculations } from '../types'

interface EditReservationSummarySectionProps {
  originalSubtotal: number
  originalDeposit: number
  originalDeliveryFee: number
  calculations: ReservationCalculations
  deliveryFee: number
  currencySymbol: string
  isLoading: boolean
  hasChanges: boolean
  onSave: () => void
}

export function EditReservationSummarySection({
  originalSubtotal,
  originalDeposit,
  originalDeliveryFee,
  calculations,
  deliveryFee,
  currencySymbol,
  isLoading,
  hasChanges,
  onSave,
}: EditReservationSummarySectionProps) {
  const t = useTranslations('dashboard.reservations')

  const newTotal = calculations.subtotal + deliveryFee
  const originalTotal = originalSubtotal + originalDeliveryFee
  const difference = newTotal - originalTotal

  return (
    <Card className="sticky top-24">
      <CardContent className="p-6">
        <h2 className="mb-4 text-sm font-medium text-muted-foreground">{t('edit.summary')}</h2>

        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t('edit.before')}</span>
            <span>
              {originalSubtotal.toFixed(2)}
              {currencySymbol}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t('edit.after')}</span>
            <span className="font-medium">
              {calculations.subtotal.toFixed(2)}
              {currencySymbol}
            </span>
          </div>

          {calculations.totalSavings > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-emerald-600">{t('edit.delivery.savings')}</span>
              <span className="text-emerald-600">
                -{calculations.totalSavings.toFixed(2)}
                {currencySymbol}
              </span>
            </div>
          )}

          {(deliveryFee > 0 || originalDeliveryFee > 0) && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t('edit.delivery.deliveryFee')}</span>
              <span>
                {originalDeliveryFee !== deliveryFee && originalDeliveryFee > 0 ? (
                  <>
                    <span className="mr-2 text-muted-foreground line-through">
                      {originalDeliveryFee.toFixed(2)}
                    </span>
                    {deliveryFee.toFixed(2)}
                    {currencySymbol}
                  </>
                ) : (
                  <>
                    {deliveryFee.toFixed(2)}
                    {currencySymbol}
                  </>
                )}
              </span>
            </div>
          )}

          <Separator />

          <div className="flex justify-between">
            <span className="font-medium">{t('edit.difference')}</span>
            <span
              className={cn(
                'text-lg font-bold',
                difference > 0 && 'text-emerald-600',
                difference < 0 && 'text-red-600'
              )}
            >
              {difference >= 0 ? '+' : ''}
              {difference.toFixed(2)}
              {currencySymbol}
            </span>
          </div>

          {difference !== 0 && (
            <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
              {difference > 0
                ? t('edit.adjustmentPositive', {
                    amount: `${difference.toFixed(2)}${currencySymbol}`,
                  })
                : t('edit.adjustmentNegative', {
                    amount: `${Math.abs(difference).toFixed(2)}${currencySymbol}`,
                  })}
            </p>
          )}

          <Separator />

          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t('edit.deposit')}</span>
            <span>
              {originalDeposit !== calculations.deposit ? (
                <>
                  <span className="mr-2 text-muted-foreground line-through">
                    {originalDeposit.toFixed(2)}
                  </span>
                  {calculations.deposit.toFixed(2)}
                  {currencySymbol}
                </>
              ) : (
                <>
                  {calculations.deposit.toFixed(2)}
                  {currencySymbol}
                </>
              )}
            </span>
          </div>
        </div>

        <Button
          className="mt-6 w-full"
          size="lg"
          onClick={onSave}
          disabled={isLoading || !hasChanges}
        >
          {isLoading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ChevronRight className="mr-2 h-4 w-4" />
          )}
          {t('edit.save')}
        </Button>
      </CardContent>
    </Card>
  )
}
