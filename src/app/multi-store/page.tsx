import { Suspense } from 'react'
import { unstable_noStore as noStore } from 'next/cache'
import { getTranslations } from 'next-intl/server'

import { getUserStores } from '@/lib/store-context'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

import {
  getMultiStoreMetrics,
  getStorePerformance,
  getStoresApproachingLimits,
  getMultiStoreRevenueTrend,
  type Period,
} from '@/lib/dashboard/multi-store-metrics'

import {
  AggregateStats,
  StoresTable,
  PlanLimitsAlert,
  StoresRevenueChart,
  MultiStorePeriodFilter,
} from './_components'

export const dynamic = 'force-dynamic'

interface MultiStorePageProps {
  searchParams: Promise<{
    period?: string
  }>
}

function StatCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-4 w-20" />
          </div>
          <Skeleton className="h-10 w-10 rounded-lg" />
        </div>
      </CardContent>
    </Card>
  )
}

function TableSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-32" />
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-4 py-2">
              <Skeleton className="h-10 w-10 rounded-full shrink-0" />
              <div className="flex-1">
                <Skeleton className="h-4 w-32" />
              </div>
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-8 w-20" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function ChartSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-56 mt-1" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-[300px] w-full" />
      </CardContent>
    </Card>
  )
}

async function AggregateStatsSection({
  storeIds,
  period,
}: {
  storeIds: string[]
  period: Period
}) {
  const t = await getTranslations('dashboard.multiStore')
  const tAnalytics = await getTranslations('dashboard.analytics')
  const metrics = await getMultiStoreMetrics(storeIds, period)

  return (
    <AggregateStats
      metrics={metrics}
      translations={{
        totalRevenue: t('stats.totalRevenue'),
        reservations: t('stats.reservations'),
        pending: t('stats.pending'),
        customers: t('stats.customers'),
        newCustomers: t('stats.newCustomers'),
      }}
      vsPreviousPeriod={tAnalytics('vsPreviousPeriod')}
    />
  )
}

async function PlanLimitsSection({ storeIds }: { storeIds: string[] }) {
  const t = await getTranslations('dashboard.multiStore')
  const limits = await getStoresApproachingLimits(storeIds, 80)

  if (limits.length === 0) {
    return null
  }

  return (
    <PlanLimitsAlert
      limits={limits}
      translations={{
        title: t('limits.title'),
        description: t('limits.description', { count: limits.length }),
        products: t('limits.products'),
        reservationsPerMonth: t('limits.reservations'),
        customers: t('limits.customers'),
        upgrade: t('limits.upgrade'),
      }}
    />
  )
}

async function StoresTableSection({
  storeIds,
  period,
}: {
  storeIds: string[]
  period: Period
}) {
  const t = await getTranslations('dashboard.multiStore')
  const [performance, limits] = await Promise.all([
    getStorePerformance(storeIds, period),
    getStoresApproachingLimits(storeIds, 80),
  ])

  const limitsMap = limits.reduce(
    (acc, limit) => {
      acc[limit.storeId] = true
      return acc
    },
    {} as Record<string, boolean>
  )

  return (
    <StoresTable
      stores={performance}
      translations={{
        title: t('table.title'),
        store: t('table.store'),
        plan: t('table.plan'),
        revenue: t('table.revenue'),
        change: t('table.change'),
        reservations: t('table.reservations'),
        pending: t('stats.pending'),
        customers: t('table.customers'),
        goToStore: t('table.goToStore'),
      }}
      limitsMap={limitsMap}
    />
  )
}

async function RevenueChartSection({
  storeIds,
  period,
}: {
  storeIds: string[]
  period: Period
}) {
  const t = await getTranslations('dashboard.multiStore')
  const tEmpty = await getTranslations('dashboard.multiStore.empty')
  const { data, storeNames } = await getMultiStoreRevenueTrend(storeIds, period)

  return (
    <StoresRevenueChart
      data={data}
      storeNames={storeNames}
      translations={{
        title: t('chart.title'),
        description: t('chart.description'),
      }}
      emptyMessage={tEmpty('description')}
    />
  )
}

export default async function MultiStorePage({ searchParams }: MultiStorePageProps) {
  noStore()

  const stores = await getUserStores()
  const storeIds = stores.map((s) => s.id)
  const params = await searchParams
  const period = (params.period as Period) || '30d'

  const t = await getTranslations('dashboard.multiStore')

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-muted-foreground">
            {t('description', { count: stores.length })}
          </p>
        </div>
        <MultiStorePeriodFilter />
      </div>

      {/* Aggregate Stats */}
      <Suspense
        fallback={
          <div className="grid gap-4 md:grid-cols-3">
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </div>
        }
      >
        <AggregateStatsSection storeIds={storeIds} period={period} />
      </Suspense>

      {/* Plan Limits Alert */}
      <Suspense fallback={null}>
        <PlanLimitsSection storeIds={storeIds} />
      </Suspense>

      {/* Stores Table */}
      <Suspense fallback={<TableSkeleton />}>
        <StoresTableSection storeIds={storeIds} period={period} />
      </Suspense>

      {/* Revenue Chart */}
      <Suspense fallback={<ChartSkeleton />}>
        <RevenueChartSection storeIds={storeIds} period={period} />
      </Suspense>
    </div>
  )
}
