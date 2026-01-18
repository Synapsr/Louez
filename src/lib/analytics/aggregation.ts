import { db } from '@/lib/db'
import {
  pageViews,
  storefrontEvents,
  dailyStats,
  productStats,
  stores,
  reservations,
} from '@/lib/db/schema'
import { eq, and, gte, lt, sql, count } from 'drizzle-orm'
import { startOfDay, subDays, format } from 'date-fns'

/**
 * Aggregate yesterday's analytics data into dailyStats and productStats tables.
 * This should run once daily (e.g., at 2:00 AM).
 */
export async function aggregateDailyAnalytics() {
  const now = new Date()
  const yesterday = startOfDay(subDays(now, 1))
  const today = startOfDay(now)

  console.log(`[Analytics] Aggregating data for ${format(yesterday, 'yyyy-MM-dd')}`)

  // Get all stores
  const allStores = await db
    .select({ id: stores.id })
    .from(stores)
    .where(eq(stores.onboardingCompleted, true))

  const results = {
    storesProcessed: 0,
    dailyStatsCreated: 0,
    productStatsCreated: 0,
  }

  for (const store of allStores) {
    try {
      // Aggregate page views
      const pageViewStats = await db
        .select({
          totalViews: count(),
          uniqueVisitors: sql<number>`COUNT(DISTINCT ${pageViews.sessionId})`,
          productViews: sql<number>`SUM(CASE WHEN ${pageViews.page} = 'product' THEN 1 ELSE 0 END)`,
          mobileVisitors: sql<number>`COUNT(DISTINCT CASE WHEN ${pageViews.device} = 'mobile' THEN ${pageViews.sessionId} END)`,
          tabletVisitors: sql<number>`COUNT(DISTINCT CASE WHEN ${pageViews.device} = 'tablet' THEN ${pageViews.sessionId} END)`,
          desktopVisitors: sql<number>`COUNT(DISTINCT CASE WHEN ${pageViews.device} = 'desktop' THEN ${pageViews.sessionId} END)`,
        })
        .from(pageViews)
        .where(
          and(
            eq(pageViews.storeId, store.id),
            gte(pageViews.createdAt, yesterday),
            lt(pageViews.createdAt, today)
          )
        )

      // Aggregate events
      const eventStats = await db
        .select({
          cartAdditions: sql<number>`SUM(CASE WHEN ${storefrontEvents.eventType} = 'add_to_cart' THEN 1 ELSE 0 END)`,
          checkoutStarted: sql<number>`SUM(CASE WHEN ${storefrontEvents.eventType} = 'checkout_started' THEN 1 ELSE 0 END)`,
          checkoutCompleted: sql<number>`SUM(CASE WHEN ${storefrontEvents.eventType} = 'checkout_completed' THEN 1 ELSE 0 END)`,
        })
        .from(storefrontEvents)
        .where(
          and(
            eq(storefrontEvents.storeId, store.id),
            gte(storefrontEvents.createdAt, yesterday),
            lt(storefrontEvents.createdAt, today)
          )
        )

      // Get reservations created yesterday
      const reservationStats = await db
        .select({
          created: sql<number>`SUM(CASE WHEN ${reservations.status} != 'cancelled' THEN 1 ELSE 0 END)`,
          confirmed: sql<number>`SUM(CASE WHEN ${reservations.status} IN ('confirmed', 'ongoing', 'completed') THEN 1 ELSE 0 END)`,
          revenue: sql<string>`COALESCE(SUM(CASE WHEN ${reservations.status} IN ('confirmed', 'ongoing', 'completed') THEN ${reservations.totalAmount} ELSE 0 END), 0)`,
        })
        .from(reservations)
        .where(
          and(
            eq(reservations.storeId, store.id),
            gte(reservations.createdAt, yesterday),
            lt(reservations.createdAt, today)
          )
        )

      const pvStats = pageViewStats[0]
      const evStats = eventStats[0]
      const resStats = reservationStats[0]

      const checkoutCompletedCount = Number(evStats?.checkoutCompleted) || 0
      const revenue = parseFloat(resStats?.revenue || '0')
      const avgCartValue = checkoutCompletedCount > 0 ? revenue / checkoutCompletedCount : 0

      // Upsert daily stats
      await db
        .insert(dailyStats)
        .values({
          storeId: store.id,
          date: yesterday,
          pageViews: Number(pvStats?.totalViews) || 0,
          uniqueVisitors: Number(pvStats?.uniqueVisitors) || 0,
          productViews: Number(pvStats?.productViews) || 0,
          cartAdditions: Number(evStats?.cartAdditions) || 0,
          checkoutStarted: Number(evStats?.checkoutStarted) || 0,
          checkoutCompleted: checkoutCompletedCount,
          reservationsCreated: Number(resStats?.created) || 0,
          reservationsConfirmed: Number(resStats?.confirmed) || 0,
          revenue: revenue.toFixed(2),
          averageCartValue: avgCartValue.toFixed(2),
          mobileVisitors: Number(pvStats?.mobileVisitors) || 0,
          tabletVisitors: Number(pvStats?.tabletVisitors) || 0,
          desktopVisitors: Number(pvStats?.desktopVisitors) || 0,
        })
        .onDuplicateKeyUpdate({
          set: {
            pageViews: Number(pvStats?.totalViews) || 0,
            uniqueVisitors: Number(pvStats?.uniqueVisitors) || 0,
            productViews: Number(pvStats?.productViews) || 0,
            cartAdditions: Number(evStats?.cartAdditions) || 0,
            checkoutStarted: Number(evStats?.checkoutStarted) || 0,
            checkoutCompleted: checkoutCompletedCount,
            reservationsCreated: Number(resStats?.created) || 0,
            reservationsConfirmed: Number(resStats?.confirmed) || 0,
            revenue: revenue.toFixed(2),
            averageCartValue: avgCartValue.toFixed(2),
            mobileVisitors: Number(pvStats?.mobileVisitors) || 0,
            tabletVisitors: Number(pvStats?.tabletVisitors) || 0,
            desktopVisitors: Number(pvStats?.desktopVisitors) || 0,
            updatedAt: new Date(),
          },
        })

      results.dailyStatsCreated++

      // Aggregate product stats
      const productViewStats = await db
        .select({
          productId: pageViews.productId,
          views: count(),
        })
        .from(pageViews)
        .where(
          and(
            eq(pageViews.storeId, store.id),
            gte(pageViews.createdAt, yesterday),
            lt(pageViews.createdAt, today),
            sql`${pageViews.productId} IS NOT NULL`
          )
        )
        .groupBy(pageViews.productId)

      for (const product of productViewStats) {
        if (!product.productId) continue

        // Get cart additions for this product
        const productCartStats = await db
          .select({
            cartAdditions: count(),
          })
          .from(storefrontEvents)
          .where(
            and(
              eq(storefrontEvents.storeId, store.id),
              eq(storefrontEvents.eventType, 'add_to_cart'),
              gte(storefrontEvents.createdAt, yesterday),
              lt(storefrontEvents.createdAt, today),
              sql`JSON_EXTRACT(${storefrontEvents.metadata}, '$.productId') = ${product.productId}`
            )
          )

        // Upsert product stats
        await db
          .insert(productStats)
          .values({
            storeId: store.id,
            productId: product.productId,
            date: yesterday,
            views: product.views,
            cartAdditions: productCartStats[0]?.cartAdditions || 0,
            reservations: 0, // This would require joining with reservation_items
            revenue: '0',
          })
          .onDuplicateKeyUpdate({
            set: {
              views: product.views,
              cartAdditions: productCartStats[0]?.cartAdditions || 0,
              updatedAt: new Date(),
            },
          })

        results.productStatsCreated++
      }

      results.storesProcessed++
    } catch (error) {
      console.error(`[Analytics] Error aggregating for store ${store.id}:`, error)
    }
  }

  console.log(`[Analytics] Aggregation complete:`, results)
  return results
}

/**
 * Clean up old raw analytics data (older than 90 days).
 * This keeps the database lean while preserving aggregated stats.
 */
export async function cleanupOldAnalyticsData() {
  const cutoffDate = subDays(new Date(), 90)

  console.log(`[Analytics] Cleaning up data older than ${format(cutoffDate, 'yyyy-MM-dd')}`)

  // Delete old page views
  await db
    .delete(pageViews)
    .where(lt(pageViews.createdAt, cutoffDate))

  // Delete old storefront events
  await db
    .delete(storefrontEvents)
    .where(lt(storefrontEvents.createdAt, cutoffDate))

  console.log(`[Analytics] Cleanup complete`)

  return {
    success: true,
    cutoffDate: format(cutoffDate, 'yyyy-MM-dd'),
  }
}
