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
 * How far back each run recomputes product revenue and reservations. A receipt
 * counts on the day it was cashed in at its current amount, as on the product
 * page, so a refund or a deleted payment changes that day's figures: the run
 * recomputes every day of the window, the longest period the product performance
 * report covers.
 */
export const PRODUCT_REVENUE_WINDOW_DAYS = 365;

const RESERVATION_BATCH = 1000;

/** One product's figures for one day. */
export interface ProductDaySales {
  revenueCents: number;
  /** Reservations whose first receipt came in that day. */
  reservations: number;
}

export interface ProductSalesByDay {
  /** Day start (ms) → product id → that day's figures. */
  byDay: Map<number, Map<string, ProductDaySales>>;
  /** Receipts left out because they are in another currency than the store's. */
  skipped: { currency: string; count: number }[];
}

/** A completed rental payment that is money received, not a refund. */
const rentalReceiptConditions = () => [
  eq(payments.status, "completed"),
  eq(payments.type, "rental"),
  isPaymentReceiptSql(),
];

const receiptDate = sql<Date>`COALESCE(${payments.paidAt}, ${payments.createdAt})`;

/**
 * A receipt's currency: the payment's own, else the one frozen on its
 * reservation, else (rows from before either existed) the store's.
 */
const receiptCurrency = (
  receipt: { currency: string | null; reservationCurrency: string | null },
  storeCurrency: string,
) => (receipt.currency || receipt.reservationCurrency || storeCurrency).toUpperCase();

/**
 * Rental receipts in the store's currency, per day and product, over [start, end).
 *
 * Revenue: each receipt cashed in that day, split across its reservation's items by
 * price in whole cents (refund rows are not receipts).
 *
 * Reservations: a reservation counts once for each of its products, on the day its
 * first receipt came in, even a receipt refunded since: summed over all time, it
 * is the product page's count of reservations with a receipt, and summed over a
 * period it counts no reservation twice.
 *
 * A product's figures have no currency of their own, so a receipt in another
 * currency is skipped, and counted for the caller to log.
 */
export async function getProductSalesByDay(input: {
  storeId: string;
  /** The store's currency, upper case. */
  currency: string;
  start: Date;
  end: Date;
}): Promise<ProductSalesByDay> {
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
        ...rentalReceiptConditions(),
        sql`${receiptDate} >= ${input.start}`,
        sql`${receiptDate} < ${input.end}`,
      ),
    );

  const skippedByCurrency = new Map<string, number>();
  const inCurrency = receipts.filter((receipt) => {
    const currency = receiptCurrency(receipt, input.currency);
    if (currency === input.currency) return true;
    skippedByCurrency.set(currency, (skippedByCurrency.get(currency) ?? 0) + 1);
    return false;
  });

  // Only the reservations paid in the window, never the full history.
  const reservationIds = [...new Set(inCurrency.map((receipt) => receipt.reservationId))];
  const itemsByReservation = new Map<
    string,
    { id: string; productId: string | null; weightCents: number }[]
  >();
  // A reservation paid before the window had its first receipt then.
  const paidBefore = new Set<string>();
  for (let index = 0; index < reservationIds.length; index += RESERVATION_BATCH) {
    const batch = reservationIds.slice(index, index + RESERVATION_BATCH);
    const items = await db
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
      .where(inArray(reservationItems.reservationId, batch));
    for (const row of items) {
      const list = itemsByReservation.get(row.reservationId) ?? [];
      list.push({ id: row.id, productId: row.productId, weightCents: toCents(row.totalPrice) });
      itemsByReservation.set(row.reservationId, list);
    }

    const earlier = await db
      .select({
        reservationId: payments.reservationId,
        currency: payments.currency,
        reservationCurrency: reservations.currency,
      })
      .from(payments)
      .innerJoin(reservations, eq(payments.reservationId, reservations.id))
      .where(
        and(
          inArray(payments.reservationId, batch),
          ...rentalReceiptConditions(),
          sql`${receiptDate} < ${input.start}`,
        ),
      );
    for (const receipt of earlier) {
      if (receiptCurrency(receipt, input.currency) === input.currency) {
        paidBefore.add(receipt.reservationId);
      }
    }
  }

  const byDay = new Map<number, Map<string, ProductDaySales>>();
  const figuresOf = (day: number, productId: string) => {
    const byProduct = byDay.get(day) ?? new Map<string, ProductDaySales>();
    byDay.set(day, byProduct);
    const figures = byProduct.get(productId) ?? { revenueCents: 0, reservations: 0 };
    byProduct.set(productId, figures);
    return figures;
  };

  const firstReceiptDay = new Map<string, number>();
  for (const receipt of inCurrency) {
    const day = startOfDay(receipt.receivedAt).getTime();
    const first = firstReceiptDay.get(receipt.reservationId);
    if (first === undefined || day < first) firstReceiptDay.set(receipt.reservationId, day);

    const items = itemsByReservation.get(receipt.reservationId) ?? [];
    const allocation = allocateReceiptCents(toCents(receipt.amount), items);
    for (const item of items) {
      const cents = allocation.get(item.id);
      if (!item.productId || !cents) continue;
      figuresOf(day, item.productId).revenueCents += cents;
    }
  }

  for (const [reservationId, day] of firstReceiptDay) {
    if (paidBefore.has(reservationId)) continue;
    const productIds = new Set(
      (itemsByReservation.get(reservationId) ?? []).flatMap((item) =>
        item.productId ? [item.productId] : [],
      ),
    );
    for (const productId of productIds) figuresOf(day, productId).reservations += 1;
  }

  return {
    byDay,
    skipped: [...skippedByCurrency].map(([currency, count]) => ({ currency, count })),
  };
}
