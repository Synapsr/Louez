import { and, eq } from 'drizzle-orm';

import {
  buildUnitRentableDuringPredicate,
  db,
  findBusyUnitIds,
  getBlockingReservationStatuses,
  productUnits,
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
