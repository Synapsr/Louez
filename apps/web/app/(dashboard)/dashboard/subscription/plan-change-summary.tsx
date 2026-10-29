'use client'

import { ChevronRight } from 'lucide-react'
import { useTranslations } from 'next-intl'

type PlanChangeSummaryProps = {
  currentPlanName: string | undefined
  newPlanName: string
  /** The new plan's price, formatted, discount included. */
  newPlanPrice: string
  interval: 'monthly' | 'yearly'
}

/**
 * The plan change dialog's body: the current plan, the new one with its price, and when
 * the difference is billed. Stripe charges it at once (changeSubscriptionPlan).
 */
export const PlanChangeSummary = ({
  currentPlanName,
  newPlanName,
  newPlanPrice,
  interval,
}: PlanChangeSummaryProps) => {
  const t = useTranslations('dashboard.settings.subscription')

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
      <p className="text-muted-foreground text-sm">{t('changePlanProration')}</p>
    </div>
  )
}
