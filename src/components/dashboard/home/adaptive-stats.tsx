'use client'

import { useTranslations } from 'next-intl'
import {
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Euro,
  Package,
  Users,
  TrendingUp,
  TrendingDown,
} from 'lucide-react'
import { formatCurrency, cn } from '@/lib/utils'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

// Types imported inline to avoid server-only module
interface StoreMetrics {
  productCount: number
  activeProductCount: number
  draftProductCount: number
  customerCount: number
  newCustomersThisMonth: number
  totalReservations: number
  completedReservations: number
  pendingReservations: number
  confirmedReservations: number
  ongoingReservations: number
  todaysDepartures: number
  todaysReturns: number
  monthlyRevenue: number
  lastMonthRevenue: number
  allTimeRevenue: number
}

type StoreState = 'virgin' | 'building' | 'starting' | 'active' | 'established'

/**
 * Calculate revenue growth percentage
 */
function calculateGrowth(current: number, previous: number): number | null {
  if (previous === 0) {
    return current > 0 ? 100 : null
  }
  return Math.round(((current - previous) / previous) * 100)
}

interface AdaptiveStatsProps {
  metrics: StoreMetrics
  storeState: StoreState
}

interface StatCardProps {
  title: string
  value: string | number
  icon: React.ElementType
  iconColor?: string
  subtitle?: string
  badge?: string
  trend?: number | null
}

function StatCard({
  title,
  value,
  icon: Icon,
  iconColor = 'text-muted-foreground',
  subtitle,
  badge,
  trend,
}: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className={cn('h-4 w-4', iconColor)} />
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold">{value}</span>
          {badge && (
            <Badge
              variant="secondary"
              className="bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
            >
              {badge}
            </Badge>
          )}
          {trend !== null && trend !== undefined && (
            <Badge
              variant="secondary"
              className={cn(
                'gap-0.5',
                trend > 0
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : trend < 0
                    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    : 'bg-muted text-muted-foreground'
              )}
            >
              {trend > 0 ? (
                <TrendingUp className="h-3 w-3" />
              ) : trend < 0 ? (
                <TrendingDown className="h-3 w-3" />
              ) : null}
              {trend > 0 ? '+' : ''}
              {trend}%
            </Badge>
          )}
        </div>
        {subtitle && (
          <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  )
}

export function AdaptiveStats({ metrics, storeState }: AdaptiveStatsProps) {
  const t = useTranslations('dashboard.home')

  // For virgin/building stores, show catalog-focused stats
  if (storeState === 'virgin' || storeState === 'building') {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          title={t('stats.products')}
          value={metrics.activeProductCount}
          icon={Package}
          iconColor="text-primary"
          subtitle={
            metrics.draftProductCount > 0
              ? t('stats.drafts', { count: metrics.draftProductCount })
              : undefined
          }
        />
        <StatCard
          title={t('stats.customers')}
          value={metrics.customerCount}
          icon={Users}
          iconColor="text-blue-500"
        />
      </div>
    )
  }

  // For starting stores, show a mix of operational and growth stats
  if (storeState === 'starting') {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t('stats.todaysDepartures')}
          value={metrics.todaysDepartures}
          icon={ArrowUpRight}
          iconColor="text-emerald-500"
          subtitle={t('stats.toDeliver')}
        />
        <StatCard
          title={t('stats.todaysReturns')}
          value={metrics.todaysReturns}
          icon={ArrowDownRight}
          iconColor="text-blue-500"
          subtitle={t('stats.toRecover')}
        />
        <StatCard
          title={t('stats.pendingRequests')}
          value={metrics.pendingReservations}
          icon={Clock}
          iconColor="text-orange-500"
          badge={
            metrics.pendingReservations > 0 ? t('stats.toProcess') : undefined
          }
        />
        <StatCard
          title={t('stats.totalReservations')}
          value={metrics.totalReservations}
          icon={Package}
          iconColor="text-primary"
          subtitle={t('stats.completed', { count: metrics.completedReservations })}
        />
      </div>
    )
  }

  // For active/established stores, show full operational stats with trends
  const revenueGrowth = calculateGrowth(
    metrics.monthlyRevenue,
    metrics.lastMonthRevenue
  )

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        title={t('stats.todaysDepartures')}
        value={metrics.todaysDepartures}
        icon={ArrowUpRight}
        iconColor="text-emerald-500"
        subtitle={t('stats.toDeliver')}
      />
      <StatCard
        title={t('stats.todaysReturns')}
        value={metrics.todaysReturns}
        icon={ArrowDownRight}
        iconColor="text-blue-500"
        subtitle={t('stats.toRecover')}
      />
      <StatCard
        title={t('stats.pendingRequests')}
        value={metrics.pendingReservations}
        icon={Clock}
        iconColor="text-orange-500"
        badge={
          metrics.pendingReservations > 0 ? t('stats.toProcess') : undefined
        }
      />
      <StatCard
        title={t('stats.monthlyRevenue')}
        value={formatCurrency(metrics.monthlyRevenue)}
        icon={Euro}
        trend={revenueGrowth}
        subtitle={t('stats.vsLastMonth')}
      />
    </div>
  )
}
