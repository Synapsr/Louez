import { and, count, eq, gte, lt, notExists, sql } from 'drizzle-orm';

import { customers, db, isPaymentReceiptSql, payments, products, reservations } from '@louez/db';

import type { StoreDay } from './util.store-day';

/**
 * Store metrics for adaptive dashboard
 */
export interface StoreMetrics {
  // Catalog
  productCount: number;
  activeProductCount: number;
  draftProductCount: number;

  // Customers
  customerCount: number;
  newCustomersThisMonth: number;

  // Reservations
  totalReservations: number;
  reservationsThisMonth: number;
  completedReservations: number;
  /** Requests waiting on the owner (online checkouts underway excluded). */
  pendingReservations: number;
  confirmedReservations: number;
  ongoingReservations: number;

  // Today's operations
  todaysDepartures: number;
  todaysReturns: number;

  // Left over from previous days: never handed over, or never brought back.
  overdueDepartures: number;
  overdueReturns: number;

  // Financial, month to date against the same stretch of the previous month
  monthlyRevenue: number;
  previousPeriodRevenue: number;
}

/**
 * Store state based on metrics
 */
export type StoreState =
  | 'virgin' // No products and no history
  | 'building' // Has products, no customers
  | 'starting' // Has customers, few reservations
  | 'active' // Regular activity
  | 'established'; // High volume

/**
 * A pending reservation that waits on the owner. One whose online payment is
 * underway is not: it confirms itself when paid, or lapses with the checkout.
 */
export const awaitsOwnerDecisionSql = () =>
  and(
    eq(reservations.status, 'pending'),
    notExists(
      db
        .select({ id: payments.id })
        .from(payments)
        .where(
          and(
            eq(payments.reservationId, reservations.id),
            eq(payments.method, 'stripe'),
            eq(payments.type, 'rental'),
            eq(payments.status, 'pending'),
          ),
        ),
    ),
  );

/**
 * Completed rental payments, every method included (Stripe and manual alike).
 * Deposits stay out through the `rental` type filter; refunds are stored as
 * `rental` rows too, so they are excluded explicitly.
 */
async function getRentalRevenue(params: {
  storeId: string;
  startDate: Date;
  endDate: Date;
}): Promise<number> {
  const { storeId, startDate, endDate } = params;

  const result = await db
    .select({ revenue: sql<string>`COALESCE(SUM(${payments.amount}), 0)` })
    .from(payments)
    .innerJoin(reservations, eq(payments.reservationId, reservations.id))
    .where(
      and(
        eq(reservations.storeId, storeId),
        eq(payments.status, 'completed'),
        eq(payments.type, 'rental'),
        isPaymentReceiptSql(),
        sql`COALESCE(${payments.paidAt}, ${payments.createdAt}) >= ${startDate}`,
        sql`COALESCE(${payments.paidAt}, ${payments.createdAt}) <= ${endDate}`,
      ),
    );

  return parseFloat(result[0]?.revenue || '0');
}

/**
 * Determine the store state based on metrics. A store that has taken
 * reservations is never "virgin" again, even with every product archived:
 * it must not fall back into the first-day guidance.
 */
export function determineStoreState(metrics: StoreMetrics): StoreState {
  const { activeProductCount, customerCount, completedReservations, totalReservations } = metrics;

  if (activeProductCount === 0 && totalReservations === 0) {
    return 'virgin';
  }

  if (customerCount === 0) {
    return 'building';
  }

  if (completedReservations < 5) {
    return 'starting';
  }

  if (completedReservations < 50) {
    return 'active';
  }

  return 'established';
}

/**
 * Get all metrics for a store, on the store's own calendar.
 */
export async function getStoreMetrics(storeId: string, day: StoreDay): Promise<StoreMetrics> {
  const { todayStart, tomorrowStart, monthStart } = day;

  // Execute all queries in parallel for performance
  const [
    productStats,
    customerStats,
    reservationStats,
    todaysOperations,
    monthlyRevenue,
    previousPeriodRevenue,
    awaitingOwner,
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
        newThisMonth: sql<number>`SUM(CASE WHEN ${customers.createdAt} >= ${monthStart} THEN 1 ELSE 0 END)`,
      })
      .from(customers)
      .where(eq(customers.storeId, storeId)),

    // Reservation counts by status
    db
      .select({
        total: count(),
        thisMonth: sql<number>`SUM(CASE WHEN ${reservations.createdAt} >= ${monthStart} THEN 1 ELSE 0 END)`,
        completed: sql<number>`SUM(CASE WHEN ${reservations.status} = 'completed' THEN 1 ELSE 0 END)`,
        confirmed: sql<number>`SUM(CASE WHEN ${reservations.status} = 'confirmed' THEN 1 ELSE 0 END)`,
        ongoing: sql<number>`SUM(CASE WHEN ${reservations.status} = 'ongoing' THEN 1 ELSE 0 END)`,
        overdueDepartures: sql<number>`SUM(CASE WHEN ${reservations.status} = 'confirmed' AND ${reservations.startDate} < ${todayStart} THEN 1 ELSE 0 END)`,
        overdueReturns: sql<number>`SUM(CASE WHEN ${reservations.status} = 'ongoing' AND ${reservations.endDate} < ${todayStart} THEN 1 ELSE 0 END)`,
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
            gte(reservations.startDate, todayStart),
            lt(reservations.startDate, tomorrowStart),
          ),
        ),
      db
        .select({ count: count() })
        .from(reservations)
        .where(
          and(
            eq(reservations.storeId, storeId),
            eq(reservations.status, 'ongoing'),
            gte(reservations.endDate, todayStart),
            lt(reservations.endDate, tomorrowStart),
          ),
        ),
    ]),

    getRentalRevenue({ storeId, startDate: monthStart, endDate: day.now }),
    getRentalRevenue({
      storeId,
      startDate: day.previousMonthStart,
      endDate: day.previousMonthNow,
    }),
    db
      .select({ count: count() })
      .from(reservations)
      .where(and(eq(reservations.storeId, storeId), awaitsOwnerDecisionSql())),
  ]);

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
    reservationsThisMonth: Number(reservationStats[0]?.thisMonth) || 0,
    completedReservations: Number(reservationStats[0]?.completed) || 0,
    pendingReservations: awaitingOwner[0]?.count || 0,
    confirmedReservations: Number(reservationStats[0]?.confirmed) || 0,
    ongoingReservations: Number(reservationStats[0]?.ongoing) || 0,

    // Today's operations
    todaysDepartures: todaysOperations[0][0]?.count || 0,
    todaysReturns: todaysOperations[1][0]?.count || 0,

    overdueDepartures: Number(reservationStats[0]?.overdueDepartures) || 0,
    overdueReturns: Number(reservationStats[0]?.overdueReturns) || 0,

    // Financial
    monthlyRevenue,
    previousPeriodRevenue,
  };
}
