import { and, count, eq, gte, lt, sql } from "drizzle-orm";

import { customers, db, products, reservations } from "@louez/db";

import { getReceiptTotals, instantSql, type SalesStore } from "./sales-analytics";
import { getStoreCalendar, type StoreCalendar } from "./sales-window";

/**
 * The figures of the dashboard's home, live from the store's records: the
 * catalog, the customers, the reservations, today's departures and returns,
 * and the rental payments received (as the sales pages count them, in the
 * store's currency). Today and the month are the store's, in its time zone.
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
  completedReservations: number;
  pendingReservations: number;
  confirmedReservations: number;
  ongoingReservations: number;

  // Today's operations
  todaysDepartures: number;
  todaysReturns: number;

  // Financial: rental payments received
  todaysRevenue: number;
  monthlyRevenue: number;
  lastMonthRevenue: number;
  allTimeRevenue: number;

  /** The day and the months these figures cover. */
  calendar: StoreCalendar;
}

export async function getStoreMetrics(
  store: SalesStore,
  options: { timezone: string | null | undefined; now?: Date },
): Promise<StoreMetrics> {
  const storeId = store.id;
  const now = options.now ?? new Date();
  const calendar = getStoreCalendar(now, options.timezone);
  const { todayStart, tomorrowStart, monthStart, lastMonthStart } = calendar;

  const [
    productStats,
    customerStats,
    reservationStats,
    departures,
    returns,
    today,
    month,
    lastMonth,
    allTime,
  ] = await Promise.all([
    db
      .select({
        total: count(),
        active: sql<number>`SUM(CASE WHEN ${products.status} = 'active' THEN 1 ELSE 0 END)`,
        draft: sql<number>`SUM(CASE WHEN ${products.status} = 'draft' THEN 1 ELSE 0 END)`,
      })
      .from(products)
      .where(eq(products.storeId, storeId)),
    db
      .select({
        total: count(),
        newThisMonth: sql<number>`SUM(CASE WHEN ${customers.createdAt} >= ${instantSql(monthStart)} THEN 1 ELSE 0 END)`,
      })
      .from(customers)
      .where(eq(customers.storeId, storeId)),
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
    db
      .select({ count: count() })
      .from(reservations)
      .where(
        and(
          eq(reservations.storeId, storeId),
          eq(reservations.status, "confirmed"),
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
          eq(reservations.status, "ongoing"),
          gte(reservations.endDate, todayStart),
          lt(reservations.endDate, tomorrowStart),
        ),
      ),
    getReceiptTotals(store, { start: todayStart, end: now }),
    getReceiptTotals(store, { start: monthStart, end: now }),
    getReceiptTotals(store, { start: lastMonthStart, end: monthStart }),
    getReceiptTotals(store, { end: now }),
  ]);

  return {
    productCount: productStats[0]?.total || 0,
    activeProductCount: Number(productStats[0]?.active) || 0,
    draftProductCount: Number(productStats[0]?.draft) || 0,

    customerCount: customerStats[0]?.total || 0,
    newCustomersThisMonth: Number(customerStats[0]?.newThisMonth) || 0,

    totalReservations: reservationStats[0]?.total || 0,
    completedReservations: Number(reservationStats[0]?.completed) || 0,
    pendingReservations: Number(reservationStats[0]?.pending) || 0,
    confirmedReservations: Number(reservationStats[0]?.confirmed) || 0,
    ongoingReservations: Number(reservationStats[0]?.ongoing) || 0,

    todaysDepartures: departures[0]?.count || 0,
    todaysReturns: returns[0]?.count || 0,

    todaysRevenue: today.revenue,
    monthlyRevenue: month.revenue,
    lastMonthRevenue: lastMonth.revenue,
    allTimeRevenue: allTime.revenue,

    calendar,
  };
}
