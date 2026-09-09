import {
  sql,
  and,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  not,
  notExists,
  or,
} from "drizzle-orm";

import type { Database } from "./index";
import type { SQL } from "drizzle-orm";
import {
  marketplaceBookingAttempts,
  productUnitDowntimes,
  productUnits,
  reservationItemUnits,
  reservationItems,
  reservations,
} from "./schema";

export const BLOCKING_RESERVATION_STATUSES = ["pending", "confirmed", "ongoing"] as const;

export type BlockingReservationStatus = (typeof BLOCKING_RESERVATION_STATUSES)[number];

export type BusyUnitReason = "overlap" | "buffer";

function applyTurnoverBuffer(date: Date, minutes: number, direction: -1 | 1) {
  return new Date(date.getTime() + direction * Math.max(0, minutes) * 60_000);
}

export function getBlockingReservationStatuses(
  pendingBlocksAvailability: boolean,
): BlockingReservationStatus[] {
  return pendingBlocksAvailability ? [...BLOCKING_RESERVATION_STATUSES] : ["confirmed", "ongoing"];
}

/** Effective stock end includes a live customer extension checkout. */
export function reservationAvailabilityEndSql() {
  return sql<Date>`GREATEST(${reservations.endDate}, COALESCE((
    SELECT FROM_UNIXTIME(MAX(CAST(JSON_UNQUOTE(JSON_EXTRACT(extension_hold.metadata, '$.requestedEndMs')) AS UNSIGNED)) / 1000)
    FROM reservation_activity extension_hold
    WHERE extension_hold.reservation_id = ${reservations.id}
      AND JSON_UNQUOTE(JSON_EXTRACT(extension_hold.metadata, '$.kind')) = 'rental_extension'
      AND JSON_UNQUOTE(JSON_EXTRACT(extension_hold.metadata, '$.status')) = 'checkout'
      AND CAST(JSON_UNQUOTE(JSON_EXTRACT(extension_hold.metadata, '$.expiresMs')) AS UNSIGNED) > UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000
  ), ${reservations.endDate}))`.mapWith(reservations.endDate);
}

export function getReservationAvailabilityEnd(
  reservation: {
    endDate: Date;
    activity?: Array<{ metadata: unknown }>;
  },
  now = Date.now(),
): Date {
  let end = reservation.endDate.getTime();
  for (const row of reservation.activity ?? []) {
    const value = row.metadata;
    if (!value || typeof value !== "object") continue;
    if (!("kind" in value) || value.kind !== "rental_extension") continue;
    if (!("status" in value) || value.status !== "checkout") continue;
    if (!("expiresMs" in value) || typeof value.expiresMs !== "number" || value.expiresMs <= now)
      continue;
    if (
      "requestedEndMs" in value &&
      typeof value.requestedEndMs === "number" &&
      Number.isFinite(value.requestedEndMs)
    ) {
      end = Math.max(end, value.requestedEndMs);
    }
  }
  return new Date(end);
}

export function buildReservationOverlapPredicate(params: {
  start: Date;
  end: Date;
  turnoverBufferMinutes: number;
}) {
  const bufferedStart = applyTurnoverBuffer(params.start, params.turnoverBufferMinutes, -1);
  const bufferedEnd = applyTurnoverBuffer(params.end, params.turnoverBufferMinutes, 1);

  const predicate = and(
    lt(reservations.startDate, bufferedEnd),
    gt(reservationAvailabilityEndSql(), bufferedStart),
  );

  if (!predicate) {
    throw new Error("Failed to build reservation overlap predicate");
  }

  return predicate;
}

export function buildReservationAvailabilityPredicate(
  database: Pick<Database, "select">,
  now: Date = new Date(),
) {
  const predicate = or(
    isNull(reservations.source),
    ne(reservations.source, "marketplace"),
    not(eq(reservations.status, "pending")),
    exists(
      database
        .select({ id: marketplaceBookingAttempts.id })
        .from(marketplaceBookingAttempts)
        .where(
          and(
            eq(marketplaceBookingAttempts.reservationId, reservations.id),
            or(
              eq(marketplaceBookingAttempts.status, "confirmed"),
              and(
                inArray(marketplaceBookingAttempts.status, [
                  "creating_hold",
                  "holding",
                  "checkout_pending",
                ]),
                gt(marketplaceBookingAttempts.expiresAt, now),
              ),
            ),
          ),
        ),
    ),
  );
  if (!predicate) {
    throw new Error("Failed to build reservation availability predicate");
  }
  return predicate;
}

export function buildUnitInDowntimeAtPredicate(now: Date) {
  return and(
    lte(productUnitDowntimes.startsAt, now),
    or(isNull(productUnitDowntimes.endsAt), gt(productUnitDowntimes.endsAt, now)),
  );
}

export function buildUnitRentableDuringPredicate(
  database: Pick<Database, "select">,
  startDate: Date,
  endDate: Date,
) {
  return and(
    eq(productUnits.lifecycleStatus, "active"),
    notExists(
      database
        .select({ id: productUnitDowntimes.id })
        .from(productUnitDowntimes)
        .where(
          and(
            eq(productUnitDowntimes.productUnitId, productUnits.id),
            lt(productUnitDowntimes.startsAt, endDate),
            or(isNull(productUnitDowntimes.endsAt), gt(productUnitDowntimes.endsAt, startDate)),
          ),
        ),
    ),
  );
}

export async function findBusyUnitIds(
  database: Pick<Database, "select">,
  params: {
    unitIds: string[];
    start: Date;
    end: Date;
    blockingStatuses: readonly BlockingReservationStatus[];
    turnoverBufferMinutes: number;
    excludeReservationItemId?: string;
  },
): Promise<Map<string, BusyUnitReason>> {
  if (params.unitIds.length === 0 || params.blockingStatuses.length === 0) {
    return new Map();
  }

  const conditions: SQL<unknown>[] = [
    inArray(reservationItemUnits.productUnitId, params.unitIds),
    inArray(reservations.status, [...params.blockingStatuses]),
    buildReservationAvailabilityPredicate(database),
    buildReservationOverlapPredicate({
      start: params.start,
      end: params.end,
      turnoverBufferMinutes: params.turnoverBufferMinutes,
    }),
  ];

  if (params.excludeReservationItemId) {
    conditions.push(not(eq(reservationItems.id, params.excludeReservationItemId)));
  }

  const assignments = await database
    .select({
      productUnitId: reservationItemUnits.productUnitId,
      reservationStart: reservations.startDate,
      reservationEnd: reservationAvailabilityEndSql(),
    })
    .from(reservationItemUnits)
    .innerJoin(reservationItems, eq(reservationItemUnits.reservationItemId, reservationItems.id))
    .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
    .where(and(...conditions));

  const busyUnitIds = new Map<string, BusyUnitReason>();

  for (const assignment of assignments) {
    if (!assignment.productUnitId) {
      continue;
    }

    const reason =
      assignment.reservationStart < params.end && assignment.reservationEnd > params.start
        ? "overlap"
        : "buffer";

    if (reason === "overlap" || !busyUnitIds.has(assignment.productUnitId)) {
      busyUnitIds.set(assignment.productUnitId, reason);
    }
  }

  return busyUnitIds;
}
