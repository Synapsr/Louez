import {
  customers,
  db,
  productUnitDowntimes,
  productUnits,
  products,
  reservationItemUnits,
  reservationItems,
  reservations,
} from "@louez/db";
import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import type { z } from "zod";

import {
  PRODUCT_TIMELINE_MAX_DAYS,
  productErrors,
  type productTimelineOutput,
} from "../contracts/products";

// One window whole: the procedure pages its reservations.
type Timeline = Omit<z.infer<typeof productTimelineOutput>, "nextCursor">;
type TimelineItem = Timeline["reservations"][number]["items"][number];

const DAY_MS = 86_400_000;

/**
 * Everything the product's reservations timeline shows for a window:
 * reservations holding the product (with its quantity and assigned units)
 * and unit downtimes that overlap the window. Read for the product only, so
 * the answer stays small however busy the store is.
 */
export async function getProductReservationTimeline(
  storeId: string,
  input: { id: string; from: Date; to: Date },
): Promise<Timeline> {
  const { from: start, to: end } = input;
  if (end < start || end.getTime() - start.getTime() > PRODUCT_TIMELINE_MAX_DAYS * DAY_MS) {
    throw productErrors.timelineRange();
  }
  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, input.id), eq(products.storeId, storeId)))
    .limit(1);
  if (!product) throw productErrors.notFound(input.id);

  const [itemRows, downtimeRows] = await Promise.all([
    db
      .select({
        reservationId: reservations.id,
        number: reservations.number,
        status: reservations.status,
        startDate: reservations.startDate,
        endDate: reservations.endDate,
        customerId: customers.id,
        customerFirstName: customers.firstName,
        customerLastName: customers.lastName,
        subtotalAmount: reservations.subtotalAmount,
        depositAmount: reservations.depositAmount,
        totalAmount: reservations.totalAmount,
        itemId: reservationItems.id,
        quantity: reservationItems.quantity,
      })
      .from(reservationItems)
      .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
      .leftJoin(customers, eq(reservations.customerId, customers.id))
      .where(
        and(
          eq(reservations.storeId, storeId),
          eq(reservationItems.productId, input.id),
          lte(reservations.startDate, end),
          gte(reservations.endDate, start),
        ),
      ),
    db
      .select({
        id: productUnitDowntimes.id,
        unitId: productUnits.id,
        reason: productUnitDowntimes.reason,
        startsAt: productUnitDowntimes.startsAt,
        endsAt: productUnitDowntimes.endsAt,
      })
      .from(productUnitDowntimes)
      .innerJoin(productUnits, eq(productUnitDowntimes.productUnitId, productUnits.id))
      .where(
        and(
          eq(productUnitDowntimes.storeId, storeId),
          eq(productUnits.productId, input.id),
          lte(productUnitDowntimes.startsAt, end),
          or(isNull(productUnitDowntimes.endsAt), gte(productUnitDowntimes.endsAt, start)),
        ),
      ),
  ]);

  const itemIds = itemRows.map((row) => row.itemId);
  const reservationIds = [...new Set(itemRows.map((row) => row.reservationId))];

  const [assignmentRows, contentRows] = await Promise.all([
    itemIds.length
      ? db
          .select({
            reservationItemId: reservationItemUnits.reservationItemId,
            productUnitId: reservationItemUnits.productUnitId,
          })
          .from(reservationItemUnits)
          .where(inArray(reservationItemUnits.reservationItemId, itemIds))
      : [],
    // Everything else going out with this product, so the tooltip tells the
    // merchant what the whole reservation contains.
    reservationIds.length
      ? db
          .select({
            reservationId: reservationItems.reservationId,
            productId: reservationItems.productId,
            productName: products.name,
            productImages: products.images,
            displayOrder: products.displayOrder,
            quantity: reservationItems.quantity,
          })
          .from(reservationItems)
          .innerJoin(products, eq(reservationItems.productId, products.id))
          .where(inArray(reservationItems.reservationId, reservationIds))
      : [],
  ]);

  const assignmentsByItem = new Map<string, string[]>();
  for (const assignment of assignmentRows) {
    if (!assignment.productUnitId) continue;
    assignmentsByItem.set(assignment.reservationItemId, [
      ...(assignmentsByItem.get(assignment.reservationItemId) ?? []),
      assignment.productUnitId,
    ]);
  }

  // Aggregate per (reservation, product), then order like the catalog.
  const contentsByReservation = new Map<
    string,
    Map<string, TimelineItem & { displayOrder: number }>
  >();
  for (const row of contentRows) {
    if (!row.productId) continue;
    let byProduct = contentsByReservation.get(row.reservationId);
    if (!byProduct) {
      byProduct = new Map();
      contentsByReservation.set(row.reservationId, byProduct);
    }
    const existing = byProduct.get(row.productId);
    if (existing) {
      existing.quantity += row.quantity;
      continue;
    }
    byProduct.set(row.productId, {
      productId: row.productId,
      name: row.productName,
      quantity: row.quantity,
      imageUrl: row.productImages?.[0] ?? null,
      displayOrder: row.displayOrder ?? 0,
    });
  }

  const itemsByReservation = new Map<string, TimelineItem[]>();
  for (const [reservationId, byProduct] of contentsByReservation) {
    itemsByReservation.set(
      reservationId,
      [...byProduct.values()]
        .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name))
        .map(({ displayOrder: _displayOrder, ...item }) => item),
    );
  }

  // A reservation can (rarely) hold several lines of the same product: one
  // timeline entry per reservation.
  const byReservation = new Map<string, Timeline["reservations"][number]>();
  for (const row of itemRows) {
    const existing = byReservation.get(row.reservationId);
    const assignedUnitIds = assignmentsByItem.get(row.itemId) ?? [];
    if (existing) {
      existing.quantity += row.quantity;
      existing.assignedUnitIds.push(...assignedUnitIds);
      continue;
    }
    byReservation.set(row.reservationId, {
      id: row.reservationId,
      number: row.number,
      status: row.status,
      startDate: row.startDate,
      endDate: row.endDate,
      customerId: row.customerId,
      customerName: [row.customerFirstName, row.customerLastName].filter(Boolean).join(" ") || "—",
      subtotalAmount: row.subtotalAmount,
      depositAmount: row.depositAmount,
      totalAmount: row.totalAmount,
      quantity: row.quantity,
      assignedUnitIds: [...assignedUnitIds],
      items: itemsByReservation.get(row.reservationId) ?? [],
    });
  }

  return { reservations: [...byReservation.values()], downtimes: downtimeRows };
}
