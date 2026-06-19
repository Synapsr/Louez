'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Gift, ArrowRight, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@louez/utils'
import { orpc } from '@/lib/orpc/react'
import { formatCurrency } from '@/lib/utils'

interface ReferralNudgeProps {
  className?: string
}

/**
 * A discreet, dismissible referral nudge surfaced at a satisfaction moment (e.g. once a
 * reservation is fully paid). Links to the referral hub. Niveau B — contextual, not a
 * permanent banner.
 */
export function ReferralNudge({ className }: ReferralNudgeProps) {
  const t = useTranslations('dashboard.referrals.nudge')
  const [dismissed, setDismissed] = useState(false)

  // Self-contained: the nudge fetches its own reward summary over oRPC so it can be dropped
  // anywhere without threading props through the payment UI. It stays hidden until the
  // (cheap, store-scoped) query resolves, so it never flashes a reward-less teaser.
  const { data: summary } = useQuery(
    orpc.dashboard.referral.getRewardSummary.queryOptions({ input: {} }),
  )

  if (dismissed || !summary) return null

  const rewardValue = formatCurrency(
    summary.rewardValueCents / 100,
    summary.currency.toUpperCase(),
  )

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-transparent p-4 dark:border-amber-900/40 dark:from-amber-950/30',
        className
      )}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
        <Gift className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{t('title')}</p>
        <p className="text-xs text-muted-foreground">
          {t('description', {
            count: summary.referrerReward,
            rewardValue,
          })}
        </p>
      </div>
      <Link
        href="/dashboard/referrals"
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/40"
      >
        {t('cta')}
        <ArrowRight className="h-3 w-3" />
      </Link>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="shrink-0 text-muted-foreground/60 transition-colors hover:text-foreground"
        aria-label={t('dismiss')}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
