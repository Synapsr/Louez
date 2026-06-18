import { endOfMonth, startOfMonth, subMonths } from 'date-fns';
import { and, count, eq, gte, lte, sql } from 'drizzle-orm';

import { customers, db, payments, products, reservations } from '@louez/db';

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
  completedReservations: number;
  pendingReservations: number;
  confirmedReservations: number;
  ongoingReservations: number;

  // Today's operations
  todaysDepartures: number;
  todaysReturns: number;

  // Financial
  monthlyRevenue: number;
  lastMonthRevenue: number;
  allTimeRevenue: number;
}

/**
 * Store state based on metrics
 */
export type StoreState =
  | 'virgin' // No products
  | 'building' // Has products, no customers
  | 'starting' // Has customers, few reservations
  | 'active' // Regular activity
  | 'established'; // High volume

interface RentalPaymentStats {
  revenue: number;
  paymentCount: number;
  reservationCount: number;
}

export interface RentalPaymentRevenueStats {
  currentMonthRevenue: number;
  currentMonthCount: number;
  lastMonthRevenue: number;
  lastMonthCount: number;
  totalRevenue: number;
  totalPayments: number;
  totalReservations: number;
  avgOrderValue: number;
  revenueGrowth: number;
}

async function getRentalPaymentStats(params: {
  storeId: string;
  includeManualPayments: boolean;
  startDate?: Date;
  endDate?: Date;
}): Promise<RentalPaymentStats> {
  const { storeId, includeManualPayments, startDate, endDate } = params;
  const dateConditions = [
    ...(startDate
      ? [
          sql`COALESCE(${payments.paidAt}, ${payments.createdAt}) >= ${startDate}`,
        ]
      : []),
    ...(endDate
      ? [sql`COALESCE(${payments.paidAt}, ${payments.createdAt}) <= ${endDate}`]
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
}

export async function getRentalPaymentRevenueStats(params: {
  storeId: string;
  includeManualPayments: boolean;
}): Promise<RentalPaymentRevenueStats> {
  const { storeId, includeManualPayments } = params;
  const now = new Date();
  const currentMonthStart = startOfMonth(now);
  const lastMonthStart = startOfMonth(subMonths(now, 1));
  const lastMonthEnd = endOfMonth(subMonths(now, 1));

  const [currentMonth, lastMonth, allTime] = await Promise.all([
    getRentalPaymentStats({
      storeId,
      includeManualPayments,
      startDate: currentMonthStart,
    }),
    getRentalPaymentStats({
      storeId,
      includeManualPayments,
      startDate: lastMonthStart,
      endDate: lastMonthEnd,
    }),
    getRentalPaymentStats({ storeId, includeManualPayments }),
  ]);

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

/**
 * Determine the store state based on metrics
 */
export function determineStoreState(metrics: StoreMetrics): StoreState {
  const { activeProductCount, customerCount, completedReservations } = metrics;

  if (activeProductCount === 0) {
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
 * Get all metrics for a store
 */
export async function getStoreMetrics(storeId: string): Promise<StoreMetrics> {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

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
            lte(reservations.startDate, tomorrow),
          ),
        ),
      db
        .select({ count: count() })
        .from(reservations)
        .where(
          and(
            eq(reservations.storeId, storeId),
            eq(reservations.status, 'ongoing'),
            gte(reservations.endDate, today),
            lte(reservations.endDate, tomorrow),
          ),
        ),
    ]),

    getRentalPaymentRevenueStats({
      storeId,
      includeManualPayments: true,
    }),
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
    completedReservations: Number(reservationStats[0]?.completed) || 0,
    pendingReservations: Number(reservationStats[0]?.pending) || 0,
    confirmedReservations: Number(reservationStats[0]?.confirmed) || 0,
    ongoingReservations: Number(reservationStats[0]?.ongoing) || 0,

    // Today's operations
    todaysDepartures: todaysOperations[0][0]?.count || 0,
    todaysReturns: todaysOperations[1][0]?.count || 0,

    // Financial
    monthlyRevenue: revenueStats.currentMonthRevenue,
    lastMonthRevenue: revenueStats.lastMonthRevenue,
    allTimeRevenue: revenueStats.totalRevenue,
  };
}

/**
 * Get the time of day for contextual greetings
 */
export function getTimeOfDay(): 'morning' | 'afternoon' | 'evening' {
  const hour = new Date().getHours();

  if (hour >= 6 && hour < 12) {
    return 'morning';
  }

  if (hour >= 12 && hour < 18) {
    return 'afternoon';
  }

  return 'evening';
}
