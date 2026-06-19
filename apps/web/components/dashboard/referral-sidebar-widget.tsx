'use client'

import Link from 'next/link'
import { Gift } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { Progress } from '@louez/ui'
import { orpc } from '@/lib/orpc/react'

/**
 * Compact sidebar-footer gauge of the store's remaining free reservations, doubling as a
 * CTA to the referral hub (refer to earn more). Self-contained: fetches its own store-scoped
 * summary over oRPC, and stays hidden until it resolves.
 */
export function ReferralSidebarWidget() {
  const t = useTranslations('dashboard.referrals.widget')
  const { data: summary } = useQuery(
    orpc.dashboard.referral.getRewardSummary.queryOptions({ input: {} }),
  )

  if (!summary) return null

  const remaining = summary.freeReservationsRemaining
  const granted = summary.freeReservationsGranted
  const pct =
    granted > 0 ? Math.min(100, Math.round((remaining / granted) * 100)) : 0

  return (
    <Link
      href="/dashboard/referrals"
      className="group border-sidebar-border bg-sidebar-accent/40 hover:bg-sidebar-accent block rounded-lg border px-3 py-2.5 transition-colors"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sidebar-foreground/80 flex items-center gap-1.5 text-xs font-medium">
          <Gift className="h-3.5 w-3.5 text-amber-500" />
          {t('title')}
        </span>
        <span className="text-sidebar-foreground text-sm font-bold tabular-nums">
          {remaining}
        </span>
      </div>
      <Progress value={pct} className="mt-2 h-1.5" />
      <p className="text-sidebar-foreground/60 group-hover:text-sidebar-foreground/80 mt-1.5 text-[11px] transition-colors">
        {t('cta')}
      </p>
    </Link>
  )
}
