'use client'

import { format } from 'date-fns'
import { AlertCircle, ChevronRight } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Alert, AlertDescription, Spinner } from '@louez/ui'

import { useFormatLocale } from '@/hooks/use-format-locale'
import { formatCurrency } from '@/lib/utils'

import type { PlanChangePreviewView } from './util.plan-change-preview'

type PlanChangeSummaryProps = {
  currentPlanName: string | undefined
  newPlanName: string
  /** The new plan's price, formatted, discount included. */
  newPlanPrice: string
  interval: 'monthly' | 'yearly'
  /** What Stripe says the change does: the amount charged now, or the day it starts. */
  preview: PlanChangePreviewView
  /** Why the preview or the last confirmation failed, translated, such as a declined card. */
  error?: string | null
}

/**
 * The plan change dialog's body: the current plan, the new one with its price, what
 * Stripe says the change does, and why the last confirmation failed. A change that
 * costs something, or nothing, applies now and Stripe charges the amount shown; one that
 * would leave a credit starts at the end of the paid period (changeSubscriptionPlan).
 */
export const PlanChangeSummary = ({
  currentPlanName,
  newPlanName,
  newPlanPrice,
  interval,
  preview,
  error,
}: PlanChangeSummaryProps) => {
  const t = useTranslations('dashboard.settings.subscription')
  const { intl, dateFns } = useFormatLocale()

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs">{t('currentPlanBadge')}</p>
          <p className="truncate text-sm font-medium">{currentPlanName}</p>
        </div>
        <ChevronRight className="text-muted-foreground h-4 w-4 flex-shrink-0" />
        <div className="min-w-0 text-right">
          <p className="truncate text-sm font-medium">{newPlanName}</p>
          <p className="text-muted-foreground text-xs">
            {newPlanPrice} {t('excludingTax')} / {interval === 'yearly' ? t('year') : t('month')}
          </p>
        </div>
      </div>
      {preview.status === 'loading' && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Spinner className="size-4" />
          {t('changePlanPreviewLoading')}
        </p>
      )}
      {preview.status === 'now' && (
        <p className="text-muted-foreground text-sm">
          {preview.amountDue > 0
            ? t('changePlanChargedNow', {
                amount: formatCurrency(preview.amountDue / 100, preview.currency.toUpperCase(), intl),
              })
            : t('changePlanNothingToPay')}
        </p>
      )}
      {preview.status === 'at_period_end' && (
        <p className="text-muted-foreground text-sm">
          {t('changePlanAtPeriodEnd', {
            date: format(preview.at, 'dd MMMM yyyy', { locale: dateFns }),
          })}
        </p>
      )}
      {error && (
        <Alert variant="error">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
