'use client'

import { AlertTriangle, ChevronRight, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button, Card, CardContent, Checkbox, Separator } from '@louez/ui'
import { cn } from '@louez/utils'

import type { AvailabilityWarning, ReservationCalculations } from '../types'

interface EditReservationSummarySectionProps {
  availabilityWarnings: AvailabilityWarning[]
  originalSubtotal: number
  originalDeposit: number
  originalDeliveryFee: number
  calculations: ReservationCalculations
  deliveryFee: number
  currencySymbol: string
  isLoading: boolean
  isDeliveryCalculating: boolean
  hasChanges: boolean
  notifyCustomerByEmail: boolean
  onNotifyCustomerByEmailChange: (checked: boolean) => void
  hasScheduleChanges: boolean
  onSave: () => void
}

export function EditReservationSummarySection({
  availabilityWarnings,
  originalSubtotal,
  originalDeposit,
  originalDeliveryFee,
  calculations,
  deliveryFee,
  currencySymbol,
  isLoading,
  isDeliveryCalculating,
  hasChanges,
  notifyCustomerByEmail,
  onNotifyCustomerByEmailChange,
  hasScheduleChanges,
  onSave,
}: EditReservationSummarySectionProps) {
  const t = useTranslations('dashboard.reservations')

  const newTotal = calculations.subtotal + deliveryFee
  const originalTotal = originalSubtotal + originalDeliveryFee
  const difference = newTotal - originalTotal

  const scrollToFirstConflict = () => {
    const target = document.getElementById(
      `edit-item-product-${availabilityWarnings[0]?.productId}`,
    )
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    target?.scrollIntoView({
      behavior: reducedMotion ? 'auto' : 'smooth',
      block: 'center',
    })
  }

  return (
    <Card className="lg:sticky lg:top-24">
      <CardContent className="p-4 sm:p-6">
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

        {availabilityWarnings.length > 0 && (
          <>
            <Separator className="my-4" />
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  {t('edit.availabilityConflicts', {
                    count: availabilityWarnings.length,
                  })}
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 px-2 text-xs"
                onClick={scrollToFirstConflict}
              >
                {t('edit.seeConflict')}
              </Button>
            </div>
          </>
        )}

        <Separator className="my-4" />

        <label
          htmlFor="notifyCustomerByEmailSummary"
          className={cn(
            'flex items-start gap-3 rounded-lg border p-3 text-sm',
            hasChanges ? 'cursor-pointer bg-background' : 'cursor-not-allowed bg-muted/40',
          )}
        >
          <Checkbox
            id="notifyCustomerByEmailSummary"
            checked={notifyCustomerByEmail}
            disabled={!hasChanges || isLoading}
            onCheckedChange={(checked) => onNotifyCustomerByEmailChange(checked === true)}
            className="mt-0.5"
          />
          <span className="space-y-1">
            <span className="block font-medium">{t('edit.notifyCustomerByEmail')}</span>
            <span className="block text-xs text-muted-foreground">
              {hasChanges
                ? hasScheduleChanges
                  ? t('edit.notifyCustomerScheduleHelp')
                  : t('edit.notifyCustomerHelp')
                : t('edit.notifyCustomerDisabledHelp')}
            </span>
          </span>
        </label>

        <Button
          className="mt-6 w-full"
          size="lg"
          onClick={onSave}
          disabled={isLoading || isDeliveryCalculating || !hasChanges}
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
