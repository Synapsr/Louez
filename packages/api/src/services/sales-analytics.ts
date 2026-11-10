import { alias } from "drizzle-orm/mysql-core";
import { and, count, desc, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import {
  db,
  customers,
  effectiveProductQuantitySql,
  isPaymentReceiptSql,
  isStripeRefundPaymentSql,
  payments,
  products,
  reservationItems,
  reservations,
} from "@louez/db";

import {
  allocateSalesAmounts,
  getSalesGrowth,
  roundSalesAmount,
  type SalesWindow,
} from "./sales-window";

/**
 * The sales figures of a store, as the dashboard's sales pages, its home and
 * the statistics procedures show them, computed live from payments and
 * reservations. Revenue is the rental payments received: completed `rental`
 * payments, every method, counted on the day they were cashed in, in the
 * store's current currency.
 */

export type PaymentMethodKey = "stripe" | "cash" | "card" | "transfer" | "check" | "other";

export interface PaymentMethodTotal {
  method: PaymentMethodKey;
  amount: number;
  count: number;
}

export interface RevenueBucket {
  start: Date;
  end: Date;
  revenue: number;
  payments: number;
}

/** The store the figures are counted for, and the one currency they add up. */
export interface SalesStore {
  id: string;
  /** ISO 4217, upper case: the store's current currency. */
  currency: string;
}

/** A store as its settings describe it, for its sales figures. */
export function salesStore(store: {
  id: string;
  settings: { currency?: string | null } | null;
}): SalesStore {
  return { id: store.id, currency: (store.settings?.currency || "EUR").toUpperCase() };
}

/**
 * A receipt's currency, as billing reads it (Q4): a Stripe payment's own,
 * any other payment's its reservation's, since a manual payment's column only
 * holds the "EUR" default. Rows from before reservations froze theirs take
 * the store's.
 */
const receiptCurrency = (store: SalesStore) =>
  sql<string>`UPPER(COALESCE(CASE WHEN ${payments.method} = 'stripe' THEN NULLIF(${payments.currency}, '') END, NULLIF(${reservations.currency}, ''), ${store.currency}))`;

/** A reservation's currency: the one frozen on it, else (older rows) the store's. */
const reservationCurrency = (store: SalesStore) =>
  sql<string>`UPPER(COALESCE(NULLIF(${reservations.currency}, ''), ${store.currency}))`;

/** The store's rental receipts, all payment methods, in any currency. */
const anyCurrencyReceiptConditions = (storeFilter: SQL) => [
  storeFilter,
  eq(payments.status, "completed"),
  eq(payments.type, "rental"),
  isPaymentReceiptSql(),
];

/**
 * What the sales figures count as revenue: those receipts in the store's
 * current currency. A total has one currency, so a receipt in another one
 * (taken before the store changed currency) is left out, and reported apart
 * by getOtherCurrencyReceipts.
 */
const rentalReceiptConditions = (store: SalesStore) => [
  ...anyCurrencyReceiptConditions(eq(reservations.storeId, store.id)),
  sql`${receiptCurrency(store)} = ${store.currency}`,
];

/** A payment counts on the day it was cashed in, falling back to its creation. */
const receiptDate = sql`COALESCE(${payments.paidAt}, ${payments.createdAt})`;

/**
 * An instant inside raw SQL, written as the timestamp columns store it (UTC).
 * A bare Date would reach the driver as the server's local time.
 */
export const instantSql = (date: Date) => sql.param(date, payments.createdAt);

const receiptRange = (range: { start?: Date; end: Date }) => [
  ...(range.start ? [sql`${receiptDate} >= ${instantSql(range.start)}`] : []),
  sql`${receiptDate} < ${instantSql(range.end)}`,
];

/** Receipts from `start` (included; since the first one without it) to `end` (excluded). */
export async function getReceiptTotals(
  store: SalesStore,
  range: { start?: Date; end: Date },
): Promise<{ revenue: number; paymentCount: number }> {
  const [row] = await db
    .select({
      revenue: sql<string>`COALESCE(SUM(${payments.amount}), 0)`,
      paymentCount: count(),
    })
    .from(payments)
    .innerJoin(reservations, eq(payments.reservationId, reservations.id))
    .where(and(...rentalReceiptConditions(store), ...receiptRange(range)));
  return { revenue: Number(row?.revenue ?? 0), paymentCount: Number(row?.paymentCount ?? 0) };
}

export interface OtherCurrencyReceipts {
  /** ISO 4217, upper case. */
  currency: string;
  /** In that currency. */
  amount: number;
  paymentCount: number;
}

/**
 * The receipts the sales figures leave out because they are in another
 * currency than the store's current one, per currency, over the range.
 */
export async function getOtherCurrencyReceipts(
  store: SalesStore,
  range: { start?: Date; end: Date },
): Promise<OtherCurrencyReceipts[]> {
  const currency = receiptCurrency(store);
  const rows = await db
    .select({
      currency,
      amount: sql<string>`COALESCE(SUM(${payments.amount}), 0)`,
      paymentCount: count(),
    })
    .from(payments)
    .innerJoin(reservations, eq(payments.reservationId, reservations.id))
    .where(
      and(
        ...anyCurrencyReceiptConditions(eq(reservations.storeId, store.id)),
        sql`${currency} <> ${store.currency}`,
        ...receiptRange(range),
      ),
    )
    .groupBy(currency)
    .orderBy(currency);
  return rows.map((row) => ({
    currency: String(row.currency),
    amount: Number(row.amount ?? 0),
    paymentCount: Number(row.paymentCount ?? 0),
  }));
}

export async function getSalesPaymentStats(
  store: SalesStore,
  window: SalesWindow,
): Promise<{
  periodRevenue: number;
  periodPaymentCount: number;
  avgPaymentValue: number;
  revenueGrowth: number | null;
  totalRevenue: number;
}> {
  const [current, previous, allTime] = await Promise.all([
    getReceiptTotals(store, { start: window.start, end: window.end }),
    getReceiptTotals(store, { start: window.previousStart, end: window.previousEnd }),
    getReceiptTotals(store, { end: window.end }),
  ]);
  return {
    periodRevenue: current.revenue,
    periodPaymentCount: current.paymentCount,
    avgPaymentValue: current.paymentCount ? current.revenue / current.paymentCount : 0,
    revenueGrowth: getSalesGrowth(current.revenue, previous.revenue),
    totalRevenue: allTime.revenue,
  };
}

/**
 * The window's receipts per bucket, as the revenue chart shows them. Bucket
 * boundaries are instants, so grouping does not depend on MySQL timezone
 * tables.
 */
export async function getRevenueTimeSeries(
  store: SalesStore,
  window: SalesWindow,
): Promise<RevenueBucket[]> {
  const { buckets } = window;
  const series = buckets.map((bucket) => ({
    start: bucket.start,
    end: bucket.end,
    revenue: 0,
    payments: 0,
  }));
  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  if (!first || !last) return series;
  const bucketExpression = sql`CASE ${sql.join(
    buckets.map(
      (bucket, index) => sql`WHEN ${receiptDate} < ${instantSql(bucket.end)} THEN ${index}`,
    ),
    sql` `,
  )} END`;
  const rows = await db
    .select({
      bucket: sql<number>`${bucketExpression}`,
      total: sql<string>`COALESCE(SUM(${payments.amount}), 0)`,
      count: count(),
    })
    .from(payments)
    .innerJoin(reservations, eq(payments.reservationId, reservations.id))
    .where(
      and(
        ...rentalReceiptConditions(store),
        ...receiptRange({ start: first.start, end: last.end }),
      ),
    )
    .groupBy(bucketExpression);
  for (const row of rows) {
    const bucket = series[Number(row.bucket)];
    if (!bucket) continue;
    bucket.revenue = Number(row.total ?? 0);
    bucket.payments = Number(row.count ?? 0);
  }
  return series;
}

/** Receipts split by payment method over the selected window. */
export async function getRevenueByPaymentMethod(
  store: SalesStore,
  window: SalesWindow,
): Promise<PaymentMethodTotal[]> {
  const rows = await db
    .select({
      method: payments.method,
      total: sql<string>`COALESCE(SUM(${payments.amount}), 0)`,
      count: count(),
    })
    .from(payments)
    .innerJoin(reservations, eq(payments.reservationId, reservations.id))
    .where(and(...rentalReceiptConditions(store), ...receiptRange(window)))
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
  productSlug: string | null;
  productStatus: "draft" | "active" | "archived" | null;
  totalQuantity: number;
  totalRevenue: string;
  reservationCount: number;
}

export interface TopProductsByRevenue {
  products: TopProductRow[];
  /** Allocated receipts of every product over the window, ranked or not. */
  catalogRevenue: number;
  totalRevenue: number;
  nonCatalogRevenue: number;
  unallocatedRevenue: number;
  /** Distinct products that brought receipts over the window. */
  productCount: number;
}

/**
 * The `limit` top products by allocated receipts, plus the totals the table
 * needs to reconcile its rows with the period receipts KPI: a reservation's
 * receipts are split across its items in proportion to their price, so
 * summing every product gives back the period's receipts rather than a
 * partial view.
 */
export async function getTopProductsByRevenue(
  store: SalesStore,
  window: SalesWindow,
  limit = 10,
): Promise<TopProductsByRevenue> {
  const paymentTotals = db
    .select({
      reservationId: payments.reservationId,
      paidAmount: sql<string>`COALESCE(SUM(${payments.amount}), 0)`.as("paid_amount"),
    })
    .from(payments)
    .innerJoin(reservations, eq(payments.reservationId, reservations.id))
    .where(and(...rentalReceiptConditions(store), ...receiptRange(window)))
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

  const [topProducts, totals, receiptTotals] = await Promise.all([
    db
      .select({
        productId: reservationItems.productId,
        productName: products.name,
        productSlug: products.slug,
        productStatus: products.status,
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
      .innerJoin(
        products,
        and(eq(reservationItems.productId, products.id), eq(products.storeId, store.id)),
      )
      .groupBy(reservationItems.productId, products.name, products.slug, products.status)
      .orderBy(desc(sql`SUM(${allocatedRevenue})`), products.id),
    db
      .select({
        catalogRevenue: sql<string>`COALESCE(SUM(CASE WHEN ${products.id} IS NOT NULL THEN ${allocatedRevenue} ELSE 0 END), 0)`,
        nonCatalogRevenue: sql<string>`COALESCE(SUM(CASE WHEN ${products.id} IS NULL THEN ${allocatedRevenue} ELSE 0 END), 0)`,
        productCount: sql<number>`COUNT(DISTINCT ${products.id})`,
      })
      .from(reservationItems)
      .innerJoin(paymentTotals, eq(reservationItems.reservationId, paymentTotals.reservationId))
      .innerJoin(
        reservationItemTotals,
        eq(reservationItems.reservationId, reservationItemTotals.reservationId),
      )
      .leftJoin(
        products,
        and(eq(reservationItems.productId, products.id), eq(products.storeId, store.id)),
      ),
    db
      .select({ total: sql<string>`COALESCE(SUM(${paymentTotals.paidAmount}), 0)` })
      .from(paymentTotals),
  ]);

  const totalRevenue = Number(receiptTotals[0]?.total ?? 0);
  const rawNonCatalog = Number(totals[0]?.nonCatalogRevenue ?? 0);
  const rawUnallocated = Math.max(
    0,
    totalRevenue - Number(totals[0]?.catalogRevenue ?? 0) - rawNonCatalog,
  );
  const amounts = allocateSalesAmounts(
    [...topProducts.map((product) => Number(product.totalRevenue)), rawNonCatalog, rawUnallocated],
    totalRevenue,
  );
  const nonCatalogRevenue = amounts[topProducts.length] ?? 0;
  const unallocatedRevenue = amounts[topProducts.length + 1] ?? 0;
  return {
    products: topProducts
      .slice(0, limit)
      .map((product, index) => ({ ...product, totalRevenue: (amounts[index] ?? 0).toFixed(2) })),
    catalogRevenue: roundSalesAmount(totalRevenue - nonCatalogRevenue - unallocatedRevenue),
    totalRevenue,
    nonCatalogRevenue,
    unallocatedRevenue,
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
  store: SalesStore,
  window: SalesWindow,
): Promise<TopCustomerRow[]> {
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
    .where(and(...rentalReceiptConditions(store), ...receiptRange(window)))
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

// --- Rentals ------------------------------------------------------------------

type ReservationStatus = (typeof reservations.status.enumValues)[number];

/** Reservations that actually mobilise units — quotes and cancellations excluded. */
const OCCUPYING_STATUSES: ReservationStatus[] = ["confirmed", "ongoing", "completed"];

/** Reservations that count as booked activity, whatever their outcome so far. */
const BOOKED_STATUSES: ReservationStatus[] = ["pending", "confirmed", "ongoing", "completed"];

const MINUTES_PER_DAY = 1440;
const MS_PER_DAY = MINUTES_PER_DAY * 60_000;

export interface OccupancyStats {
  /** Occupied unit-days over available unit-days, in percent. */
  rate: number;
  /** Units the active catalog offers — the denominator's fleet size. */
  availableUnits: number;
}

/**
 * How much of the fleet was actually out over the window: every reservation
 * item contributes `quantity × days` for the part of its stay that falls inside
 * the window, measured against the unit-days the active catalog could offer.
 */
export async function getOccupancyStats(
  storeId: string,
  window: SalesWindow,
): Promise<OccupancyStats> {
  const { start, end } = window;
  const days = (end.getTime() - start.getTime()) / MS_PER_DAY;

  const [occupied, fleet] = await Promise.all([
    db
      .select({
        unitDays: sql<string>`COALESCE(SUM(${reservationItems.quantity} * GREATEST(TIMESTAMPDIFF(MINUTE, GREATEST(${reservations.startDate}, ${instantSql(start)}), LEAST(${reservations.endDate}, ${instantSql(end)})), 0) / ${MINUTES_PER_DAY}), 0)`,
      })
      .from(reservationItems)
      .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
      .innerJoin(products, eq(reservationItems.productId, products.id))
      .where(
        and(
          eq(reservations.storeId, storeId),
          eq(products.storeId, storeId),
          eq(products.status, "active"),
          eq(products.stockKind, "returnable"),
          inArray(reservations.status, OCCUPYING_STATUSES),
          // Only the stays overlapping the window can contribute unit-days.
          lt(reservations.startDate, end),
          gte(reservations.endDate, start),
        ),
      ),
    db
      .select({ units: sql<string>`COALESCE(SUM(${effectiveProductQuantitySql()}), 0)` })
      .from(products)
      .where(
        and(
          eq(products.storeId, storeId),
          eq(products.status, "active"),
          eq(products.stockKind, "returnable"),
        ),
      ),
  ]);

  const availableUnits = Number(fleet[0]?.units || 0);
  const availableUnitDays = availableUnits * days;
  const occupiedUnitDays = parseFloat(occupied[0]?.unitDays || "0");

  return {
    rate: availableUnitDays > 0 ? (occupiedUnitDays / availableUnitDays) * 100 : 0,
    availableUnits,
  };
}

export interface UpcomingRevenueStats {
  revenue: number;
  reservationCount: number;
}

/** Outstanding rental balances of confirmed future reservations, after rental refunds. */
export async function getUpcomingRevenue(
  store: SalesStore,
  now: Date,
): Promise<UpcomingRevenueStats> {
  const original = alias(payments, "original_payment");
  const paid = db
    .select({
      reservationId: payments.reservationId,
      amount: sql<string>`SUM(CASE
      WHEN ${isStripeRefundPaymentSql()} THEN 0
      WHEN ${payments.refundOfPaymentId} IS NULL AND ${payments.type} = 'rental' THEN ${payments.amount}
      WHEN ${original.type} = 'rental' AND ${original.status} = 'completed' THEN -${payments.amount}
      ELSE 0 END)`.as("net_paid"),
    })
    .from(payments)
    .innerJoin(reservations, eq(payments.reservationId, reservations.id))
    .leftJoin(
      original,
      and(
        eq(payments.refundOfPaymentId, original.id),
        eq(payments.reservationId, original.reservationId),
      ),
    )
    .where(
      and(
        eq(reservations.storeId, store.id),
        eq(payments.status, "completed"),
        sql`${receiptDate} < ${instantSql(now)}`,
        // Only a payment in the balance's currency pays it off.
        sql`${receiptCurrency(store)} = ${reservationCurrency(store)}`,
      ),
    )
    .groupBy(payments.reservationId)
    .as("rental_paid");

  // Match the reservation payment form's handling of older totals that include a deposit.
  const rentalAmount = sql`CASE
    WHEN ${reservations.totalAmount} <= 0 THEN ${reservations.subtotalAmount}
    WHEN ${reservations.depositAmount} > 0 AND ${reservations.totalAmount} - ${reservations.subtotalAmount} >= ${reservations.depositAmount} - 0.01
      THEN GREATEST(0, ${reservations.totalAmount} - ${reservations.depositAmount})
    ELSE ${reservations.totalAmount} END`;
  const remaining = sql`GREATEST(0, ${rentalAmount} - GREATEST(0, COALESCE(${paid.amount}, 0)))`;
  const [row] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${remaining}), 0)`,
      reservationCount: count(),
    })
    .from(reservations)
    .leftJoin(paid, eq(paid.reservationId, reservations.id))
    .where(
      and(
        eq(reservations.storeId, store.id),
        // A balance is in its reservation's currency: only the store's adds up.
        sql`${reservationCurrency(store)} = ${store.currency}`,
        eq(reservations.status, "confirmed"),
        gte(reservations.startDate, now),
        sql`${remaining} > 0`,
      ),
    );
  return { revenue: Number(row?.total ?? 0), reservationCount: Number(row?.reservationCount ?? 0) };
}

export interface AverageRentalDurationStats {
  /** `null` when no reservation started over the window. */
  avgMinutes: number | null;
  reservationCount: number;
}

/** Average stay length of the reservations that started over the window. */
export async function getAverageRentalDuration(
  storeId: string,
  window: SalesWindow,
): Promise<AverageRentalDurationStats> {
  const { start, end } = window;

  const rows = await db
    .select({
      avgMinutes: sql<
        string | null
      >`AVG(TIMESTAMPDIFF(MINUTE, ${reservations.startDate}, ${reservations.endDate}))`,
      reservationCount: count(),
    })
    .from(reservations)
    .where(
      and(
        eq(reservations.storeId, storeId),
        inArray(reservations.status, OCCUPYING_STATUSES),
        gte(reservations.startDate, start),
        lt(reservations.startDate, end),
      ),
    );

  const avgMinutes = rows[0]?.avgMinutes;

  return {
    avgMinutes: avgMinutes === null || avgMinutes === undefined ? null : Number(avgMinutes),
    reservationCount: rows[0]?.reservationCount || 0,
  };
}

export interface PeriodReservationStats {
  reservationCount: number;
  growth: number | null;
}

/**
 * Reservations starting over the window, compared with the window of the same
 * length right before it.
 */
export async function getPeriodReservationStats(
  storeId: string,
  window: SalesWindow,
): Promise<PeriodReservationStats> {
  const { start, end } = window;
  const countStartingBetween = (from: Date, to: Date) =>
    db
      .select({ reservationCount: count() })
      .from(reservations)
      .where(
        and(
          eq(reservations.storeId, storeId),
          inArray(reservations.status, BOOKED_STATUSES),
          gte(reservations.startDate, from),
          lt(reservations.startDate, to),
        ),
      );

  const [current, previous] = await Promise.all([
    countStartingBetween(start, end),
    countStartingBetween(window.previousStart, window.previousEnd),
  ]);

  const reservationCount = current[0]?.reservationCount || 0;
  const previousCount = previous[0]?.reservationCount || 0;

  return {
    reservationCount,
    growth: getSalesGrowth(reservationCount, previousCount),
  };
}
