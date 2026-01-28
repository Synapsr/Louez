import { db } from '@/lib/db'
import {
  stores,
  reservations,
  customers,
  subscriptions,
  dailyStats,
} from '@/lib/db/schema'
import { eq, and, gte, lte, sql, count, inArray } from 'drizzle-orm'
import { subDays, startOfDay, format, eachDayOfInterval } from 'date-fns'
import { fr } from 'date-fns/locale'
import { getPlan, getDefaultPlan } from '@/lib/plans'
import { getStoreUsage } from '@/lib/plan-limits'

// ============================================================================
// Types
// ============================================================================

export type Period = '7d' | '30d' | '90d' | '6m' | '12m'

export interface MultiStoreMetrics {
  totalRevenue: number
  previousPeriodRevenue: number
  revenueGrowth: number
  totalReservations: number
  pendingReservations: number
  totalCustomers: number
  newCustomers: number
  storeCount: number
}

export interface StorePerformance {
  storeId: string
  storeName: string
  storeSlug: string
  logoUrl: string | null
  planSlug: string
  planName: string
  revenue: number
  revenueChange: number
  reservations: number
  pendingReservations: number
  customers: number
}

export interface StorePlanLimit {
  storeId: string
  storeName: string
  storeSlug: string
  planSlug: string
  planName: string
  limitType: 'products' | 'reservations' | 'customers'
  current: number
  limit: number
  percentUsed: number
}

export interface StoreRevenueTrend {
  date: string
  label: string
  [storeName: string]: string | number
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get period configuration for date calculations
 */
export function getPeriodConfig(period: Period) {
  switch (period) {
    case '7d':
      return { days: 7, label: '7 jours' }
    case '30d':
      return { days: 30, label: '30 jours' }
    case '90d':
      return { days: 90, label: '90 jours' }
    case '6m':
      return { days: 180, label: '6 mois' }
    case '12m':
      return { days: 365, label: '12 mois' }
    default:
      return { days: 30, label: '30 jours' }
  }
}

// ============================================================================
// Data Fetching Functions
// ============================================================================

/**
 * Get aggregated metrics across all stores
 * @param storeIds - IDs of stores accessible by the user
 * @param period - Time period for filtering
 * @returns Consolidated metrics with comparison to previous period
 */
export async function getMultiStoreMetrics(
  storeIds: string[],
  period: Period
): Promise<MultiStoreMetrics> {
  if (storeIds.length === 0) {
    return {
      totalRevenue: 0,
      previousPeriodRevenue: 0,
      revenueGrowth: 0,
      totalReservations: 0,
      pendingReservations: 0,
      totalCustomers: 0,
      newCustomers: 0,
      storeCount: 0,
    }
  }

  const { days } = getPeriodConfig(period)
  const now = new Date()
  const startDate = startOfDay(subDays(now, days))
  const prevStartDate = startOfDay(subDays(startDate, days))
  const prevEndDate = startOfDay(startDate)

  try {
    const [
      currentPeriodStats,
      previousPeriodStats,
      customerStats,
      pendingStats,
    ] = await Promise.all([
      // Current period revenue and reservations
      db
        .select({
          revenue: sql<string>`COALESCE(SUM(${reservations.totalAmount}), 0)`,
          count: count(),
        })
        .from(reservations)
        .where(
          and(
            inArray(reservations.storeId, storeIds),
            gte(reservations.createdAt, startDate),
            eq(reservations.status, 'completed')
          )
        ),

      // Previous period revenue
      db
        .select({
          revenue: sql<string>`COALESCE(SUM(${reservations.totalAmount}), 0)`,
        })
        .from(reservations)
        .where(
          and(
            inArray(reservations.storeId, storeIds),
            gte(reservations.createdAt, prevStartDate),
            lte(reservations.createdAt, prevEndDate),
            eq(reservations.status, 'completed')
          )
        ),

      // Customer counts
      db
        .select({
          total: count(),
          newThisPeriod: sql<number>`SUM(CASE WHEN ${customers.createdAt} >= ${startDate} THEN 1 ELSE 0 END)`,
        })
        .from(customers)
        .where(inArray(customers.storeId, storeIds)),

      // Pending reservations count
      db
        .select({ count: count() })
        .from(reservations)
        .where(
          and(
            inArray(reservations.storeId, storeIds),
            eq(reservations.status, 'pending')
          )
        ),
    ])

    const currentRevenue = parseFloat(currentPeriodStats[0]?.revenue || '0')
    const previousRevenue = parseFloat(previousPeriodStats[0]?.revenue || '0')
    const revenueGrowth =
      previousRevenue > 0
        ? ((currentRevenue - previousRevenue) / previousRevenue) * 100
        : 0

    return {
      totalRevenue: currentRevenue,
      previousPeriodRevenue: previousRevenue,
      revenueGrowth,
      totalReservations: currentPeriodStats[0]?.count || 0,
      pendingReservations: pendingStats[0]?.count || 0,
      totalCustomers: customerStats[0]?.total || 0,
      newCustomers: Number(customerStats[0]?.newThisPeriod) || 0,
      storeCount: storeIds.length,
    }
  } catch (error) {
    console.error('[MultiStore] Error fetching metrics:', error)
    return {
      totalRevenue: 0,
      previousPeriodRevenue: 0,
      revenueGrowth: 0,
      totalReservations: 0,
      pendingReservations: 0,
      totalCustomers: 0,
      newCustomers: 0,
      storeCount: storeIds.length,
    }
  }
}

/**
 * Get performance data for each store
 * @param storeIds - IDs of stores accessible by the user
 * @param period - Time period for filtering
 * @returns Array of store performance data sorted by revenue
 */
export async function getStorePerformance(
  storeIds: string[],
  period: Period
): Promise<StorePerformance[]> {
  if (storeIds.length === 0) {
    return []
  }

  const { days } = getPeriodConfig(period)
  const now = new Date()
  const startDate = startOfDay(subDays(now, days))
  const prevStartDate = startOfDay(subDays(startDate, days))
  const prevEndDate = startOfDay(startDate)

  try {
    // Get store info with subscriptions
    const storeInfo = await db
      .select({
        id: stores.id,
        name: stores.name,
        slug: stores.slug,
        logoUrl: stores.logoUrl,
        planSlug: subscriptions.planSlug,
      })
      .from(stores)
      .leftJoin(subscriptions, eq(stores.id, subscriptions.storeId))
      .where(inArray(stores.id, storeIds))

    // Get current period stats by store
    const currentStats = await db
      .select({
        storeId: reservations.storeId,
        revenue: sql<string>`COALESCE(SUM(CASE WHEN ${reservations.status} = 'completed' THEN ${reservations.totalAmount} ELSE 0 END), 0)`,
        reservations: count(),
        pending: sql<number>`SUM(CASE WHEN ${reservations.status} = 'pending' THEN 1 ELSE 0 END)`,
      })
      .from(reservations)
      .where(
        and(
          inArray(reservations.storeId, storeIds),
          gte(reservations.createdAt, startDate)
        )
      )
      .groupBy(reservations.storeId)

    // Get previous period revenue by store
    const previousStats = await db
      .select({
        storeId: reservations.storeId,
        revenue: sql<string>`COALESCE(SUM(${reservations.totalAmount}), 0)`,
      })
      .from(reservations)
      .where(
        and(
          inArray(reservations.storeId, storeIds),
          gte(reservations.createdAt, prevStartDate),
          lte(reservations.createdAt, prevEndDate),
          eq(reservations.status, 'completed')
        )
      )
      .groupBy(reservations.storeId)

    // Get customer counts by store
    const customerCounts = await db
      .select({
        storeId: customers.storeId,
        count: count(),
      })
      .from(customers)
      .where(inArray(customers.storeId, storeIds))
      .groupBy(customers.storeId)

    // Build maps for quick lookup
    const currentMap = new Map(currentStats.map((s) => [s.storeId, s]))
    const previousMap = new Map(previousStats.map((s) => [s.storeId, s]))
    const customerMap = new Map(customerCounts.map((c) => [c.storeId, c.count]))

    // Merge data
    const performance: StorePerformance[] = storeInfo.map((store) => {
      const current = currentMap.get(store.id)
      const previous = previousMap.get(store.id)
      const currentRevenue = parseFloat(current?.revenue || '0')
      const previousRevenue = parseFloat(previous?.revenue || '0')
      const revenueChange =
        previousRevenue > 0
          ? ((currentRevenue - previousRevenue) / previousRevenue) * 100
          : 0

      const plan = getPlan(store.planSlug || 'start') || getDefaultPlan()

      return {
        storeId: store.id,
        storeName: store.name,
        storeSlug: store.slug,
        logoUrl: store.logoUrl,
        planSlug: plan.slug,
        planName: plan.name,
        revenue: currentRevenue,
        revenueChange,
        reservations: current?.reservations || 0,
        pendingReservations: Number(current?.pending) || 0,
        customers: customerMap.get(store.id) || 0,
      }
    })

    // Sort by revenue descending
    return performance.sort((a, b) => b.revenue - a.revenue)
  } catch (error) {
    console.error('[MultiStore] Error fetching store performance:', error)
    return []
  }
}

/**
 * Get stores approaching their plan limits
 * @param storeIds - IDs of stores accessible by the user
 * @param threshold - Percentage threshold to consider "approaching limit" (default 80)
 * @returns Array of stores with their limit status
 */
export async function getStoresApproachingLimits(
  storeIds: string[],
  threshold: number = 80
): Promise<StorePlanLimit[]> {
  if (storeIds.length === 0) {
    return []
  }

  const limits: StorePlanLimit[] = []

  try {
    // Get store info with subscriptions
    const storeInfo = await db
      .select({
        id: stores.id,
        name: stores.name,
        slug: stores.slug,
        planSlug: subscriptions.planSlug,
      })
      .from(stores)
      .leftJoin(subscriptions, eq(stores.id, subscriptions.storeId))
      .where(inArray(stores.id, storeIds))

    // Check limits for each store
    for (const store of storeInfo) {
      const plan = getPlan(store.planSlug || 'start') || getDefaultPlan()
      const usage = await getStoreUsage(store.id)

      // Check products limit
      if (plan.features.maxProducts !== null) {
        const percentUsed = Math.round(
          (usage.products / plan.features.maxProducts) * 100
        )
        if (percentUsed >= threshold) {
          limits.push({
            storeId: store.id,
            storeName: store.name,
            storeSlug: store.slug,
            planSlug: plan.slug,
            planName: plan.name,
            limitType: 'products',
            current: usage.products,
            limit: plan.features.maxProducts,
            percentUsed,
          })
        }
      }

      // Check reservations limit
      if (plan.features.maxReservationsPerMonth !== null) {
        const percentUsed = Math.round(
          (usage.reservationsThisMonth / plan.features.maxReservationsPerMonth) *
            100
        )
        if (percentUsed >= threshold) {
          limits.push({
            storeId: store.id,
            storeName: store.name,
            storeSlug: store.slug,
            planSlug: plan.slug,
            planName: plan.name,
            limitType: 'reservations',
            current: usage.reservationsThisMonth,
            limit: plan.features.maxReservationsPerMonth,
            percentUsed,
          })
        }
      }

      // Check customers limit
      if (plan.features.maxCustomers !== null) {
        const percentUsed = Math.round(
          (usage.customers / plan.features.maxCustomers) * 100
        )
        if (percentUsed >= threshold) {
          limits.push({
            storeId: store.id,
            storeName: store.name,
            storeSlug: store.slug,
            planSlug: plan.slug,
            planName: plan.name,
            limitType: 'customers',
            current: usage.customers,
            limit: plan.features.maxCustomers,
            percentUsed,
          })
        }
      }
    }

    // Sort by percentUsed descending (most urgent first)
    return limits.sort((a, b) => b.percentUsed - a.percentUsed)
  } catch (error) {
    console.error('[MultiStore] Error checking plan limits:', error)
    return []
  }
}

/**
 * Get revenue trends over time for multiple stores
 * @param storeIds - IDs of stores accessible by the user
 * @param period - Time period for the trend
 * @param maxStores - Maximum number of stores to include (default 6)
 * @returns Array of data points with revenue per store
 */
export async function getMultiStoreRevenueTrend(
  storeIds: string[],
  period: Period,
  maxStores: number = 6
): Promise<{ data: StoreRevenueTrend[]; storeNames: string[] }> {
  if (storeIds.length === 0) {
    return { data: [], storeNames: [] }
  }

  const { days } = getPeriodConfig(period)
  const now = new Date()
  const startDate = startOfDay(subDays(now, days - 1))
  const allDays = eachDayOfInterval({ start: startDate, end: now })

  try {
    // Get store names (limited to top performers)
    const storeInfo = await db
      .select({
        id: stores.id,
        name: stores.name,
      })
      .from(stores)
      .where(inArray(stores.id, storeIds))

    const storeNameMap = new Map(storeInfo.map((s) => [s.id, s.name]))

    // Get daily revenue by store from dailyStats
    const dailyRevenue = await db
      .select({
        storeId: dailyStats.storeId,
        date: dailyStats.date,
        revenue: dailyStats.revenue,
      })
      .from(dailyStats)
      .where(
        and(
          inArray(dailyStats.storeId, storeIds),
          gte(dailyStats.date, startDate)
        )
      )
      .orderBy(dailyStats.date)

    // Calculate total revenue per store to determine top stores
    const storeRevenueTotals = new Map<string, number>()
    for (const row of dailyRevenue) {
      const current = storeRevenueTotals.get(row.storeId) || 0
      storeRevenueTotals.set(
        row.storeId,
        current + parseFloat(row.revenue || '0')
      )
    }

    // Sort stores by total revenue and take top N
    const topStoreIds = Array.from(storeRevenueTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxStores)
      .map(([id]) => id)

    const storeNames = topStoreIds.map((id) => storeNameMap.get(id) || id)

    // Create lookup map for daily revenue
    const revenueMap = new Map<string, Map<string, number>>()
    for (const row of dailyRevenue) {
      if (!topStoreIds.includes(row.storeId)) continue
      const dateKey = format(row.date, 'yyyy-MM-dd')
      if (!revenueMap.has(dateKey)) {
        revenueMap.set(dateKey, new Map())
      }
      revenueMap.get(dateKey)!.set(row.storeId, parseFloat(row.revenue || '0'))
    }

    // Build trend data
    const data: StoreRevenueTrend[] = allDays.map((day) => {
      const dateKey = format(day, 'yyyy-MM-dd')
      const point: StoreRevenueTrend = {
        date: dateKey,
        label: format(day, days > 30 ? 'dd/MM' : 'EEE dd', { locale: fr }),
      }

      for (const storeId of topStoreIds) {
        const storeName = storeNameMap.get(storeId) || storeId
        const dayData = revenueMap.get(dateKey)
        point[storeName] = dayData?.get(storeId) || 0
      }

      return point
    })

    return { data, storeNames }
  } catch (error) {
    console.error('[MultiStore] Error fetching revenue trend:', error)
    return { data: [], storeNames: [] }
  }
}
