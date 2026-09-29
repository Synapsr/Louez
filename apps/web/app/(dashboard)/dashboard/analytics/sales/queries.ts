import type { Locale as DateFnsLocale } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { and, count, desc, eq, sql } from "drizzle-orm";
import {
  db,
  customers,
  isPaymentReceiptSql,
  payments,
  products,
  reservationItems,
  reservations,
} from "@louez/db";
import type { PaymentMethodKey, PaymentMethodTotal } from "./payment-methods-breakdown";
import {
  allocateSalesAmounts,
  getSalesGrowth,
  roundSalesAmount,
  type SalesWindow,
} from "./util.sales-window";

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
  isPaymentReceiptSql(),
];

/** A payment counts on the day it was cashed in, falling back to its creation. */
const receiptDate = sql`COALESCE(${payments.paidAt}, ${payments.createdAt})`;

export async function getSalesPaymentStats(
  storeId: string,
  window: SalesWindow,
): Promise<{
  periodRevenue: number;
  periodPaymentCount: number;
  avgPaymentValue: number;
  revenueGrowth: number | null;
  totalRevenue: number;
}> {
  const aggregate = async (start?: Date, end = window.end) => {
    const [row] = await db
      .select({
        revenue: sql<string>`COALESCE(SUM(${payments.amount}), 0)`,
        paymentCount: count(),
      })
      .from(payments)
      .innerJoin(reservations, eq(payments.reservationId, reservations.id))
      .where(
        and(
          ...rentalReceiptConditions(storeId),
          ...(start ? [sql`${receiptDate} >= ${start}`] : []),
          sql`${receiptDate} < ${end}`,
        ),
      );
    return { revenue: Number(row?.revenue ?? 0), paymentCount: Number(row?.paymentCount ?? 0) };
  };
  const [current, previous, allTime] = await Promise.all([
    aggregate(window.start),
    aggregate(window.previousStart, window.previousEnd),
    aggregate(),
  ]);
  return {
    periodRevenue: current.revenue,
    periodPaymentCount: current.paymentCount,
    avgPaymentValue: current.paymentCount ? current.revenue / current.paymentCount : 0,
    revenueGrowth: getSalesGrowth(current.revenue, previous.revenue),
    totalRevenue: allTime.revenue,
  };
}

/** Bucket boundaries are instants, so grouping does not depend on MySQL timezone tables. */
export async function getRevenueTimeSeries(
  storeId: string,
  window: SalesWindow,
  locale: DateFnsLocale,
): Promise<RevenueTimeSeriesPoint[]> {
  if (window.buckets.length === 0) return [];
  const bucketExpression = sql`CASE ${sql.join(
    window.buckets.map((bucket, index) => sql`WHEN ${receiptDate} < ${bucket.end} THEN ${index}`),
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
        ...rentalReceiptConditions(storeId),
        sql`${receiptDate} >= ${window.start}`,
        sql`${receiptDate} < ${window.end}`,
      ),
    )
    .groupBy(bucketExpression);
  const byBucket = new Map(rows.map((row) => [Number(row.bucket), row]));
  return window.buckets.map((bucket, index) => ({
    label: formatInTimeZone(
      bucket.start,
      window.timezone,
      window.granularity === "month" ? "MMM yyyy" : "d MMM",
      { locale },
    ),
    revenue: Number(byBucket.get(index)?.total ?? 0),
    payments: Number(byBucket.get(index)?.count ?? 0),
  }));
}

/** Receipts split by payment method over the selected window. */
export async function getRevenueByPaymentMethod(
  storeId: string,
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
    .where(
      and(
        ...rentalReceiptConditions(storeId),
        sql`${receiptDate} >= ${window.start}`,
        sql`${receiptDate} < ${window.end}`,
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
  catalogRevenue: number;
  totalRevenue: number;
  nonCatalogRevenue: number;
  unallocatedRevenue: number;
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
  window: SalesWindow,
): Promise<TopProductsByRevenue> {
  const paymentTotals = db
    .select({
      reservationId: payments.reservationId,
      paidAmount: sql<string>`COALESCE(SUM(${payments.amount}), 0)`.as("paid_amount"),
    })
    .from(payments)
    .innerJoin(reservations, eq(payments.reservationId, reservations.id))
    .where(
      and(
        ...rentalReceiptConditions(storeId),
        sql`${receiptDate} >= ${window.start}`,
        sql`${receiptDate} < ${window.end}`,
      ),
    )
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
        and(eq(reservationItems.productId, products.id), eq(products.storeId, storeId)),
      )
      .groupBy(reservationItems.productId, products.name)
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
        and(eq(reservationItems.productId, products.id), eq(products.storeId, storeId)),
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
      .slice(0, 10)
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
  storeId: string,
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
    .where(
      and(
        ...rentalReceiptConditions(storeId),
        sql`${receiptDate} >= ${window.start}`,
        sql`${receiptDate} < ${window.end}`,
      ),
    )
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
