import { and, eq, inArray } from 'drizzle-orm';

import {
  buildUnitRentableDuringPredicate,
  db,
  findBusyUnitIds,
  getBlockingReservationStatuses,
  productUnits,
  reservationItemUnits,
  type BlockingReservationStatus,
} from '@louez/db';

export type { BlockingReservationStatus };
export { getBlockingReservationStatuses };

export interface AvailableUnit {
  id: string;
  identifier: string;
  notes: string | null;
}

type UnitAvailabilityOptions = {
  blockingStatuses: readonly BlockingReservationStatus[];
  turnoverBufferMinutes: number;
  excludeReservationItemId?: string;
};

type AvailableUnitsForProductOptions = UnitAvailabilityOptions & {
  combinationKey?: string | null;
};

export function isUnitRentableDuring(startDate: Date, endDate: Date) {
  return buildUnitRentableDuringPredicate(db, startDate, endDate);
}

export async function getAvailableUnitsForProduct(
  productId: string,
  startDate: Date,
  endDate: Date,
  options: AvailableUnitsForProductOptions,
): Promise<AvailableUnit[]> {
  const unitConditions = [
    eq(productUnits.productId, productId),
    isUnitRentableDuring(startDate, endDate),
  ];

  if (options.combinationKey) {
    unitConditions.push(eq(productUnits.combinationKey, options.combinationKey));
  }

  const allUnits = await db
    .select({
      id: productUnits.id,
      identifier: productUnits.identifier,
      notes: productUnits.notes,
    })
    .from(productUnits)
    .where(and(...unitConditions));

  if (allUnits.length === 0) {
    return [];
  }

  const busyUnitIds = await findBusyUnitIds(db, {
    unitIds: allUnits.map((unit) => unit.id),
    start: startDate,
    end: endDate,
    blockingStatuses: options.blockingStatuses,
    turnoverBufferMinutes: options.turnoverBufferMinutes,
    excludeReservationItemId: options.excludeReservationItemId,
  });

  return allUnits.filter((unit) => !busyUnitIds.has(unit.id));
}

export async function checkUnitsAvailability(
  unitIds: string[],
  startDate: Date,
  endDate: Date,
  options: UnitAvailabilityOptions,
): Promise<Record<string, boolean>> {
  if (unitIds.length === 0) {
    return {};
  }

  const rentableUnits = await db
    .select({ id: productUnits.id })
    .from(productUnits)
    .where(
      and(
        inArray(productUnits.id, unitIds),
        isUnitRentableDuring(startDate, endDate),
      ),
    );

  const busyUnitIds = await findBusyUnitIds(db, {
    unitIds,
    start: startDate,
    end: endDate,
    blockingStatuses: options.blockingStatuses,
    turnoverBufferMinutes: options.turnoverBufferMinutes,
    excludeReservationItemId: options.excludeReservationItemId,
  });

  const rentableUnitIds = new Set(rentableUnits.map((unit) => unit.id));
  const availability: Record<string, boolean> = {};

  for (const unitId of unitIds) {
    availability[unitId] =
      rentableUnitIds.has(unitId) && !busyUnitIds.has(unitId);
  }

  return availability;
}

export async function getAssignedUnitsForReservationItem(
  reservationItemId: string,
): Promise<
  Array<{
    id: string;
    productUnitId: string;
    identifierSnapshot: string;
    assignedAt: Date;
  }>
> {
  const assigned = await db
    .select({
      id: reservationItemUnits.id,
      productUnitId: reservationItemUnits.productUnitId,
      identifierSnapshot: reservationItemUnits.identifierSnapshot,
      assignedAt: reservationItemUnits.assignedAt,
    })
    .from(reservationItemUnits)
    .where(eq(reservationItemUnits.reservationItemId, reservationItemId));

  return assigned;
}
