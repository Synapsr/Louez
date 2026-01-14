import { Suspense } from 'react'
import { db } from '@/lib/db'
import { getCurrentStore } from '@/lib/store-context'
import { reservations, reservationItems, products } from '@/lib/db/schema'
import { eq, and, gte, lte, sql, count, desc, sum } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { format, subMonths, subWeeks, startOfMonth, endOfMonth, eachMonthOfInterval, eachWeekOfInterval, startOfWeek, endOfWeek } from 'date-fns'
import { fr } from 'date-fns/locale'
import { getTranslations } from 'next-intl/server'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Euro, TrendingUp, Package, Calendar } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { RevenueChart } from './revenue-chart'
import { TopProductsTable } from './top-products-table'
import { PeriodSelector } from './period-selector'

type Period = 'week' | 'month' | 'quarter' | 'semester' | 'year'

function getPeriodDates(period: Period) {
  const now = new Date()
  switch (period) {
    case 'week':
      return { start: subWeeks(now, 1), monthsBack: 0 }
    case 'month':
      return { start: subMonths(now, 1), monthsBack: 1 }
    case 'quarter':
      return { start: subMonths(now, 3), monthsBack: 3 }
    case 'semester':
      return { start: subMonths(now, 6), monthsBack: 6 }
    case 'year':
      return { start: subMonths(now, 12), monthsBack: 12 }
    default:
      return { start: subMonths(now, 6), monthsBack: 6 }
  }
}

interface StatisticsPageProps {
  searchParams: Promise<{
    period?: string
  }>
}

async function getRevenueByMonth(storeId: string, period: Period) {
  const now = new Date()
  const { monthsBack } = getPeriodDates(period)
  const startDate = subMonths(startOfMonth(now), Math.max(monthsBack - 1, 0))

  // Get all months in the interval
  const months = eachMonthOfInterval({
    start: startDate,
    end: now,
  })

  // Query revenue for each month
  const revenueData = await Promise.all(
    months.map(async (month) => {
      const monthStart = startOfMonth(month)
      const monthEnd = endOfMonth(month)

      const result = await db
        .select({
          total: sql<string>`COALESCE(SUM(${reservations.totalAmount}), 0)`,
          count: count(),
        })
        .from(reservations)
        .where(
          and(
            eq(reservations.storeId, storeId),
            eq(reservations.status, 'completed'),
            gte(reservations.createdAt, monthStart),
            lte(reservations.createdAt, monthEnd)
          )
        )

      return {
        month: format(month, 'MMM yyyy', { locale: fr }),
        revenue: parseFloat(result[0]?.total || '0'),
        reservations: result[0]?.count || 0,
      }
    })
  )

  return revenueData
}

async function getTopProducts(storeId: string, period: Period) {
  const { start } = getPeriodDates(period)

  const topProducts = await db
    .select({
      productId: reservationItems.productId,
      productName: products.name,
      totalQuantity: sql<number>`SUM(${reservationItems.quantity})`,
      totalRevenue: sql<string>`SUM(${reservationItems.totalPrice})`,
      reservationCount: count(),
    })
    .from(reservationItems)
    .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
    .innerJoin(products, eq(reservationItems.productId, products.id))
    .where(
      and(
        eq(reservations.storeId, storeId),
        eq(reservations.status, 'completed'),
        gte(reservations.createdAt, start)
      )
    )
    .groupBy(reservationItems.productId, products.name)
    .orderBy(desc(sql`SUM(${reservationItems.totalPrice})`))
    .limit(10)

  return topProducts
}

async function getGlobalStats(storeId: string) {
  const now = new Date()
  const currentMonthStart = startOfMonth(now)
  const lastMonthStart = startOfMonth(subMonths(now, 1))
  const lastMonthEnd = endOfMonth(subMonths(now, 1))

  // Current month stats
  const currentMonth = await db
    .select({
      revenue: sql<string>`COALESCE(SUM(${reservations.totalAmount}), 0)`,
      count: count(),
    })
    .from(reservations)
    .where(
      and(
        eq(reservations.storeId, storeId),
        eq(reservations.status, 'completed'),
        gte(reservations.createdAt, currentMonthStart)
      )
    )

  // Last month stats
  const lastMonth = await db
    .select({
      revenue: sql<string>`COALESCE(SUM(${reservations.totalAmount}), 0)`,
      count: count(),
    })
    .from(reservations)
    .where(
      and(
        eq(reservations.storeId, storeId),
        eq(reservations.status, 'completed'),
        gte(reservations.createdAt, lastMonthStart),
        lte(reservations.createdAt, lastMonthEnd)
      )
    )

  // Total all time
  const allTime = await db
    .select({
      revenue: sql<string>`COALESCE(SUM(${reservations.totalAmount}), 0)`,
      count: count(),
    })
    .from(reservations)
    .where(
      and(
        eq(reservations.storeId, storeId),
        eq(reservations.status, 'completed')
      )
    )

  // Average order value
  const avgOrderValue = allTime[0]?.count > 0
    ? parseFloat(allTime[0]?.revenue || '0') / allTime[0]?.count
    : 0

  // Calculate growth
  const currentRevenue = parseFloat(currentMonth[0]?.revenue || '0')
  const lastRevenue = parseFloat(lastMonth[0]?.revenue || '0')
  const revenueGrowth = lastRevenue > 0
    ? ((currentRevenue - lastRevenue) / lastRevenue) * 100
    : 0

  return {
    currentMonthRevenue: currentRevenue,
    currentMonthCount: currentMonth[0]?.count || 0,
    lastMonthRevenue: lastRevenue,
    lastMonthCount: lastMonth[0]?.count || 0,
    totalRevenue: parseFloat(allTime[0]?.revenue || '0'),
    totalReservations: allTime[0]?.count || 0,
    avgOrderValue,
    revenueGrowth,
  }
}

function StatCardSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <Skeleton className="h-4 w-24" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-8 w-32" />
        <Skeleton className="mt-2 h-3 w-20" />
      </CardContent>
    </Card>
  )
}

async function StatsCards({ storeId }: { storeId: string }) {
  const t = await getTranslations('dashboard.statistics')
  const stats = await getGlobalStats(storeId)

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {t('revenueThisMonth')}
          </CardTitle>
          <Euro className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {formatCurrency(stats.currentMonthRevenue)}
          </div>
          <p className="text-xs text-muted-foreground">
            {stats.revenueGrowth >= 0 ? '+' : ''}
            {stats.revenueGrowth.toFixed(1)}% {t('vsLastMonth')}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {t('reservationsThisMonth')}
          </CardTitle>
          <Calendar className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.currentMonthCount}</div>
          <p className="text-xs text-muted-foreground">
            {stats.lastMonthCount} {t('lastMonth')}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {t('averageCart')}
          </CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {formatCurrency(stats.avgOrderValue)}
          </div>
          <p className="text-xs text-muted-foreground">
            {t('onReservations', { count: stats.totalReservations })}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {t('totalRevenue')}
          </CardTitle>
          <Euro className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {formatCurrency(stats.totalRevenue)}
          </div>
          <p className="text-xs text-muted-foreground">
            {t('sinceBeginning')}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

async function RevenueChartSection({ storeId, period }: { storeId: string; period: Period }) {
  const data = await getRevenueByMonth(storeId, period)
  return <RevenueChart data={data} />
}

async function TopProductsSection({ storeId, period }: { storeId: string; period: Period }) {
  const products = await getTopProducts(storeId, period)
  return <TopProductsTable products={products} />
}

export default async function StatisticsPage({ searchParams }: StatisticsPageProps) {
  const t = await getTranslations('dashboard.statistics')
  const store = await getCurrentStore()
  const params = await searchParams
  const period = (params.period as Period) || 'semester'

  if (!store) {
    redirect('/onboarding')
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">
            {t('description')}
          </p>
        </div>
        <PeriodSelector />
      </div>

      {/* Stats Cards */}
      <Suspense
        fallback={
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </div>
        }
      >
        <StatsCards storeId={store.id} />
      </Suspense>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Revenue Chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('revenueChart')}</CardTitle>
            <CardDescription>
              {t('revenueChartDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<Skeleton className="h-[300px] w-full" />}>
              <RevenueChartSection storeId={store.id} period={period} />
            </Suspense>
          </CardContent>
        </Card>

        {/* Top Products */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('topProducts.title')}</CardTitle>
            <CardDescription>
              {t('topProducts.description')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<Skeleton className="h-[300px] w-full" />}>
              <TopProductsSection storeId={store.id} period={period} />
            </Suspense>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
