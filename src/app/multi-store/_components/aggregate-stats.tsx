'use client'

import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/utils'
import {
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Euro,
  Calendar,
  Users,
} from 'lucide-react'
import type { MultiStoreMetrics } from '@/lib/dashboard/multi-store-metrics'

interface AggregateStatsProps {
  metrics: MultiStoreMetrics
  translations: {
    totalRevenue: string
    reservations: string
    pending: string
    customers: string
    newCustomers: string
  }
  vsPreviousPeriod: string
}

interface StatCardProps {
  title: string
  value: string | number
  change?: number
  changeLabel?: string
  icon: React.ComponentType<{ className?: string }>
  iconColor: string
  subtitle?: string
}

function StatCard({
  title,
  value,
  change,
  changeLabel,
  icon: Icon,
  iconColor,
  subtitle,
}: StatCardProps) {
  const isPositive = change !== undefined && change > 0
  const isNegative = change !== undefined && change < 0
  const isNeutral = change === undefined || change === 0

  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold tracking-tight">{value}</p>
            {subtitle && (
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            )}
          </div>
          <div className={cn('rounded-lg bg-muted p-2', iconColor)}>
            <Icon className="h-5 w-5" />
          </div>
        </div>

        {change !== undefined && (
          <div className="mt-3 flex items-center gap-1.5">
            <div
              className={cn(
                'flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium',
                isPositive && 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400',
                isNegative && 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400',
                isNeutral && 'bg-muted text-muted-foreground'
              )}
            >
              {isPositive && <ArrowUpRight className="h-3 w-3" />}
              {isNegative && <ArrowDownRight className="h-3 w-3" />}
              {isNeutral && <Minus className="h-3 w-3" />}
              <span>{isNeutral ? '0' : `${isPositive ? '+' : ''}${change.toFixed(1)}`}%</span>
            </div>
            {changeLabel && (
              <span className="text-xs text-muted-foreground">{changeLabel}</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function AggregateStats({ metrics, translations, vsPreviousPeriod }: AggregateStatsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <StatCard
        title={translations.totalRevenue}
        value={formatCurrency(metrics.totalRevenue)}
        change={metrics.revenueGrowth}
        changeLabel={vsPreviousPeriod}
        icon={Euro}
        iconColor="text-emerald-500"
      />
      <StatCard
        title={translations.reservations}
        value={metrics.totalReservations}
        subtitle={metrics.pendingReservations > 0 ? `(${metrics.pendingReservations} ${translations.pending})` : undefined}
        icon={Calendar}
        iconColor="text-blue-500"
      />
      <StatCard
        title={translations.customers}
        value={metrics.totalCustomers}
        subtitle={metrics.newCustomers > 0 ? `(+${metrics.newCustomers} ${translations.newCustomers})` : undefined}
        icon={Users}
        iconColor="text-purple-500"
      />
    </div>
  )
}
