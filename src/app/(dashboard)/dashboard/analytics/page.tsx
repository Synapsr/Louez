import { Suspense } from 'react'
import { db } from '@/lib/db'
import { getCurrentStore } from '@/lib/store-context'
import {
  dailyStats,
  productStats,
  pageViews,
  storefrontEvents,
  reservations,
  products,
} from '@/lib/db/schema'
import { eq, and, gte, lte, sql, desc, count } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import {
  format,
  subDays,
  startOfDay,
  endOfDay,
  eachDayOfInterval,
} from 'date-fns'
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
import { Users, Eye, ShoppingCart, TrendingUp } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'

import { StatCard } from './stat-card'
import { TrendChart, type TrendDataPoint } from './trend-chart'
import { FunnelChart, type FunnelStep } from './funnel-chart'
import { DeviceBreakdown, type DeviceStats } from './device-breakdown'
import { TopProductsAnalytics, type TopProductData } from './top-products-analytics'
import { PeriodFilter, type Period } from './period-filter'

interface AnalyticsPageProps {
  searchParams: Promise<{
    period?: string
  }>
}

function getPeriodDays(period: Period): number {
  switch (period) {
    case '7d':
      return 7
    case '30d':
      return 30
    case '90d':
      return 90
    default:
      return 30
  }
}

// Get aggregated stats for the period
async function getAnalyticsStats(storeId: string, period: Period) {
  const days = getPeriodDays(period)
  const now = new Date()
  const startDate = startOfDay(subDays(now, days))
  const endDate = endOfDay(now)

  // Previous period for comparison
  const prevStartDate = startOfDay(subDays(startDate, days))
  const prevEndDate = startOfDay(startDate)

  // Current period stats from dailyStats
  const currentStats = await db
    .select({
      pageViews: sql<number>`COALESCE(SUM(${dailyStats.pageViews}), 0)`,
      uniqueVisitors: sql<number>`COALESCE(SUM(${dailyStats.uniqueVisitors}), 0)`,
      productViews: sql<number>`COALESCE(SUM(${dailyStats.productViews}), 0)`,
      cartAdditions: sql<number>`COALESCE(SUM(${dailyStats.cartAdditions}), 0)`,
      checkoutStarted: sql<number>`COALESCE(SUM(${dailyStats.checkoutStarted}), 0)`,
      checkoutCompleted: sql<number>`COALESCE(SUM(${dailyStats.checkoutCompleted}), 0)`,
      revenue: sql<string>`COALESCE(SUM(${dailyStats.revenue}), 0)`,
      mobileVisitors: sql<number>`COALESCE(SUM(${dailyStats.mobileVisitors}), 0)`,
      tabletVisitors: sql<number>`COALESCE(SUM(${dailyStats.tabletVisitors}), 0)`,
      desktopVisitors: sql<number>`COALESCE(SUM(${dailyStats.desktopVisitors}), 0)`,
    })
    .from(dailyStats)
    .where(
      and(
        eq(dailyStats.storeId, storeId),
        gte(dailyStats.date, startDate),
        lte(dailyStats.date, endDate)
      )
    )

  // Previous period stats for comparison
  const prevStats = await db
    .select({
      uniqueVisitors: sql<number>`COALESCE(SUM(${dailyStats.uniqueVisitors}), 0)`,
      productViews: sql<number>`COALESCE(SUM(${dailyStats.productViews}), 0)`,
      checkoutCompleted: sql<number>`COALESCE(SUM(${dailyStats.checkoutCompleted}), 0)`,
      revenue: sql<string>`COALESCE(SUM(${dailyStats.revenue}), 0)`,
    })
    .from(dailyStats)
    .where(
      and(
        eq(dailyStats.storeId, storeId),
        gte(dailyStats.date, prevStartDate),
        lte(dailyStats.date, prevEndDate)
      )
    )

  const current = currentStats[0]
  const prev = prevStats[0]

  // Calculate changes
  const visitorsChange = prev?.uniqueVisitors > 0
    ? ((current?.uniqueVisitors - prev?.uniqueVisitors) / prev?.uniqueVisitors) * 100
    : 0
  const viewsChange = prev?.productViews > 0
    ? ((current?.productViews - prev?.productViews) / prev?.productViews) * 100
    : 0
  const conversionsChange = prev?.checkoutCompleted > 0
    ? ((current?.checkoutCompleted - prev?.checkoutCompleted) / prev?.checkoutCompleted) * 100
    : 0
  const revenueChange = parseFloat(prev?.revenue || '0') > 0
    ? ((parseFloat(current?.revenue || '0') - parseFloat(prev?.revenue || '0')) / parseFloat(prev?.revenue || '0')) * 100
    : 0

  // Calculate conversion rate
  const conversionRate = current?.uniqueVisitors > 0
    ? (current?.checkoutCompleted / current?.uniqueVisitors) * 100
    : 0
  const prevConversionRate = prev?.uniqueVisitors > 0
    ? (prev?.checkoutCompleted / prev?.uniqueVisitors) * 100
    : 0
  const conversionRateChange = prevConversionRate > 0
    ? conversionRate - prevConversionRate
    : 0

  return {
    visitors: current?.uniqueVisitors || 0,
    visitorsChange,
    productViews: current?.productViews || 0,
    viewsChange,
    conversions: current?.checkoutCompleted || 0,
    conversionsChange,
    conversionRate,
    conversionRateChange,
    revenue: parseFloat(current?.revenue || '0'),
    revenueChange,
    devices: {
      mobile: current?.mobileVisitors || 0,
      tablet: current?.tabletVisitors || 0,
      desktop: current?.desktopVisitors || 0,
    } as DeviceStats,
    funnel: [
      { label: 'Visiteurs', value: current?.uniqueVisitors || 0 },
      { label: 'Vues produits', value: current?.productViews || 0 },
      { label: 'Ajouts panier', value: current?.cartAdditions || 0 },
      { label: 'Commandes', value: current?.checkoutCompleted || 0 },
    ] as FunnelStep[],
  }
}

// Get daily trend data
async function getTrendData(storeId: string, period: Period): Promise<TrendDataPoint[]> {
  const days = getPeriodDays(period)
  const now = new Date()
  const startDate = startOfDay(subDays(now, days - 1))

  // Get all days in the interval
  const allDays = eachDayOfInterval({ start: startDate, end: now })

  // Query daily stats
  const stats = await db
    .select({
      date: dailyStats.date,
      visitors: dailyStats.uniqueVisitors,
      pageViews: dailyStats.pageViews,
      conversions: dailyStats.checkoutCompleted,
    })
    .from(dailyStats)
    .where(
      and(
        eq(dailyStats.storeId, storeId),
        gte(dailyStats.date, startDate)
      )
    )
    .orderBy(dailyStats.date)

  // Create a map for quick lookup
  const statsMap = new Map(
    stats.map((s) => [format(s.date, 'yyyy-MM-dd'), s])
  )

  // Fill in all days, even those without data
  return allDays.map((day) => {
    const key = format(day, 'yyyy-MM-dd')
    const stat = statsMap.get(key)
    return {
      date: key,
      label: format(day, days > 30 ? 'dd/MM' : 'EEE dd', { locale: fr }),
      visitors: stat?.visitors || 0,
      pageViews: stat?.pageViews || 0,
      conversions: stat?.conversions || 0,
    }
  })
}

// Get top products by views
async function getTopProducts(storeId: string, period: Period): Promise<TopProductData[]> {
  const days = getPeriodDays(period)
  const startDate = startOfDay(subDays(new Date(), days))

  const topProducts = await db
    .select({
      productId: productStats.productId,
      productName: products.name,
      views: sql<number>`COALESCE(SUM(${productStats.views}), 0)`,
      cartAdditions: sql<number>`COALESCE(SUM(${productStats.cartAdditions}), 0)`,
      conversions: sql<number>`COALESCE(SUM(${productStats.reservations}), 0)`,
    })
    .from(productStats)
    .innerJoin(products, eq(productStats.productId, products.id))
    .where(
      and(
        eq(productStats.storeId, storeId),
        gte(productStats.date, startDate)
      )
    )
    .groupBy(productStats.productId, products.name)
    .orderBy(desc(sql`SUM(${productStats.views})`))
    .limit(10)

  return topProducts
}

// Fallback: Get stats from raw events if dailyStats is empty
async function getRawEventStats(storeId: string, period: Period) {
  const days = getPeriodDays(period)
  const startDate = startOfDay(subDays(new Date(), days))

  // Count page views
  const pageViewsResult = await db
    .select({ count: count() })
    .from(pageViews)
    .where(
      and(
        eq(pageViews.storeId, storeId),
        gte(pageViews.createdAt, startDate)
      )
    )

  // Count unique sessions
  const uniqueVisitorsResult = await db
    .select({ count: sql<number>`COUNT(DISTINCT ${pageViews.sessionId})` })
    .from(pageViews)
    .where(
      and(
        eq(pageViews.storeId, storeId),
        gte(pageViews.createdAt, startDate)
      )
    )

  // Count product views
  const productViewsResult = await db
    .select({ count: count() })
    .from(pageViews)
    .where(
      and(
        eq(pageViews.storeId, storeId),
        eq(pageViews.page, 'product'),
        gte(pageViews.createdAt, startDate)
      )
    )

  // Count cart additions
  const cartAdditionsResult = await db
    .select({ count: count() })
    .from(storefrontEvents)
    .where(
      and(
        eq(storefrontEvents.storeId, storeId),
        eq(storefrontEvents.eventType, 'add_to_cart'),
        gte(storefrontEvents.createdAt, startDate)
      )
    )

  // Count completed checkouts
  const checkoutsResult = await db
    .select({ count: count() })
    .from(storefrontEvents)
    .where(
      and(
        eq(storefrontEvents.storeId, storeId),
        eq(storefrontEvents.eventType, 'checkout_completed'),
        gte(storefrontEvents.createdAt, startDate)
      )
    )

  // Get device breakdown
  const deviceStats = await db
    .select({
      device: pageViews.device,
      count: sql<number>`COUNT(DISTINCT ${pageViews.sessionId})`,
    })
    .from(pageViews)
    .where(
      and(
        eq(pageViews.storeId, storeId),
        gte(pageViews.createdAt, startDate)
      )
    )
    .groupBy(pageViews.device)

  const devices: DeviceStats = { mobile: 0, tablet: 0, desktop: 0 }
  deviceStats.forEach((d) => {
    if (d.device && d.device in devices) {
      devices[d.device as keyof DeviceStats] = d.count
    }
  })

  const visitors = uniqueVisitorsResult[0]?.count || 0
  const checkouts = checkoutsResult[0]?.count || 0
  const conversionRate = visitors > 0 ? (checkouts / visitors) * 100 : 0

  return {
    visitors,
    visitorsChange: 0,
    productViews: productViewsResult[0]?.count || 0,
    viewsChange: 0,
    conversions: checkouts,
    conversionsChange: 0,
    conversionRate,
    conversionRateChange: 0,
    revenue: 0,
    revenueChange: 0,
    devices,
    funnel: [
      { label: 'Visiteurs', value: visitors },
      { label: 'Vues produits', value: productViewsResult[0]?.count || 0 },
      { label: 'Ajouts panier', value: cartAdditionsResult[0]?.count || 0 },
      { label: 'Commandes', value: checkouts },
    ] as FunnelStep[],
  }
}

// Skeleton components
function StatCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-6">
        <Skeleton className="h-4 w-24 mb-2" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="mt-3 h-5 w-20" />
      </CardContent>
    </Card>
  )
}

// Server components for data sections
async function StatsSection({ storeId, period }: { storeId: string; period: Period }) {
  const t = await getTranslations('dashboard.analytics')

  // Try aggregated stats first, fallback to raw events
  let stats = await getAnalyticsStats(storeId, period)

  // If no aggregated data, try raw events
  if (stats.visitors === 0 && stats.productViews === 0) {
    stats = await getRawEventStats(storeId, period)
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        title={t('visitors')}
        value={stats.visitors.toLocaleString()}
        change={stats.visitorsChange}
        changeLabel={t('vsPreviousPeriod')}
        icon={Users}
        iconColor="blue"
      />
      <StatCard
        title={t('productViews')}
        value={stats.productViews.toLocaleString()}
        change={stats.viewsChange}
        changeLabel={t('vsPreviousPeriod')}
        icon={Eye}
        iconColor="purple"
      />
      <StatCard
        title={t('conversionRate')}
        value={`${stats.conversionRate.toFixed(1)}%`}
        change={stats.conversionRateChange}
        changeLabel={t('vsPreviousPeriod')}
        icon={ShoppingCart}
        iconColor="green"
      />
      <StatCard
        title={t('revenue')}
        value={formatCurrency(stats.revenue)}
        change={stats.revenueChange}
        changeLabel={t('vsPreviousPeriod')}
        icon={TrendingUp}
        iconColor="orange"
      />
    </div>
  )
}

async function TrendChartSection({ storeId, period }: { storeId: string; period: Period }) {
  const data = await getTrendData(storeId, period)
  return <TrendChart data={data} />
}

async function FunnelSection({ storeId, period }: { storeId: string; period: Period }) {
  const t = await getTranslations('dashboard.analytics')
  let stats = await getAnalyticsStats(storeId, period)

  if (stats.visitors === 0) {
    stats = await getRawEventStats(storeId, period)
  }

  // Translate funnel labels
  const funnel: FunnelStep[] = [
    { label: t('funnel.visitors'), value: stats.funnel[0]?.value || 0 },
    { label: t('funnel.productViews'), value: stats.funnel[1]?.value || 0 },
    { label: t('funnel.cartAdditions'), value: stats.funnel[2]?.value || 0 },
    { label: t('funnel.orders'), value: stats.funnel[3]?.value || 0 },
  ]

  return <FunnelChart steps={funnel} />
}

async function DeviceSection({ storeId, period }: { storeId: string; period: Period }) {
  let stats = await getAnalyticsStats(storeId, period)

  if (stats.visitors === 0) {
    stats = await getRawEventStats(storeId, period)
  }

  return <DeviceBreakdown data={stats.devices} />
}

async function TopProductsSection({ storeId, period }: { storeId: string; period: Period }) {
  const products = await getTopProducts(storeId, period)
  return <TopProductsAnalytics products={products} />
}

export default async function AnalyticsPage({ searchParams }: AnalyticsPageProps) {
  const t = await getTranslations('dashboard.analytics')
  const store = await getCurrentStore()
  const params = await searchParams
  const period = (params.period as Period) || '30d'

  if (!store) {
    redirect('/onboarding')
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        <PeriodFilter />
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
        <StatsSection storeId={store.id} period={period} />
      </Suspense>

      {/* Charts Grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Trend Chart - 2 columns */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('trafficTrend')}</CardTitle>
            <CardDescription>{t('trafficTrendDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<Skeleton className="h-[350px] w-full" />}>
              <TrendChartSection storeId={store.id} period={period} />
            </Suspense>
          </CardContent>
        </Card>

        {/* Funnel Chart - 1 column */}
        <Card>
          <CardHeader>
            <CardTitle>{t('conversionFunnel')}</CardTitle>
            <CardDescription>{t('conversionFunnelDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<Skeleton className="h-[280px] w-full" />}>
              <FunnelSection storeId={store.id} period={period} />
            </Suspense>
          </CardContent>
        </Card>
      </div>

      {/* Bottom Grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Top Products - 2 columns */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('topProducts')}</CardTitle>
            <CardDescription>{t('topProductsDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<Skeleton className="h-[300px] w-full" />}>
              <TopProductsSection storeId={store.id} period={period} />
            </Suspense>
          </CardContent>
        </Card>

        {/* Device Breakdown - 1 column */}
        <Card>
          <CardHeader>
            <CardTitle>{t('devices')}</CardTitle>
            <CardDescription>{t('devicesDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<Skeleton className="h-[200px] w-full" />}>
              <DeviceSection storeId={store.id} period={period} />
            </Suspense>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
