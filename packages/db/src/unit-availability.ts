import {
  and,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  not,
  notExists,
  or,
} from 'drizzle-orm';

import type { Database } from './index';
import type { SQL } from 'drizzle-orm';
import {
  productUnitDowntimes,
  productUnits,
  reservationItemUnits,
  reservationItems,
  reservations,
} from './schema';

const BLOCKING_RESERVATION_STATUSES = [
  'pending',
  'confirmed',
  'ongoing',
] as const;

export type BlockingReservationStatus =
  (typeof BLOCKING_RESERVATION_STATUSES)[number];

export type BusyUnitReason = 'overlap' | 'buffer';

function applyTurnoverBuffer(date: Date, minutes: number, direction: -1 | 1) {
  return new Date(date.getTime() + direction * Math.max(0, minutes) * 60_000);
}

export function getBlockingReservationStatuses(
  pendingBlocksAvailability: boolean,
): BlockingReservationStatus[] {
  return pendingBlocksAvailability ? [...BLOCKING_RESERVATION_STATUSES] : ['confirmed', 'ongoing'];
}

export function buildReservationOverlapPredicate(params: {
  start: Date;
  end: Date;
  turnoverBufferMinutes: number;
}) {
  const bufferedStart = applyTurnoverBuffer(
    params.start,
    params.turnoverBufferMinutes,
    -1,
  );
  const bufferedEnd = applyTurnoverBuffer(
    params.end,
    params.turnoverBufferMinutes,
    1,
  );

  const predicate = and(
    lt(reservations.startDate, bufferedEnd),
    gt(reservations.endDate, bufferedStart),
  );

  if (!predicate) {
    throw new Error('Failed to build reservation overlap predicate');
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
  database: Pick<Database, 'select'>,
  startDate: Date,
  endDate: Date,
) {
  return and(
    eq(productUnits.lifecycleStatus, 'active'),
    notExists(
      database
        .select({ id: productUnitDowntimes.id })
        .from(productUnitDowntimes)
        .where(
          and(
            eq(productUnitDowntimes.productUnitId, productUnits.id),
            lt(productUnitDowntimes.startsAt, endDate),
            or(
              isNull(productUnitDowntimes.endsAt),
              gt(productUnitDowntimes.endsAt, startDate),
            ),
          ),
        ),
    ),
  );
}

export async function findBusyUnitIds(
  database: Pick<Database, 'select'>,
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
    buildReservationOverlapPredicate({
      start: params.start,
      end: params.end,
      turnoverBufferMinutes: params.turnoverBufferMinutes,
    }),
  ];

  if (params.excludeReservationItemId) {
    conditions.push(
      not(eq(reservationItems.id, params.excludeReservationItemId)),
    );
  }

  const assignments = await database
    .select({
      productUnitId: reservationItemUnits.productUnitId,
      reservationStart: reservations.startDate,
      reservationEnd: reservations.endDate,
    })
    .from(reservationItemUnits)
    .innerJoin(
      reservationItems,
      eq(reservationItemUnits.reservationItemId, reservationItems.id),
    )
    .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
    .where(and(...conditions));

  const busyUnitIds = new Map<string, BusyUnitReason>();

  for (const assignment of assignments) {
    const reason =
      assignment.reservationStart < params.end &&
      assignment.reservationEnd > params.start
        ? 'overlap'
        : 'buffer';

    if (reason === 'overlap' || !busyUnitIds.has(assignment.productUnitId)) {
      busyUnitIds.set(assignment.productUnitId, reason);
    }
  }

  return busyUnitIds;
}
