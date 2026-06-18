'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@louez/ui'
import { Users, BadgeCheck, Gift } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { formatCurrency } from '@/lib/utils'
import type { ReferralStats as Stats } from './actions'

interface ReferralStatsProps {
  stats: Stats
}

export function ReferralStats({ stats }: ReferralStatsProps) {
  const t = useTranslations('dashboard.referrals.stats')

  const value = formatCurrency(
    stats.rewardValueCents / 100,
    stats.currency.toUpperCase(),
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
      subtitle: t('valueEarned', { value }),
      icon: Gift,
    },
  ]

  return (
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
            <div className="text-3xl font-bold tracking-tight">{card.value}</div>
            {card.subtitle ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {card.subtitle}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
