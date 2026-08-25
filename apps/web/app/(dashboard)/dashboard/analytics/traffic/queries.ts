import { eachDayOfInterval, endOfDay, format, startOfDay, subDays } from "date-fns";

import { and, count, eq, gte, lt, lte, ne, sql } from "drizzle-orm";

import { db } from "@louez/db";
import {
  dailyStats,
  pageViews,
  productStats,
  products,
  reservationItems,
  reservations,
  storefrontEvents,
} from "@louez/db";

import type { DeviceStats } from "../device-breakdown";
import type { FunnelStep } from "../funnel-chart";
import { getPeriodConfig, type Period } from "../period";
import type { TopProductData } from "../top-products-analytics";
import type { TrendDataPoint } from "../trend-chart";
import { FORMAT_DATE_FNS_LOCALE } from "@/lib/i18n/format-locale";

const RAW_ANALYTICS_RETENTION_DAYS = 90;

type NumericValue = number | string | null | undefined;

const toNumber = (value: NumericValue) => Number(value) || 0;

const getPeriodBounds = (period: Period, now = new Date()) => {
  const { days } = getPeriodConfig(period);
  const startDate = startOfDay(subDays(now, days - 1));
  const endDate = endOfDay(now);
  const prevEndDate = endOfDay(subDays(startDate, 1));
  const prevStartDate = startOfDay(subDays(startDate, days));

  return { days, startDate, endDate, prevStartDate, prevEndDate };
};

const getRawTrafficStats = async (storeId: string, startDate: Date, endDate: Date) => {
  const [pageViewStats, eventStats] = await Promise.all([
    db
      .select({
        pageViews: count(),
        uniqueVisitors: sql<number>`COUNT(DISTINCT ${pageViews.sessionId})`,
        mobileVisitors: sql<number>`COUNT(DISTINCT CASE WHEN ${pageViews.device} = 'mobile' THEN ${pageViews.sessionId} END)`,
        tabletVisitors: sql<number>`COUNT(DISTINCT CASE WHEN ${pageViews.device} = 'tablet' THEN ${pageViews.sessionId} END)`,
        desktopVisitors: sql<number>`COUNT(DISTINCT CASE WHEN ${pageViews.device} = 'desktop' THEN ${pageViews.sessionId} END)`,
      })
      .from(pageViews)
      .where(
        and(
          eq(pageViews.storeId, storeId),
          gte(pageViews.createdAt, startDate),
          lte(pageViews.createdAt, endDate),
        ),
      ),
    db
      .select({
        cartAdditions: sql<number>`SUM(CASE WHEN ${storefrontEvents.eventType} = 'add_to_cart' THEN 1 ELSE 0 END)`,
        checkoutCompleted: sql<number>`SUM(CASE WHEN ${storefrontEvents.eventType} = 'checkout_completed' THEN 1 ELSE 0 END)`,
      })
      .from(storefrontEvents)
      .where(
        and(
          eq(storefrontEvents.storeId, storeId),
          gte(storefrontEvents.createdAt, startDate),
          lte(storefrontEvents.createdAt, endDate),
        ),
      ),
  ]);

  const pageView = pageViewStats[0];
  const event = eventStats[0];

  return {
    pageViews: toNumber(pageView?.pageViews),
    uniqueVisitors: toNumber(pageView?.uniqueVisitors),
    cartAdditions: toNumber(event?.cartAdditions),
    checkoutCompleted: toNumber(event?.checkoutCompleted),
    mobileVisitors: toNumber(pageView?.mobileVisitors),
    tabletVisitors: toNumber(pageView?.tabletVisitors),
    desktopVisitors: toNumber(pageView?.desktopVisitors),
  };
};

/**
 * Recent product views are rebuilt from both raw sources so modal opens and
 * direct product pages are treated alike. Older periods use the daily rollup,
 * because raw analytics are intentionally retained for only 90 days.
 */
const getProductViewCount = async (
  storeId: string,
  startDate: Date,
  endDate: Date,
  now = new Date(),
) => {
  const retentionStart = startOfDay(subDays(now, RAW_ANALYTICS_RETENTION_DAYS - 1));
  const rawStart = startDate > retentionStart ? startDate : retentionStart;
  const hasRawWindow = rawStart <= endDate;
  const historicalEnd = hasRawWindow ? new Date(rawStart.getTime() - 1) : endDate;

  const historicalPromise =
    startDate <= historicalEnd
      ? db
          .select({
            count: sql<number>`COALESCE(SUM(${dailyStats.productViews}), 0)`,
          })
          .from(dailyStats)
          .where(
            and(
              eq(dailyStats.storeId, storeId),
              gte(dailyStats.date, startDate),
              lte(dailyStats.date, historicalEnd),
            ),
          )
      : Promise.resolve([]);

  const directViewsPromise = hasRawWindow
    ? db
        .select({ count: count() })
        .from(pageViews)
        .where(
          and(
            eq(pageViews.storeId, storeId),
            eq(pageViews.page, "product"),
            gte(pageViews.createdAt, rawStart),
            lte(pageViews.createdAt, endDate),
          ),
        )
    : Promise.resolve([]);

  const modalViewsPromise = hasRawWindow
    ? db
        .select({ count: count() })
        .from(storefrontEvents)
        .where(
          and(
            eq(storefrontEvents.storeId, storeId),
            eq(storefrontEvents.eventType, "product_view"),
            gte(storefrontEvents.createdAt, rawStart),
            lte(storefrontEvents.createdAt, endDate),
          ),
        )
    : Promise.resolve([]);

  const [historical, directViews, modalViews] = await Promise.all([
    historicalPromise,
    directViewsPromise,
    modalViewsPromise,
  ]);

  return (
    toNumber(historical[0]?.count) +
    toNumber(directViews[0]?.count) +
    toNumber(modalViews[0]?.count)
  );
};

export async function getTrafficStats(storeId: string, period: Period) {
  const now = new Date();
  const { startDate, endDate, prevStartDate, prevEndDate } = getPeriodBounds(period, now);
  const todayStart = startOfDay(now);
  const completedDaysEnd = endOfDay(subDays(now, 1));

  try {
    const [currentStats, prevStats, todayStats, productViews, prevProductViews] = await Promise.all(
      [
        db
          .select({
            uniqueVisitors: sql<number>`COALESCE(SUM(${dailyStats.uniqueVisitors}), 0)`,
            cartAdditions: sql<number>`COALESCE(SUM(${dailyStats.cartAdditions}), 0)`,
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
              lte(dailyStats.date, completedDaysEnd),
            ),
          ),
        db
          .select({
            uniqueVisitors: sql<number>`COALESCE(SUM(${dailyStats.uniqueVisitors}), 0)`,
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
          ),
        getRawTrafficStats(storeId, todayStart, endDate),
        getProductViewCount(storeId, startDate, endDate, now),
        getProductViewCount(storeId, prevStartDate, prevEndDate, now),
      ],
    );

    const current = currentStats[0];
    const prev = prevStats[0];
    const visitors = toNumber(current?.uniqueVisitors) + todayStats.uniqueVisitors;
    const cartAdditions = toNumber(current?.cartAdditions) + todayStats.cartAdditions;
    const conversions = toNumber(current?.checkoutCompleted) + todayStats.checkoutCompleted;
    const prevVisitors = toNumber(prev?.uniqueVisitors);
    const prevConversions = toNumber(prev?.checkoutCompleted);

    // Calculate changes
    const visitorsChange = prevVisitors > 0 ? ((visitors - prevVisitors) / prevVisitors) * 100 : 0;
    const viewsChange =
      prevProductViews > 0 ? ((productViews - prevProductViews) / prevProductViews) * 100 : 0;
    const conversionsChange =
      prevConversions > 0 ? ((conversions - prevConversions) / prevConversions) * 100 : 0;
    const revenueChange =
      parseFloat(prev?.revenue || "0") > 0
        ? ((parseFloat(current?.revenue || "0") - parseFloat(prev?.revenue || "0")) /
            parseFloat(prev?.revenue || "0")) *
          100
        : 0;

    // Calculate conversion rate
    const conversionRate = visitors > 0 ? (conversions / visitors) * 100 : 0;
    const prevConversionRate = prevVisitors > 0 ? (prevConversions / prevVisitors) * 100 : 0;
    const conversionRateChange = prevConversionRate > 0 ? conversionRate - prevConversionRate : 0;

    return {
      visitors,
      visitorsChange,
      productViews,
      viewsChange,
      conversions,
      conversionsChange,
      conversionRate,
      conversionRateChange,
      revenue: parseFloat(current?.revenue || "0"),
      revenueChange,
      devices: {
        mobile: toNumber(current?.mobileVisitors) + todayStats.mobileVisitors,
        tablet: toNumber(current?.tabletVisitors) + todayStats.tabletVisitors,
        desktop: toNumber(current?.desktopVisitors) + todayStats.desktopVisitors,
      } satisfies DeviceStats,
      funnel: [
        { label: "Visiteurs", value: visitors },
        { label: "Vues produits", value: productViews },
        { label: "Ajouts panier", value: cartAdditions },
        { label: "Commandes", value: conversions },
      ] as FunnelStep[],
    };
  } catch (error) {
    console.error("[Analytics] Error fetching traffic stats:", error);
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
        { label: "Visiteurs", value: 0 },
        { label: "Vues produits", value: 0 },
        { label: "Ajouts panier", value: 0 },
        { label: "Commandes", value: 0 },
      ] as FunnelStep[],
    };
  }
}

export async function getTrendData(storeId: string, period: Period): Promise<TrendDataPoint[]> {
  const now = new Date();
  const { days, startDate, endDate } = getPeriodBounds(period, now);
  const todayStart = startOfDay(now);
  const completedDaysEnd = endOfDay(subDays(now, 1));

  // Get all days in the interval
  const allDays = eachDayOfInterval({ start: startDate, end: now });

  try {
    const [stats, todayStats] = await Promise.all([
      db
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
            gte(dailyStats.date, startDate),
            lte(dailyStats.date, completedDaysEnd),
          ),
        )
        .orderBy(dailyStats.date),
      getRawTrafficStats(storeId, todayStart, endDate),
    ]);

    // Create a map for quick lookup
    const statsMap = new Map(stats.map((s) => [format(s.date, "yyyy-MM-dd"), s]));
    statsMap.set(format(todayStart, "yyyy-MM-dd"), {
      date: todayStart,
      visitors: todayStats.uniqueVisitors,
      pageViews: todayStats.pageViews,
      conversions: todayStats.checkoutCompleted,
    });

    // Fill in all days, even those without data
    return allDays.map((day) => {
      const key = format(day, "yyyy-MM-dd");
      const stat = statsMap.get(key);
      return {
        date: key,
        label: format(day, days > 30 ? "dd/MM" : "EEE dd", { locale: FORMAT_DATE_FNS_LOCALE }),
        visitors: toNumber(stat?.visitors),
        pageViews: toNumber(stat?.pageViews),
        conversions: toNumber(stat?.conversions),
      };
    });
  } catch (error) {
    console.error("[Analytics] Error fetching trend data:", error);
    // Return empty array with all days showing 0
    return allDays.map((day) => ({
      date: format(day, "yyyy-MM-dd"),
      label: format(day, days > 30 ? "dd/MM" : "EEE dd", { locale: FORMAT_DATE_FNS_LOCALE }),
      visitors: 0,
      pageViews: 0,
      conversions: 0,
    }));
  }
}

export async function getTopProductsByViews(
  storeId: string,
  period: Period,
): Promise<TopProductData[]> {
  const now = new Date();
  const { startDate, endDate } = getPeriodBounds(period, now);
  const retentionStart = startOfDay(subDays(now, RAW_ANALYTICS_RETENTION_DAYS - 1));
  const rawStart = startDate > retentionStart ? startDate : retentionStart;
  const eventProductId = sql<string>`JSON_UNQUOTE(JSON_EXTRACT(${storefrontEvents.metadata}, '$.productId'))`;

  try {
    const [historicalProducts, directViews, modalViews, cartAdditions, productConversions] =
      await Promise.all([
        startDate < rawStart
          ? db
              .select({
                productId: productStats.productId,
                productName: products.name,
                views: sql<number>`COALESCE(SUM(${productStats.views}), 0)`,
                cartAdditions: sql<number>`COALESCE(SUM(${productStats.cartAdditions}), 0)`,
              })
              .from(productStats)
              .innerJoin(products, eq(productStats.productId, products.id))
              .where(
                and(
                  eq(productStats.storeId, storeId),
                  gte(productStats.date, startDate),
                  lt(productStats.date, rawStart),
                ),
              )
              .groupBy(productStats.productId, products.name)
          : Promise.resolve([]),
        db
          .select({
            productId: pageViews.productId,
            productName: products.name,
            views: count(),
          })
          .from(pageViews)
          .innerJoin(products, eq(pageViews.productId, products.id))
          .where(
            and(
              eq(pageViews.storeId, storeId),
              eq(pageViews.page, "product"),
              gte(pageViews.createdAt, rawStart),
              lte(pageViews.createdAt, endDate),
            ),
          )
          .groupBy(pageViews.productId, products.name),
        db
          .select({
            productId: eventProductId,
            productName: products.name,
            views: count(),
          })
          .from(storefrontEvents)
          .innerJoin(products, eq(products.id, eventProductId))
          .where(
            and(
              eq(storefrontEvents.storeId, storeId),
              eq(storefrontEvents.eventType, "product_view"),
              gte(storefrontEvents.createdAt, rawStart),
              lte(storefrontEvents.createdAt, endDate),
            ),
          )
          .groupBy(eventProductId, products.name),
        db
          .select({
            productId: eventProductId,
            productName: products.name,
            cartAdditions: count(),
          })
          .from(storefrontEvents)
          .innerJoin(products, eq(products.id, eventProductId))
          .where(
            and(
              eq(storefrontEvents.storeId, storeId),
              eq(storefrontEvents.eventType, "add_to_cart"),
              gte(storefrontEvents.createdAt, rawStart),
              lte(storefrontEvents.createdAt, endDate),
            ),
          )
          .groupBy(eventProductId, products.name),
        db
          .select({
            productId: reservationItems.productId,
            productName: products.name,
            conversions: sql<number>`COUNT(DISTINCT ${reservations.id})`,
          })
          .from(reservationItems)
          .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
          .innerJoin(products, eq(reservationItems.productId, products.id))
          .where(
            and(
              eq(reservations.storeId, storeId),
              ne(reservations.status, "cancelled"),
              gte(reservations.createdAt, startDate),
              lte(reservations.createdAt, endDate),
            ),
          )
          .groupBy(reservationItems.productId, products.name),
      ]);

    const topProducts = new Map<string, TopProductData>();
    const getProduct = (productId: string, productName: string) => {
      const existing = topProducts.get(productId);
      if (existing) return existing;

      const product = {
        productId,
        productName,
        views: 0,
        cartAdditions: 0,
        conversions: 0,
      } satisfies TopProductData;
      topProducts.set(productId, product);
      return product;
    };

    for (const row of historicalProducts) {
      getProduct(row.productId, row.productName).views += toNumber(row.views);
      getProduct(row.productId, row.productName).cartAdditions += toNumber(row.cartAdditions);
    }
    for (const row of directViews) {
      if (!row.productId) continue;
      getProduct(row.productId, row.productName).views += toNumber(row.views);
    }
    for (const row of modalViews) {
      if (!row.productId) continue;
      getProduct(row.productId, row.productName).views += toNumber(row.views);
    }
    for (const row of cartAdditions) {
      if (!row.productId) continue;
      getProduct(row.productId, row.productName).cartAdditions += toNumber(row.cartAdditions);
    }
    for (const row of productConversions) {
      if (!row.productId) continue;
      getProduct(row.productId, row.productName).conversions += toNumber(row.conversions);
    }

    return [...topProducts.values()]
      .filter((product) => product.views > 0)
      .sort((a, b) => b.views - a.views)
      .slice(0, 10);
  } catch (error) {
    console.error("[Analytics] Error fetching top products by views:", error);
    return [];
  }
}

// Fallback: Get stats from raw events if dailyStats is empty
export async function getRawEventStats(storeId: string, period: Period) {
  const now = new Date();
  const { startDate, endDate } = getPeriodBounds(period, now);

  try {
    const [rawStats, productViews] = await Promise.all([
      getRawTrafficStats(storeId, startDate, endDate),
      getProductViewCount(storeId, startDate, endDate, now),
    ]);
    const visitors = rawStats.uniqueVisitors;
    const checkouts = rawStats.checkoutCompleted;
    const conversionRate = visitors > 0 ? (checkouts / visitors) * 100 : 0;

    return {
      visitors,
      visitorsChange: 0,
      productViews,
      viewsChange: 0,
      conversions: checkouts,
      conversionsChange: 0,
      conversionRate,
      conversionRateChange: 0,
      revenue: 0,
      revenueChange: 0,
      devices: {
        mobile: rawStats.mobileVisitors,
        tablet: rawStats.tabletVisitors,
        desktop: rawStats.desktopVisitors,
      } satisfies DeviceStats,
      funnel: [
        { label: "Visiteurs", value: visitors },
        { label: "Vues produits", value: productViews },
        { label: "Ajouts panier", value: rawStats.cartAdditions },
        { label: "Commandes", value: checkouts },
      ] as FunnelStep[],
    };
  } catch (error) {
    console.error("[Analytics] Error fetching raw event stats:", error);
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
        { label: "Visiteurs", value: 0 },
        { label: "Vues produits", value: 0 },
        { label: "Ajouts panier", value: 0 },
        { label: "Commandes", value: 0 },
      ] as FunnelStep[],
    };
  }
}
