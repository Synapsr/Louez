import { db } from '@/lib/db'
import { products, customers, reservations } from '@/lib/db/schema'
import { eq, and, gte, lte, sql, count } from 'drizzle-orm'

/**
 * Store metrics for adaptive dashboard
 */
export interface StoreMetrics {
  // Catalog
  productCount: number
  activeProductCount: number
  draftProductCount: number

  // Customers
  customerCount: number
  newCustomersThisMonth: number

  // Reservations
  totalReservations: number
  completedReservations: number
  pendingReservations: number
  confirmedReservations: number
  ongoingReservations: number

  // Today's operations
  todaysDepartures: number
  todaysReturns: number

  // Financial
  monthlyRevenue: number
  lastMonthRevenue: number
  allTimeRevenue: number
}

/**
 * Store state based on metrics
 */
export type StoreState =
  | 'virgin' // No products
  | 'building' // Has products, no customers
  | 'starting' // Has customers, few reservations
  | 'active' // Regular activity
  | 'established' // High volume

/**
 * Determine the store state based on metrics
 */
export function determineStoreState(metrics: StoreMetrics): StoreState {
  const { activeProductCount, customerCount, completedReservations } = metrics

  if (activeProductCount === 0) {
    return 'virgin'
  }

  if (customerCount === 0) {
    return 'building'
  }

  if (completedReservations < 5) {
    return 'starting'
  }

  if (completedReservations < 50) {
    return 'active'
  }

  return 'established'
}

/**
 * Get all metrics for a store
 */
export async function getStoreMetrics(storeId: string): Promise<StoreMetrics> {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const firstDayOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastDayOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0)

  // Execute all queries in parallel for performance
  const [
    productStats,
    customerStats,
    reservationStats,
    todaysOperations,
    revenueStats,
  ] = await Promise.all([
    // Product counts
    db
      .select({
        total: count(),
        active: sql<number>`SUM(CASE WHEN ${products.status} = 'active' THEN 1 ELSE 0 END)`,
        draft: sql<number>`SUM(CASE WHEN ${products.status} = 'draft' THEN 1 ELSE 0 END)`,
      })
      .from(products)
      .where(eq(products.storeId, storeId)),

    // Customer counts
    db
      .select({
        total: count(),
        newThisMonth: sql<number>`SUM(CASE WHEN ${customers.createdAt} >= ${firstDayOfMonth} THEN 1 ELSE 0 END)`,
      })
      .from(customers)
      .where(eq(customers.storeId, storeId)),

    // Reservation counts by status
    db
      .select({
        total: count(),
        completed: sql<number>`SUM(CASE WHEN ${reservations.status} = 'completed' THEN 1 ELSE 0 END)`,
        pending: sql<number>`SUM(CASE WHEN ${reservations.status} = 'pending' THEN 1 ELSE 0 END)`,
        confirmed: sql<number>`SUM(CASE WHEN ${reservations.status} = 'confirmed' THEN 1 ELSE 0 END)`,
        ongoing: sql<number>`SUM(CASE WHEN ${reservations.status} = 'ongoing' THEN 1 ELSE 0 END)`,
      })
      .from(reservations)
      .where(eq(reservations.storeId, storeId)),

    // Today's operations
    Promise.all([
      db
        .select({ count: count() })
        .from(reservations)
        .where(
          and(
            eq(reservations.storeId, storeId),
            eq(reservations.status, 'confirmed'),
            gte(reservations.startDate, today),
            lte(reservations.startDate, tomorrow)
          )
        ),
      db
        .select({ count: count() })
        .from(reservations)
        .where(
          and(
            eq(reservations.storeId, storeId),
            eq(reservations.status, 'ongoing'),
            gte(reservations.endDate, today),
            lte(reservations.endDate, tomorrow)
          )
        ),
    ]),

    // Revenue stats
    Promise.all([
      db
        .select({
          total: sql<string>`COALESCE(SUM(${reservations.totalAmount}), 0)`,
        })
        .from(reservations)
        .where(
          and(
            eq(reservations.storeId, storeId),
            eq(reservations.status, 'completed'),
            gte(reservations.createdAt, firstDayOfMonth)
          )
        ),
      db
        .select({
          total: sql<string>`COALESCE(SUM(${reservations.totalAmount}), 0)`,
        })
        .from(reservations)
        .where(
          and(
            eq(reservations.storeId, storeId),
            eq(reservations.status, 'completed'),
            gte(reservations.createdAt, firstDayOfLastMonth),
            lte(reservations.createdAt, lastDayOfLastMonth)
          )
        ),
      db
        .select({
          total: sql<string>`COALESCE(SUM(${reservations.totalAmount}), 0)`,
        })
        .from(reservations)
        .where(
          and(
            eq(reservations.storeId, storeId),
            eq(reservations.status, 'completed')
          )
        ),
    ]),
  ])

  return {
    // Catalog
    productCount: productStats[0]?.total || 0,
    activeProductCount: Number(productStats[0]?.active) || 0,
    draftProductCount: Number(productStats[0]?.draft) || 0,

    // Customers
    customerCount: customerStats[0]?.total || 0,
    newCustomersThisMonth: Number(customerStats[0]?.newThisMonth) || 0,

    // Reservations
    totalReservations: reservationStats[0]?.total || 0,
    completedReservations: Number(reservationStats[0]?.completed) || 0,
    pendingReservations: Number(reservationStats[0]?.pending) || 0,
    confirmedReservations: Number(reservationStats[0]?.confirmed) || 0,
    ongoingReservations: Number(reservationStats[0]?.ongoing) || 0,

    // Today's operations
    todaysDepartures: todaysOperations[0][0]?.count || 0,
    todaysReturns: todaysOperations[1][0]?.count || 0,

    // Financial
    monthlyRevenue: parseFloat(revenueStats[0][0]?.total || '0'),
    lastMonthRevenue: parseFloat(revenueStats[1][0]?.total || '0'),
    allTimeRevenue: parseFloat(revenueStats[2][0]?.total || '0'),
  }
}

/**
 * Get the time of day for contextual greetings
 */
export function getTimeOfDay(): 'morning' | 'afternoon' | 'evening' {
  const hour = new Date().getHours()

  if (hour >= 6 && hour < 12) {
    return 'morning'
  }

  if (hour >= 12 && hour < 18) {
    return 'afternoon'
  }

  return 'evening'
}
