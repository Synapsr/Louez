'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@louez/ui'
import { Users, BadgeCheck, Gift, Wallet } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { formatCurrency } from '@/lib/utils'
import type { ReferralStats as Stats } from './actions'

interface ReferralStatsProps {
  stats: Stats
}

export function ReferralStats({ stats }: ReferralStatsProps) {
  const t = useTranslations('dashboard.referrals.stats')
  const currency = stats.currency.toUpperCase()

  const earnedValue = formatCurrency(stats.rewardValueCents / 100, currency)
  const remainingValue = formatCurrency(
    stats.freeReservationsRemainingValueCents / 100,
    currency,
  )

  const cards = [
    {
      title: t('totalReferrals'),
      value: stats.total,
      subtitle: null,
      icon: Users,
    },
    {
      title: t('qualified'),
      value: stats.qualified,
      subtitle: null,
      icon: BadgeCheck,
    },
    {
      title: t('freeReservationsEarned'),
      value: stats.freeReservationsEarned,
      subtitle: t('valueEarned', { value: earnedValue }),
      icon: Gift,
    },
  ]

  return (
    <div className="space-y-4">
      {/* Remaining balance — the "what do I have right now" headline, for impact. */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Wallet className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground">
              {t('remainingTitle')}
            </p>
            <p className="text-3xl font-bold tracking-tight">
              {stats.freeReservationsRemaining}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('valueRemaining', { value: remainingValue })}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.title}
              </CardTitle>
              <card.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tracking-tight">
                {card.value}
              </div>
              {card.subtitle ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {card.subtitle}
                </p>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
