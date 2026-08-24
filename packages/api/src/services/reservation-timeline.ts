import { and, eq, gte, inArray, lte } from "drizzle-orm";

import {
  customers,
  db,
  products,
  reservationItemUnits,
  reservationItems,
  reservations,
} from "@louez/db";
import type {
  ReservationCalendarPeriodEntry,
  ReservationPlanningTimelineEntry,
} from "@louez/validations";

export async function getReservationsForCalendarPeriod(params: {
  storeId: string;
  startDate: Date;
  endDate: Date;
}): Promise<ReservationCalendarPeriodEntry[]> {
  const { storeId, startDate, endDate } = params;

  return db.query.reservations.findMany({
    where: and(
      eq(reservations.storeId, storeId),
      lte(reservations.startDate, endDate),
      gte(reservations.endDate, startDate),
    ),
    columns: {
      id: true,
      number: true,
      status: true,
      startDate: true,
      endDate: true,
      subtotalAmount: true,
      depositAmount: true,
      totalAmount: true,
      outboundMethod: true,
      returnMethod: true,
      deliveryAddress: true,
      deliveryCity: true,
      deliveryPostalCode: true,
      deliveryCountry: true,
      returnAddress: true,
      returnCity: true,
      returnPostalCode: true,
      returnCountry: true,
    },
    with: {
      customer: {
        columns: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
      items: {
        columns: {
          id: true,
          quantity: true,
          productSnapshot: true,
        },
        with: {
          product: {
            columns: {
              id: true,
              name: true,
              images: true,
              displayOrder: true,
            },
          },
        },
      },
    },
    orderBy: (reservation, { asc }) => [asc(reservation.startDate)],
  });
}

export async function getStorePlanningTimeline(params: {
  storeId: string;
  startDate: Date;
  endDate: Date;
}): Promise<ReservationPlanningTimelineEntry[]> {
  const { storeId, startDate, endDate } = params;

  const rows = await db
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
      productId: reservationItems.productId,
      productName: products.name,
      productImages: products.images,
      quantity: reservationItems.quantity,
      outboundMethod: reservations.outboundMethod,
      returnMethod: reservations.returnMethod,
      deliveryAddress: reservations.deliveryAddress,
      deliveryCity: reservations.deliveryCity,
      deliveryPostalCode: reservations.deliveryPostalCode,
      deliveryCountry: reservations.deliveryCountry,
      returnAddress: reservations.returnAddress,
      returnCity: reservations.returnCity,
      returnPostalCode: reservations.returnPostalCode,
      returnCountry: reservations.returnCountry,
    })
    .from(reservationItems)
    .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
    .leftJoin(customers, eq(reservations.customerId, customers.id))
    .leftJoin(products, eq(reservationItems.productId, products.id))
    .where(
      and(
        eq(reservations.storeId, storeId),
        lte(reservations.startDate, endDate),
        gte(reservations.endDate, startDate),
      ),
    );

  const itemIds = rows.map((row) => row.itemId);
  const assignmentRows = itemIds.length
    ? await db
        .select({
          reservationItemId: reservationItemUnits.reservationItemId,
          productUnitId: reservationItemUnits.productUnitId,
        })
        .from(reservationItemUnits)
        .where(inArray(reservationItemUnits.reservationItemId, itemIds))
    : [];

  const assignmentsByItem = new Map<string, string[]>();
  for (const assignment of assignmentRows) {
    if (!assignment.productUnitId) continue;
    const assignedUnitIds = assignmentsByItem.get(assignment.reservationItemId) ?? [];
    assignedUnitIds.push(assignment.productUnitId);
    assignmentsByItem.set(assignment.reservationItemId, assignedUnitIds);
  }

  const byPair = new Map<string, ReservationPlanningTimelineEntry>();
  for (const row of rows) {
    if (!row.productId) continue;

    const assignedUnitIds = assignmentsByItem.get(row.itemId) ?? [];
    const key = `${row.reservationId}_${row.productId}`;
    const existing = byPair.get(key);
    if (existing) {
      existing.quantity += row.quantity;
      existing.assignedUnitIds.push(...assignedUnitIds);
      if (existing.items[0]) existing.items[0].quantity += row.quantity;
      continue;
    }

    byPair.set(key, {
      id: row.reservationId,
      productId: row.productId,
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
      assignedUnitIds,
      items: row.productName
        ? [
            {
              productId: row.productId,
              name: row.productName,
              quantity: row.quantity,
              imageUrl: row.productImages?.[0] ?? null,
            },
          ]
        : [],
      outboundDelivery:
        row.outboundMethod === "address"
          ? {
              address: row.deliveryAddress,
              city: row.deliveryCity,
              postalCode: row.deliveryPostalCode,
              country: row.deliveryCountry,
            }
          : null,
      returnDelivery:
        row.returnMethod === "address"
          ? {
              address: row.returnAddress,
              city: row.returnCity,
              postalCode: row.returnPostalCode,
              country: row.returnCountry,
            }
          : null,
    });
  }

  return Array.from(byPair.values());
}
