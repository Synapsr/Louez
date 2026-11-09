import { and, desc, eq, sql } from "drizzle-orm";

import {
  customers,
  db,
  productUnitDowntimes,
  productUnitEvents,
  productUnits,
  products,
  reservationItemUnits,
  reservationItems,
  reservations,
  users,
} from "@louez/db";

import { PRODUCT_UNIT_DOWNTIME_STATUSES } from "../contracts/product-units";

type ProductUnitDowntimeStatus = (typeof PRODUCT_UNIT_DOWNTIME_STATUSES)[number];

const getDowntimeStatus = (
  downtime: { startsAt: Date; endsAt: Date | null },
  now: Date,
): ProductUnitDowntimeStatus => {
  if (downtime.startsAt <= now && (!downtime.endsAt || downtime.endsAt > now)) {
    return "current";
  }

  return downtime.startsAt > now ? "upcoming" : "past";
};

const getDowntimeStatusOrder = (status: ProductUnitDowntimeStatus) => {
  if (status === "current") {
    return 0;
  }

  return status === "upcoming" ? 1 : 2;
};

export const getProductUnitHistory = async ({
  storeId,
  unitId,
}: {
  storeId: string;
  unitId: string;
}) => {
  const [unit] = await db
    .select({ id: productUnits.id })
    .from(productUnits)
    .innerJoin(products, eq(productUnits.productId, products.id))
    .where(and(eq(productUnits.id, unitId), eq(products.storeId, storeId)))
    .limit(1);

  if (!unit) {
    return null;
  }

  const [events, assignments, downtimeRows] = await Promise.all([
    db
      .select({
        id: productUnitEvents.id,
        type: productUnitEvents.type,
        actorUserId: productUnitEvents.actorUserId,
        actorName: users.name,
        payload: productUnitEvents.payload,
        createdAt: productUnitEvents.createdAt,
      })
      .from(productUnitEvents)
      .leftJoin(users, eq(productUnitEvents.actorUserId, users.id))
      .where(
        and(eq(productUnitEvents.productUnitId, unitId), eq(productUnitEvents.storeId, storeId)),
      )
      .orderBy(desc(productUnitEvents.createdAt), desc(productUnitEvents.id)),
    db
      .select({
        id: reservationItemUnits.id,
        reservationId: reservations.id,
        reservationNumber: reservations.number,
        reservationItemId: reservationItems.id,
        identifierSnapshot: reservationItemUnits.identifierSnapshot,
        customerName: sql<
          string | null
        >`NULLIF(TRIM(CONCAT(COALESCE(${customers.firstName}, ''), ' ', COALESCE(${customers.lastName}, ''))), '')`,
        startDate: reservations.startDate,
        endDate: reservations.endDate,
        assignedAt: reservationItemUnits.assignedAt,
      })
      .from(reservationItemUnits)
      .innerJoin(reservationItems, eq(reservationItemUnits.reservationItemId, reservationItems.id))
      .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
      .leftJoin(customers, eq(reservations.customerId, customers.id))
      .where(
        and(eq(reservationItemUnits.productUnitId, unitId), eq(reservations.storeId, storeId)),
      ),
    db
      .select({
        id: productUnitDowntimes.id,
        reason: productUnitDowntimes.reason,
        startsAt: productUnitDowntimes.startsAt,
        endsAt: productUnitDowntimes.endsAt,
        note: productUnitDowntimes.note,
      })
      .from(productUnitDowntimes)
      .where(
        and(
          eq(productUnitDowntimes.productUnitId, unitId),
          eq(productUnitDowntimes.storeId, storeId),
        ),
      ),
  ]);

  const timeline = [
    ...events.map((event) => ({
      kind: "event" as const,
      id: event.id,
      type: event.type,
      actorUserId: event.actorUserId,
      actorName: event.actorName,
      payload: event.payload ?? null,
      createdAt: event.createdAt.toISOString(),
    })),
    ...assignments.map((assignment) => ({
      kind: "assignment" as const,
      id: assignment.id,
      type: "assigned" as const,
      reservationId: assignment.reservationId,
      reservationNumber: assignment.reservationNumber,
      reservationItemId: assignment.reservationItemId,
      identifierSnapshot: assignment.identifierSnapshot,
      customerName: assignment.customerName,
      startDate: assignment.startDate.toISOString(),
      endDate: assignment.endDate.toISOString(),
      createdAt: assignment.assignedAt.toISOString(),
    })),
  ].sort((a, b) => {
    const dateOrder = b.createdAt.localeCompare(a.createdAt);
    return dateOrder !== 0 ? dateOrder : b.id.localeCompare(a.id);
  });

  const now = new Date();
  const downtimes = downtimeRows
    .map((downtime) => ({
      id: downtime.id,
      reason: downtime.reason,
      startsAt: downtime.startsAt.toISOString(),
      endsAt: downtime.endsAt?.toISOString() ?? null,
      note: downtime.note,
      status: getDowntimeStatus(downtime, now),
    }))
    .sort((a, b) => {
      const statusOrder = getDowntimeStatusOrder(a.status) - getDowntimeStatusOrder(b.status);
      if (statusOrder !== 0) {
        return statusOrder;
      }

      return a.status === "upcoming"
        ? a.startsAt.localeCompare(b.startsAt)
        : b.startsAt.localeCompare(a.startsAt);
    });

  return { timeline, downtimes };
};
