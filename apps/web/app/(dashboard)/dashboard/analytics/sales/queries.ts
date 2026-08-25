import {
  eachDayOfInterval,
  eachMonthOfInterval,
  endOfDay,
  format,
  startOfDay,
  startOfMonth,
  subDays,
  subMonths,
} from "date-fns";

import { and, count, desc, eq, sql } from "drizzle-orm";

import { db } from "@louez/db";
import { customers, payments, products, reservationItems, reservations } from "@louez/db";

import { getPeriodConfig, type Period } from "../period";
import type { PaymentMethodKey, PaymentMethodTotal } from "./payment-methods-breakdown";
import { FORMAT_DATE_FNS_LOCALE } from "@/lib/i18n/format-locale";

export interface RevenueTimeSeriesPoint {
  label: string;
  revenue: number;
  payments: number;
}

/** Rental receipts, all payment methods: what the sales section counts as revenue. */
const rentalReceiptConditions = (storeId: string) => [
  eq(reservations.storeId, storeId),
  eq(payments.status, "completed"),
  eq(payments.type, "rental"),
];

/** A payment counts on the day it was cashed in, falling back to its creation. */
const receiptDate = sql`COALESCE(${payments.paidAt}, ${payments.createdAt})`;

/** Start of the rolling window ending today, aligned on the bucket size. */
export const getWindowStart = (period: Period, now: Date) => {
  const config = getPeriodConfig(period);

  return config.granularity === "month"
    ? startOfMonth(subMonths(now, config.months - 1))
    : startOfDay(subDays(now, config.days - 1));
};

/**
 * Receipts bucketed over the selected window — one grouped query, then the
 * empty buckets filled with zeros so short periods draw a real curve instead
 * of the single point the previous month-by-month version produced.
 *
 * Buckets are keyed with `DATE_FORMAT` rather than `DATE()`: the driver hands
 * back `DATE` columns as `Date` objects, which makes for a fragile map key.
 */
export async function getRevenueTimeSeries(
  storeId: string,
  period: Period,
): Promise<RevenueTimeSeriesPoint[]> {
  const { granularity } = getPeriodConfig(period);
  const now = new Date();
  const startDate = getWindowStart(period, now);
  const endDate = endOfDay(now);

  const bucketKey = granularity === "month" ? "yyyy-MM" : "yyyy-MM-dd";
  const bucketExpression =
    granularity === "month"
      ? sql<string>`DATE_FORMAT(${receiptDate}, '%Y-%m')`
      : sql<string>`DATE_FORMAT(${receiptDate}, '%Y-%m-%d')`;

  const buckets = await db
    .select({
      bucket: bucketExpression,
      total: sql<string>`COALESCE(SUM(${payments.amount}), 0)`,
      count: count(),
    })
    .from(payments)
    .innerJoin(reservations, eq(payments.reservationId, reservations.id))
    .where(
      and(
        ...rentalReceiptConditions(storeId),
        sql`${receiptDate} >= ${startDate}`,
        sql`${receiptDate} <= ${endDate}`,
      ),
    )
    .groupBy(bucketExpression);

  const bucketsByKey = new Map(buckets.map((bucket) => [bucket.bucket, bucket]));

  const interval = { start: startDate, end: now };
  const timeline =
    granularity === "month" ? eachMonthOfInterval(interval) : eachDayOfInterval(interval);

  return timeline.map((date) => {
    const bucket = bucketsByKey.get(format(date, bucketKey));

    return {
      label: format(date, granularity === "month" ? "MMM yyyy" : "d MMM", { locale: FORMAT_DATE_FNS_LOCALE }),
      revenue: parseFloat(bucket?.total || "0"),
      payments: bucket?.count || 0,
    };
  });
}

/** Receipts split by payment method over the selected window. */
export async function getRevenueByPaymentMethod(
  storeId: string,
  period: Period,
): Promise<PaymentMethodTotal[]> {
  const now = new Date();
  const startDate = getWindowStart(period, now);
  const endDate = endOfDay(now);

  const rows = await db
    .select({
      method: payments.method,
      total: sql<string>`COALESCE(SUM(${payments.amount}), 0)`,
      count: count(),
    })
    .from(payments)
    .innerJoin(reservations, eq(payments.reservationId, reservations.id))
    .where(
      and(
        ...rentalReceiptConditions(storeId),
        sql`${receiptDate} >= ${startDate}`,
        sql`${receiptDate} <= ${endDate}`,
      ),
    )
    .groupBy(payments.method);

  return rows.map((row) => ({
    method: row.method as PaymentMethodKey,
    amount: parseFloat(row.total || "0"),
    count: row.count,
  }));
}

export interface TopProductRow {
  productId: string | null;
  productName: string;
  totalQuantity: number;
  totalRevenue: string;
  reservationCount: number;
}

export interface TopProductsByRevenue {
  products: TopProductRow[];
  /** Allocated receipts of every product over the window, top 10 or not. */
  allProductsRevenue: number;
  /** Distinct products that brought receipts over the window. */
  productCount: number;
}

/**
 * Top products by allocated receipts, plus the totals the table needs to
 * reconcile its ten rows with the period receipts KPI: a reservation's receipts
 * are split across its items in proportion to their price, so summing every
 * product gives back the period's receipts rather than a partial view.
 */
export async function getTopProductsByRevenue(
  storeId: string,
  period: Period,
): Promise<TopProductsByRevenue> {
  const { days } = getPeriodConfig(period);
  // Same bounds as `getRentalPaymentPeriodStats`, so the totals line up with the KPI.
  const startDate = subDays(new Date(), days);

  const paymentTotals = db
    .select({
      reservationId: payments.reservationId,
      paidAmount: sql<string>`COALESCE(SUM(${payments.amount}), 0)`.as("paid_amount"),
    })
    .from(payments)
    .innerJoin(reservations, eq(payments.reservationId, reservations.id))
    .where(and(...rentalReceiptConditions(storeId), sql`${receiptDate} >= ${startDate}`))
    .groupBy(payments.reservationId)
    .as("payment_totals");

  const reservationItemTotals = db
    .select({
      reservationId: reservationItems.reservationId,
      itemTotal: sql<string>`COALESCE(SUM(${reservationItems.totalPrice}), 0)`.as("item_total"),
    })
    .from(reservationItems)
    .groupBy(reservationItems.reservationId)
    .as("reservation_item_totals");

  /** Share of its reservation's receipts an item is worth, by price weight. */
  const allocatedRevenue = sql`CASE WHEN ${reservationItemTotals.itemTotal} > 0 THEN (${paymentTotals.paidAmount} * ${reservationItems.totalPrice}) / ${reservationItemTotals.itemTotal} ELSE 0 END`;

  const [topProducts, totals] = await Promise.all([
    db
      .select({
        productId: reservationItems.productId,
        productName: products.name,
        totalQuantity: sql<number>`SUM(${reservationItems.quantity})`,
        totalRevenue: sql<string>`COALESCE(SUM(${allocatedRevenue}), 0)`,
        reservationCount: sql<number>`COUNT(DISTINCT ${reservationItems.reservationId})`,
      })
      .from(reservationItems)
      .innerJoin(paymentTotals, eq(reservationItems.reservationId, paymentTotals.reservationId))
      .innerJoin(
        reservationItemTotals,
        eq(reservationItems.reservationId, reservationItemTotals.reservationId),
      )
      .innerJoin(products, eq(reservationItems.productId, products.id))
      .groupBy(reservationItems.productId, products.name)
      .orderBy(desc(sql`SUM(${allocatedRevenue})`))
      .limit(10),
    db
      .select({
        allProductsRevenue: sql<string>`COALESCE(SUM(${allocatedRevenue}), 0)`,
        productCount: sql<number>`COUNT(DISTINCT ${reservationItems.productId})`,
      })
      .from(reservationItems)
      .innerJoin(paymentTotals, eq(reservationItems.reservationId, paymentTotals.reservationId))
      .innerJoin(
        reservationItemTotals,
        eq(reservationItems.reservationId, reservationItemTotals.reservationId),
      )
      .innerJoin(products, eq(reservationItems.productId, products.id)),
  ]);

  return {
    products: topProducts,
    allProductsRevenue: parseFloat(totals[0]?.allProductsRevenue || "0"),
    productCount: Number(totals[0]?.productCount || 0),
  };
}

export interface TopCustomerRow {
  customerId: string;
  firstName: string;
  lastName: string;
  companyName: string | null;
  customerType: "individual" | "business";
  totalRevenue: string;
  paymentCount: number;
  reservationCount: number;
}

/** Best customers by receipts over the window — same filters as the receipts KPI. */
export async function getTopCustomersByRevenue(
  storeId: string,
  period: Period,
): Promise<TopCustomerRow[]> {
  const { days } = getPeriodConfig(period);
  const startDate = subDays(new Date(), days);

  return db
    .select({
      customerId: customers.id,
      firstName: customers.firstName,
      lastName: customers.lastName,
      companyName: customers.companyName,
      customerType: customers.customerType,
      totalRevenue: sql<string>`COALESCE(SUM(${payments.amount}), 0)`,
      paymentCount: count(),
      reservationCount: sql<number>`COUNT(DISTINCT ${payments.reservationId})`,
    })
    .from(payments)
    .innerJoin(reservations, eq(payments.reservationId, reservations.id))
    .innerJoin(customers, eq(reservations.customerId, customers.id))
    .where(and(...rentalReceiptConditions(storeId), sql`${receiptDate} >= ${startDate}`))
    .groupBy(
      customers.id,
      customers.firstName,
      customers.lastName,
      customers.companyName,
      customers.customerType,
    )
    .orderBy(desc(sql`SUM(${payments.amount})`))
    .limit(10);
}
