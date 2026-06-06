import { Suspense } from 'react';

import { unstable_noStore as noStore } from 'next/cache';
import { redirect } from 'next/navigation';

import {
  eachDayOfInterval,
  eachMonthOfInterval,
  endOfDay,
  endOfMonth,
  format,
  startOfDay,
  startOfMonth,
  subDays,
  subMonths,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import { and, count, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { Calendar, CreditCard, Euro, TrendingUp } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { db } from '@louez/db';
import {
  dailyStats,
  pageViews,
  payments,
  productStats,
  products,
  reservationItems,
  reservations,
  storefrontEvents,
} from '@louez/db';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@louez/ui';
import { Skeleton } from '@louez/ui';
import { formatCurrency } from '@louez/utils';

import { getCurrentStore } from '@/lib/store-context';

import { DeviceBreakdown, type DeviceStats } from './device-breakdown';
import { FunnelChart, type FunnelStep } from './funnel-chart';
import { RevenueChart } from './revenue-chart';
import { SalesScopeToggle } from './sales-scope-toggle';
import { StatCard } from './stat-card';
import {
  type TopProductData,
  TopProductsAnalytics,
} from './top-products-analytics';
import { TopProductsTable } from './top-products-table';
import { TrendChart, type TrendDataPoint } from './trend-chart';
import { type Period, UnifiedPeriodFilter } from './unified-period-filter';

// Disable caching for this page - always fetch fresh analytics data
export const dynamic = 'force-dynamic';

interface AnalyticsPageProps {
  searchParams: Promise<{
    period?: string;
    tab?: string;
    includeManual?: string;
  }>;
}

function getPeriodConfig(period: Period) {
  switch (period) {
    case '7d':
      return { days: 7, monthsBack: 0, label: '7 jours' };
    case '30d':
      return { days: 30, monthsBack: 1, label: '30 jours' };
    case '90d':
      return { days: 90, monthsBack: 3, label: '90 jours' };
    case '6m':
      return { days: 180, monthsBack: 6, label: '6 mois' };
    case '12m':
      return { days: 365, monthsBack: 12, label: '12 mois' };
    default:
      return { days: 30, monthsBack: 1, label: '30 jours' };
  }
}

// ============================================
// TRAFFIC ANALYTICS FUNCTIONS
// ============================================

async function getTrafficStats(storeId: string, period: Period) {
  const { days } = getPeriodConfig(period);
  const now = new Date();
  const startDate = startOfDay(subDays(now, days));
  const endDate = endOfDay(now);

  // Previous period for comparison
  const prevStartDate = startOfDay(subDays(startDate, days));
  const prevEndDate = startOfDay(startDate);

  try {
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
          lte(dailyStats.date, endDate),
        ),
      );

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
          lte(dailyStats.date, prevEndDate),
        ),
      );

    const current = currentStats[0];
    const prev = prevStats[0];

    // Calculate changes
    const visitorsChange =
      prev?.uniqueVisitors > 0
        ? ((current?.uniqueVisitors - prev?.uniqueVisitors) /
            prev?.uniqueVisitors) *
          100
        : 0;
    const viewsChange =
      prev?.productViews > 0
        ? ((current?.productViews - prev?.productViews) / prev?.productViews) *
          100
        : 0;
    const conversionsChange =
      prev?.checkoutCompleted > 0
        ? ((current?.checkoutCompleted - prev?.checkoutCompleted) /
            prev?.checkoutCompleted) *
          100
        : 0;
    const revenueChange =
      parseFloat(prev?.revenue || '0') > 0
        ? ((parseFloat(current?.revenue || '0') -
            parseFloat(prev?.revenue || '0')) /
            parseFloat(prev?.revenue || '0')) *
          100
        : 0;

    // Calculate conversion rate
    const conversionRate =
      current?.uniqueVisitors > 0
        ? (current?.checkoutCompleted / current?.uniqueVisitors) * 100
        : 0;
    const prevConversionRate =
      prev?.uniqueVisitors > 0
        ? (prev?.checkoutCompleted / prev?.uniqueVisitors) * 100
        : 0;
    const conversionRateChange =
      prevConversionRate > 0 ? conversionRate - prevConversionRate : 0;

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
    };
  } catch (error) {
    console.error('[Analytics] Error fetching traffic stats:', error);
    // Return default values on error
    return {
      visitors: 0,
      visitorsChange: 0,
      productViews: 0,
      viewsChange: 0,
      conversions: 0,
      conversionsChange: 0,
      conversionRate: 0,
      conversionRateChange: 0,
      revenue: 0,
      revenueChange: 0,
      devices: { mobile: 0, tablet: 0, desktop: 0 } as DeviceStats,
      funnel: [
        { label: 'Visiteurs', value: 0 },
        { label: 'Vues produits', value: 0 },
        { label: 'Ajouts panier', value: 0 },
        { label: 'Commandes', value: 0 },
      ] as FunnelStep[],
    };
  }
}

async function getTrendData(
  storeId: string,
  period: Period,
): Promise<TrendDataPoint[]> {
  const { days } = getPeriodConfig(period);
  const now = new Date();
  const startDate = startOfDay(subDays(now, days - 1));

  // Get all days in the interval
  const allDays = eachDayOfInterval({ start: startDate, end: now });

  try {
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
        and(eq(dailyStats.storeId, storeId), gte(dailyStats.date, startDate)),
      )
      .orderBy(dailyStats.date);

    // Create a map for quick lookup
    const statsMap = new Map(
      stats.map((s) => [format(s.date, 'yyyy-MM-dd'), s]),
    );

    // Fill in all days, even those without data
    return allDays.map((day) => {
      const key = format(day, 'yyyy-MM-dd');
      const stat = statsMap.get(key);
      return {
        date: key,
        label: format(day, days > 30 ? 'dd/MM' : 'EEE dd', { locale: fr }),
        visitors: stat?.visitors || 0,
        pageViews: stat?.pageViews || 0,
        conversions: stat?.conversions || 0,
      };
    });
  } catch (error) {
    console.error('[Analytics] Error fetching trend data:', error);
    // Return empty array with all days showing 0
    return allDays.map((day) => ({
      date: format(day, 'yyyy-MM-dd'),
      label: format(day, days > 30 ? 'dd/MM' : 'EEE dd', { locale: fr }),
      visitors: 0,
      pageViews: 0,
      conversions: 0,
    }));
  }
}

async function getTopProductsByViews(
  storeId: string,
  period: Period,
): Promise<TopProductData[]> {
  const { days } = getPeriodConfig(period);
  const startDate = startOfDay(subDays(new Date(), days));

  try {
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
          gte(productStats.date, startDate),
        ),
      )
      .groupBy(productStats.productId, products.name)
      .orderBy(desc(sql`SUM(${productStats.views})`))
      .limit(10);

    return topProducts;
  } catch (error) {
    console.error('[Analytics] Error fetching top products by views:', error);
    return [];
  }
}

// Fallback: Get stats from raw events if dailyStats is empty
async function getRawEventStats(storeId: string, period: Period) {
  const { days } = getPeriodConfig(period);
  const startDate = startOfDay(subDays(new Date(), days));

  try {
    // Count unique sessions
    const uniqueVisitorsResult = await db
      .select({ count: sql<number>`COUNT(DISTINCT ${pageViews.sessionId})` })
      .from(pageViews)
      .where(
        and(
          eq(pageViews.storeId, storeId),
          gte(pageViews.createdAt, startDate),
        ),
      );

    // Count product views
    const productViewsResult = await db
      .select({ count: count() })
      .from(pageViews)
      .where(
        and(
          eq(pageViews.storeId, storeId),
          eq(pageViews.page, 'product'),
          gte(pageViews.createdAt, startDate),
        ),
      );

    // Count cart additions
    const cartAdditionsResult = await db
      .select({ count: count() })
      .from(storefrontEvents)
      .where(
        and(
          eq(storefrontEvents.storeId, storeId),
          eq(storefrontEvents.eventType, 'add_to_cart'),
          gte(storefrontEvents.createdAt, startDate),
        ),
      );

    // Count completed checkouts
    const checkoutsResult = await db
      .select({ count: count() })
      .from(storefrontEvents)
      .where(
        and(
          eq(storefrontEvents.storeId, storeId),
          eq(storefrontEvents.eventType, 'checkout_completed'),
          gte(storefrontEvents.createdAt, startDate),
        ),
      );

    // Get device breakdown
    const deviceStatsResult = await db
      .select({
        device: pageViews.device,
        count: sql<number>`COUNT(DISTINCT ${pageViews.sessionId})`,
      })
      .from(pageViews)
      .where(
        and(
          eq(pageViews.storeId, storeId),
          gte(pageViews.createdAt, startDate),
        ),
      )
      .groupBy(pageViews.device);

    const devices: DeviceStats = { mobile: 0, tablet: 0, desktop: 0 };
    deviceStatsResult.forEach((d) => {
      if (d.device && d.device in devices) {
        devices[d.device as keyof DeviceStats] = d.count;
      }
    });

    const visitors = uniqueVisitorsResult[0]?.count || 0;
    const checkouts = checkoutsResult[0]?.count || 0;
    const conversionRate = visitors > 0 ? (checkouts / visitors) * 100 : 0;

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
    };
  } catch (error) {
    console.error('[Analytics] Error fetching raw event stats:', error);
    return {
      visitors: 0,
      visitorsChange: 0,
      productViews: 0,
      viewsChange: 0,
      conversions: 0,
      conversionsChange: 0,
      conversionRate: 0,
      conversionRateChange: 0,
      revenue: 0,
      revenueChange: 0,
      devices: { mobile: 0, tablet: 0, desktop: 0 } as DeviceStats,
      funnel: [
        { label: 'Visiteurs', value: 0 },
        { label: 'Vues produits', value: 0 },
        { label: 'Ajouts panier', value: 0 },
        { label: 'Commandes', value: 0 },
      ] as FunnelStep[],
    };
  }
}

// ============================================
// SALES/REVENUE ANALYTICS FUNCTIONS
// ============================================

async function getRevenueStats(
  storeId: string,
  includeManualPayments: boolean,
) {
  const now = new Date();
  const currentMonthStart = startOfMonth(now);
  const lastMonthStart = startOfMonth(subMonths(now, 1));
  const lastMonthEnd = endOfMonth(subMonths(now, 1));

  const getRentalPaymentStats = async (startDate?: Date, endDate?: Date) => {
    const dateConditions = [
      ...(startDate
        ? [
            sql`COALESCE(${payments.paidAt}, ${payments.createdAt}) >= ${startDate}`,
          ]
        : []),
      ...(endDate
        ? [
            sql`COALESCE(${payments.paidAt}, ${payments.createdAt}) <= ${endDate}`,
          ]
        : []),
    ];

    const result = await db
      .select({
        revenue: sql<string>`COALESCE(SUM(${payments.amount}), 0)`,
        paymentCount: count(),
        reservationCount: sql<number>`COUNT(DISTINCT ${payments.reservationId})`,
      })
      .from(payments)
      .innerJoin(reservations, eq(payments.reservationId, reservations.id))
      .where(
        and(
          eq(reservations.storeId, storeId),
          ...(includeManualPayments ? [] : [eq(payments.method, 'stripe')]),
          eq(payments.status, 'completed'),
          eq(payments.type, 'rental'),
          ...dateConditions,
        ),
      );

    return {
      revenue: parseFloat(result[0]?.revenue || '0'),
      paymentCount: result[0]?.paymentCount || 0,
      reservationCount: result[0]?.reservationCount || 0,
    };
  };

  const currentMonth = await getRentalPaymentStats(currentMonthStart);
  const lastMonth = await getRentalPaymentStats(lastMonthStart, lastMonthEnd);
  const allTime = await getRentalPaymentStats();

  const avgOrderValue =
    allTime.paymentCount > 0 ? allTime.revenue / allTime.paymentCount : 0;

  const revenueGrowth =
    lastMonth.revenue > 0
      ? ((currentMonth.revenue - lastMonth.revenue) / lastMonth.revenue) * 100
      : 0;

  return {
    currentMonthRevenue: currentMonth.revenue,
    currentMonthCount: currentMonth.paymentCount,
    lastMonthRevenue: lastMonth.revenue,
    lastMonthCount: lastMonth.paymentCount,
    totalRevenue: allTime.revenue,
    totalPayments: allTime.paymentCount,
    totalReservations: allTime.reservationCount,
    avgOrderValue,
    revenueGrowth,
  };
}

async function getRevenueByMonth(
  storeId: string,
  period: Period,
  includeManualPayments: boolean,
) {
  const now = new Date();
  const { monthsBack } = getPeriodConfig(period);
  const startDate = subMonths(startOfMonth(now), Math.max(monthsBack - 1, 0));

  // Get all months in the interval
  const months = eachMonthOfInterval({
    start: startDate,
    end: now,
  });

  // Query revenue for each month
  const revenueData = await Promise.all(
    months.map(async (month) => {
      const monthStart = startOfMonth(month);
      const monthEnd = endOfMonth(month);

      const result = await db
        .select({
          total: sql<string>`COALESCE(SUM(${payments.amount}), 0)`,
          count: count(),
        })
        .from(payments)
        .innerJoin(reservations, eq(payments.reservationId, reservations.id))
        .where(
          and(
            eq(reservations.storeId, storeId),
            ...(includeManualPayments ? [] : [eq(payments.method, 'stripe')]),
            eq(payments.status, 'completed'),
            eq(payments.type, 'rental'),
            sql`COALESCE(${payments.paidAt}, ${payments.createdAt}) >= ${monthStart}`,
            sql`COALESCE(${payments.paidAt}, ${payments.createdAt}) <= ${monthEnd}`,
          ),
        );

      return {
        month: format(month, 'MMM yyyy', { locale: fr }),
        revenue: parseFloat(result[0]?.total || '0'),
        payments: result[0]?.count || 0,
      };
    }),
  );

  return revenueData;
}

async function getTopProductsByRevenue(
  storeId: string,
  period: Period,
  includeManualPayments: boolean,
) {
  const { days } = getPeriodConfig(period);
  const startDate = subDays(new Date(), days);

  const paymentTotals = db
    .select({
      reservationId: payments.reservationId,
      paidAmount: sql<string>`COALESCE(SUM(${payments.amount}), 0)`.as(
        'paid_amount',
      ),
    })
    .from(payments)
    .innerJoin(reservations, eq(payments.reservationId, reservations.id))
    .where(
      and(
        eq(reservations.storeId, storeId),
        ...(includeManualPayments ? [] : [eq(payments.method, 'stripe')]),
        eq(payments.status, 'completed'),
        eq(payments.type, 'rental'),
        sql`COALESCE(${payments.paidAt}, ${payments.createdAt}) >= ${startDate}`,
      ),
    )
    .groupBy(payments.reservationId)
    .as('payment_totals');

  const reservationItemTotals = db
    .select({
      reservationId: reservationItems.reservationId,
      itemTotal:
        sql<string>`COALESCE(SUM(${reservationItems.totalPrice}), 0)`.as(
          'item_total',
        ),
    })
    .from(reservationItems)
    .groupBy(reservationItems.reservationId)
    .as('reservation_item_totals');

  const topProducts = await db
    .select({
      productId: reservationItems.productId,
      productName: products.name,
      totalQuantity: sql<number>`SUM(${reservationItems.quantity})`,
      totalRevenue: sql<string>`COALESCE(SUM(CASE WHEN ${reservationItemTotals.itemTotal} > 0 THEN (${paymentTotals.paidAmount} * ${reservationItems.totalPrice}) / ${reservationItemTotals.itemTotal} ELSE 0 END), 0)`,
      reservationCount: sql<number>`COUNT(DISTINCT ${reservationItems.reservationId})`,
    })
    .from(reservationItems)
    .innerJoin(
      paymentTotals,
      eq(reservationItems.reservationId, paymentTotals.reservationId),
    )
    .innerJoin(
      reservationItemTotals,
      eq(reservationItems.reservationId, reservationItemTotals.reservationId),
    )
    .innerJoin(products, eq(reservationItems.productId, products.id))
    .groupBy(reservationItems.productId, products.name)
    .orderBy(
      desc(
        sql`SUM(CASE WHEN ${reservationItemTotals.itemTotal} > 0 THEN (${paymentTotals.paidAmount} * ${reservationItems.totalPrice}) / ${reservationItemTotals.itemTotal} ELSE 0 END)`,
      ),
    )
    .limit(10);

  return topProducts;
}

// ============================================
// SKELETON COMPONENTS
// ============================================

function StatCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-6">
        <Skeleton className="mb-2 h-4 w-24" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="mt-3 h-5 w-20" />
      </CardContent>
    </Card>
  );
}

// ============================================
// SERVER COMPONENTS
// ============================================

async function TrafficStatsSection({
  storeId,
  period,
}: {
  storeId: string;
  period: Period;
}) {
  const t = await getTranslations('dashboard.analytics');

  // Try aggregated stats first, fallback to raw events
  let stats = await getTrafficStats(storeId, period);

  // If no aggregated data, try raw events
  // Note: MySQL returns strings for aggregated values, so use Number() for comparison
  if (Number(stats.visitors) === 0 && Number(stats.productViews) === 0) {
    stats = await getRawEventStats(storeId, period);
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        title={t('visitors')}
        value={stats.visitors.toLocaleString()}
        change={stats.visitorsChange}
        changeLabel={t('vsPreviousPeriod')}
        icon="users"
        iconColor="blue"
      />
      <StatCard
        title={t('productViews')}
        value={stats.productViews.toLocaleString()}
        change={stats.viewsChange}
        changeLabel={t('vsPreviousPeriod')}
        icon="eye"
        iconColor="purple"
      />
      <StatCard
        title={t('conversionRate')}
        value={`${stats.conversionRate.toFixed(1)}%`}
        change={stats.conversionRateChange}
        changeLabel={t('vsPreviousPeriod')}
        icon="shopping-cart"
        iconColor="green"
      />
      <StatCard
        title={t('conversions')}
        value={stats.conversions.toLocaleString()}
        change={stats.conversionsChange}
        changeLabel={t('vsPreviousPeriod')}
        icon="trending-up"
        iconColor="orange"
      />
    </div>
  );
}

async function RevenueStatsSection({
  storeId,
  includeManualPayments,
}: {
  storeId: string;
  includeManualPayments: boolean;
}) {
  const t = await getTranslations('dashboard.statistics');
  const stats = await getRevenueStats(storeId, includeManualPayments);

  return (
    <div className="space-y-4">
      <div className="border-primary/20 bg-primary/5 flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="bg-background text-primary rounded-md p-2">
            <CreditCard className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {t(
                includeManualPayments
                  ? 'salesScopeWithManualTitle'
                  : 'salesScopeTitle',
              )}
            </p>
            <p className="text-muted-foreground text-sm">
              {t(
                includeManualPayments
                  ? 'salesScopeWithManualDescription'
                  : 'salesScopeDescription',
              )}
            </p>
          </div>
        </div>
        <SalesScopeToggle includeManualPayments={includeManualPayments} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {t(
                includeManualPayments
                  ? 'revenueThisMonthWithManual'
                  : 'revenueThisMonth',
              )}
            </CardTitle>
            <Euro className="text-muted-foreground h-4 w-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(stats.currentMonthRevenue)}
            </div>
            <p className="text-muted-foreground text-xs">
              {stats.revenueGrowth >= 0 ? '+' : ''}
              {stats.revenueGrowth.toFixed(1)}% {t('vsLastMonth')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {t(
                includeManualPayments
                  ? 'reservationsThisMonthWithManual'
                  : 'reservationsThisMonth',
              )}
            </CardTitle>
            <Calendar className="text-muted-foreground h-4 w-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.currentMonthCount}</div>
            <p className="text-muted-foreground text-xs">
              {stats.lastMonthCount} {t('lastMonth')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {t('averageCart')}
            </CardTitle>
            <TrendingUp className="text-muted-foreground h-4 w-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(stats.avgOrderValue)}
            </div>
            <p className="text-muted-foreground text-xs">
              {t(
                includeManualPayments ? 'onPaymentsWithManual' : 'onPayments',
                {
                  count: stats.totalPayments,
                },
              )}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {t(
                includeManualPayments
                  ? 'totalRevenueWithManual'
                  : 'totalRevenue',
              )}
            </CardTitle>
            <Euro className="text-muted-foreground h-4 w-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(stats.totalRevenue)}
            </div>
            <p className="text-muted-foreground text-xs">
              {t('sinceBeginning')}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

async function TrendChartSection({
  storeId,
  period,
}: {
  storeId: string;
  period: Period;
}) {
  const data = await getTrendData(storeId, period);
  return <TrendChart data={data} />;
}

async function FunnelSection({
  storeId,
  period,
}: {
  storeId: string;
  period: Period;
}) {
  const t = await getTranslations('dashboard.analytics');
  let stats = await getTrafficStats(storeId, period);

  if (stats.visitors === 0) {
    stats = await getRawEventStats(storeId, period);
  }

  // Translate funnel labels
  const funnel: FunnelStep[] = [
    { label: t('funnel.visitors'), value: stats.funnel[0]?.value || 0 },
    { label: t('funnel.productViews'), value: stats.funnel[1]?.value || 0 },
    { label: t('funnel.cartAdditions'), value: stats.funnel[2]?.value || 0 },
    { label: t('funnel.orders'), value: stats.funnel[3]?.value || 0 },
  ];

  return <FunnelChart steps={funnel} />;
}

async function DeviceSection({
  storeId,
  period,
}: {
  storeId: string;
  period: Period;
}) {
  let stats = await getTrafficStats(storeId, period);

  if (stats.visitors === 0) {
    stats = await getRawEventStats(storeId, period);
  }

  return <DeviceBreakdown data={stats.devices} />;
}

async function TopProductsByViewsSection({
  storeId,
  period,
}: {
  storeId: string;
  period: Period;
}) {
  const products = await getTopProductsByViews(storeId, period);
  return <TopProductsAnalytics products={products} />;
}

async function RevenueChartSection({
  storeId,
  period,
  includeManualPayments,
}: {
  storeId: string;
  period: Period;
  includeManualPayments: boolean;
}) {
  const data = await getRevenueByMonth(storeId, period, includeManualPayments);
  return (
    <RevenueChart data={data} includeManualPayments={includeManualPayments} />
  );
}

async function TopProductsByRevenueSection({
  storeId,
  period,
  includeManualPayments,
}: {
  storeId: string;
  period: Period;
  includeManualPayments: boolean;
}) {
  const products = await getTopProductsByRevenue(
    storeId,
    period,
    includeManualPayments,
  );
  return <TopProductsTable products={products} />;
}

// ============================================
// MAIN PAGE COMPONENT
// ============================================

export default async function AnalyticsPage({
  searchParams,
}: AnalyticsPageProps) {
  // Ensure fresh data on every request
  noStore();

  const t = await getTranslations('dashboard.analytics');
  const tStats = await getTranslations('dashboard.statistics');
  const store = await getCurrentStore();
  const params = await searchParams;
  const period = (params.period as Period) || '30d';
  const tab = params.tab === 'traffic' ? 'traffic' : 'sales';
  const includeManualPayments = params.includeManual === 'true';

  if (!store) {
    redirect('/onboarding');
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        <UnifiedPeriodFilter />
      </div>

      {/* Tabs */}
      <Tabs defaultValue={tab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="sales">{t('tabs.sales')}</TabsTrigger>
          <TabsTrigger value="traffic">{t('tabs.traffic')}</TabsTrigger>
        </TabsList>

        {/* Traffic Tab */}
        <TabsContent value="traffic" className="space-y-6">
          {/* Traffic Stats Cards */}
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
            <TrafficStatsSection storeId={store.id} period={period} />
          </Suspense>

          {/* Charts Grid */}
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Trend Chart - 2 columns */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>{t('trafficTrend')}</CardTitle>
                <CardDescription>
                  {t('trafficTrendDescription')}
                </CardDescription>
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
                <CardDescription>
                  {t('conversionFunnelDescription')}
                </CardDescription>
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
                  <TopProductsByViewsSection
                    storeId={store.id}
                    period={period}
                  />
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
        </TabsContent>

        {/* Sales Tab */}
        <TabsContent value="sales" className="space-y-6">
          {/* Revenue Stats Cards */}
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
            <RevenueStatsSection
              storeId={store.id}
              includeManualPayments={includeManualPayments}
            />
          </Suspense>

          {/* Revenue Chart */}
          <Card>
            <CardHeader>
              <CardTitle>
                {tStats(
                  includeManualPayments
                    ? 'revenueChartWithManual'
                    : 'revenueChart',
                )}
              </CardTitle>
              <CardDescription>
                {tStats(
                  includeManualPayments
                    ? 'revenueChartWithManualDescription'
                    : 'revenueChartDescription',
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Suspense fallback={<Skeleton className="h-[300px] w-full" />}>
                <RevenueChartSection
                  storeId={store.id}
                  period={period}
                  includeManualPayments={includeManualPayments}
                />
              </Suspense>
            </CardContent>
          </Card>

          {/* Top Products by Revenue */}
          <Card>
            <CardHeader>
              <CardTitle>{tStats('topProducts.title')}</CardTitle>
              <CardDescription>
                {tStats(
                  includeManualPayments
                    ? 'topProducts.descriptionWithManual'
                    : 'topProducts.description',
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Suspense fallback={<Skeleton className="h-[300px] w-full" />}>
                <TopProductsByRevenueSection
                  storeId={store.id}
                  period={period}
                  includeManualPayments={includeManualPayments}
                />
              </Suspense>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
