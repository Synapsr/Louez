import { startOfDay } from "date-fns";
import { and, eq, inArray, sql } from "drizzle-orm";

import {
  db,
  isPaymentReceiptSql,
  payments,
  products,
  reservationItems,
  reservations,
} from "@louez/db";

import { allocateReceiptCents, toCents } from "./util.receipt-allocation";

/**
 * How far back each run recomputes product revenue. A receipt counts on the day it
 * was cashed in at its current amount, as on the product page, so a refund or a
 * deleted payment changes that day's figure: the run recomputes every day of the
 * window, the longest period the product performance report covers.
 */
export const PRODUCT_REVENUE_WINDOW_DAYS = 365;

const ITEM_BATCH = 1000;

export interface ProductRevenueByDay {
  /** Day start (ms) → product id → revenue in cents. */
  byDay: Map<number, Map<string, number>>;
  /** Receipts left out because they are in another currency than the store's. */
  skipped: { currency: string; count: number }[];
}

/**
 * Rental receipts cashed in over [start, end), per day and product, in the store's
 * currency: each receipt is split across its reservation's items by price in whole
 * cents (refund rows are not receipts). A product revenue has no currency of its
 * own, so a receipt in another currency is skipped, and counted for the caller to
 * log.
 */
export async function getProductRevenueByDay(input: {
  storeId: string;
  /** The store's currency, upper case. */
  currency: string;
  start: Date;
  end: Date;
}): Promise<ProductRevenueByDay> {
  const receiptDate = sql<Date>`COALESCE(${payments.paidAt}, ${payments.createdAt})`;
  const receipts = await db
    .select({
      id: payments.id,
      reservationId: payments.reservationId,
      amount: payments.amount,
      currency: payments.currency,
      reservationCurrency: reservations.currency,
      receivedAt: receiptDate.mapWith(reservations.createdAt),
    })
    .from(payments)
    .innerJoin(reservations, eq(payments.reservationId, reservations.id))
    .where(
      and(
        eq(reservations.storeId, input.storeId),
        eq(payments.status, "completed"),
        eq(payments.type, "rental"),
        isPaymentReceiptSql(),
        sql`${receiptDate} >= ${input.start}`,
        sql`${receiptDate} < ${input.end}`,
      ),
    );

  const skippedByCurrency = new Map<string, number>();
  const inCurrency = receipts.filter((receipt) => {
    // The payment's own currency, else the one frozen on its reservation, else
    // (rows from before either existed) the store's.
    const currency = (
      receipt.currency ||
      receipt.reservationCurrency ||
      input.currency
    ).toUpperCase();
    if (currency === input.currency) return true;
    skippedByCurrency.set(currency, (skippedByCurrency.get(currency) ?? 0) + 1);
    return false;
  });

  // Only the items of the reservations paid in the window, never the full history.
  const reservationIds = [...new Set(inCurrency.map((receipt) => receipt.reservationId))];
  const itemsByReservation = new Map<
    string,
    { id: string; productId: string | null; weightCents: number }[]
  >();
  for (let index = 0; index < reservationIds.length; index += ITEM_BATCH) {
    const rows = await db
      .select({
        id: reservationItems.id,
        reservationId: reservationItems.reservationId,
        totalPrice: reservationItems.totalPrice,
        // Null for a custom item, or a product of another store: it takes its
        // share of the receipt, counted for no product.
        productId: products.id,
      })
      .from(reservationItems)
      .leftJoin(
        products,
        and(eq(reservationItems.productId, products.id), eq(products.storeId, input.storeId)),
      )
      .where(
        inArray(reservationItems.reservationId, reservationIds.slice(index, index + ITEM_BATCH)),
      );
    for (const row of rows) {
      const items = itemsByReservation.get(row.reservationId) ?? [];
      items.push({ id: row.id, productId: row.productId, weightCents: toCents(row.totalPrice) });
      itemsByReservation.set(row.reservationId, items);
    }
  }

  const byDay = new Map<number, Map<string, number>>();
  for (const receipt of inCurrency) {
    const items = itemsByReservation.get(receipt.reservationId) ?? [];
    const allocation = allocateReceiptCents(toCents(receipt.amount), items);
    const day = startOfDay(receipt.receivedAt).getTime();
    const byProduct = byDay.get(day) ?? new Map<string, number>();
    for (const item of items) {
      const cents = allocation.get(item.id);
      if (!item.productId || !cents) continue;
      byProduct.set(item.productId, (byProduct.get(item.productId) ?? 0) + cents);
    }
    if (byProduct.size > 0) byDay.set(day, byProduct);
  }

  return {
    byDay,
    skipped: [...skippedByCurrency].map(([currency, count]) => ({ currency, count })),
  };
}
