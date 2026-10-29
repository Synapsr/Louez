'use client'

import { AlertCircle, ChevronRight } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Alert, AlertDescription } from '@louez/ui'

type PlanChangeSummaryProps = {
  currentPlanName: string | undefined
  /** The interval the subscription bills now; null when Louez could not read it from Stripe. */
  currentInterval: 'monthly' | 'yearly' | null
  newPlanName: string
  /** The new plan's price, formatted, discount included. */
  newPlanPrice: string
  interval: 'monthly' | 'yearly'
  /** Why the last confirmation failed, translated, such as a declined card. */
  error?: string | null
}

/**
 * The plan change dialog's body: the current plan, the new one with its price, when the
 * difference is billed, and why the last confirmation failed. Stripe charges the
 * difference at once (changeSubscriptionPlan). A change of interval starts a new period
 * today: Stripe charges the whole new period, less the unused part of the current one,
 * and the renewal date moves. An unknown current interval gets the plan change's note.
 */
export const PlanChangeSummary = ({
  currentPlanName,
  currentInterval,
  newPlanName,
  newPlanPrice,
  interval,
  error,
}: PlanChangeSummaryProps) => {
  const t = useTranslations('dashboard.settings.subscription')
  const intervalChanges = currentInterval !== null && currentInterval !== interval
  const intervalNote = interval === 'yearly' ? t('changePlanToYearly') : t('changePlanToMonthly')

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
      <p className="text-muted-foreground text-sm">
        {intervalChanges ? intervalNote : t('changePlanProration')}
      </p>
      {error && (
        <Alert variant="error">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
