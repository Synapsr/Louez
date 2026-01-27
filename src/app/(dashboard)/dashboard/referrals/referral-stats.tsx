'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Users, BadgeDollarSign, TrendingUp } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { ReferralStats as Stats } from './actions'

interface ReferralStatsProps {
  stats: Stats
}

export function ReferralStats({ stats }: ReferralStatsProps) {
  const t = useTranslations('dashboard.referrals.stats')

  const cards = [
    {
      title: t('totalReferrals'),
      value: stats.total,
      icon: Users,
    },
    {
      title: t('activePaid'),
      value: stats.activePaid,
      icon: BadgeDollarSign,
    },
    {
      title: t('thisMonth'),
      value: stats.thisMonth,
      icon: TrendingUp,
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
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
