import { and, eq } from 'drizzle-orm';

import {
  buildUnitRentableDuringPredicate,
  db,
  findBusyUnitIds,
  getBlockingReservationStatuses,
  productUnits,
  products,
  type BlockingReservationStatus,
  type Database,
  type Transaction,
} from '@louez/db';
import type { BookingAttributeAxis, UnitAttributes } from '@louez/types';
import {
  DEFAULT_COMBINATION_KEY,
  canonicalizeAttributes,
  isPooledCombinationKey,
  matchesSelectedAttributes,
} from '@louez/utils';

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
  /** Values the units must carry when no exact combination applies. */
  selectedAttributes?: UnitAttributes | null;
};

export interface UnitAssignmentScope {
  /** Exact combination the units must carry, or null when any unit of the product may serve the line. */
  combinationKey: string | null;
  /** Values the units must match when no exact combination applies. */
  selectedAttributes: UnitAttributes;
}

/**
 * Which units may serve a booked line. A line with no exact combination,
 * whether pooled (booked before the product sold by variants) or booked with
 * a partial choice, takes any unit that matches whatever it did choose.
 * Reads through the caller's transaction when it holds one, so a locked
 * transaction never waits on a second pool connection.
 */
export async function resolveUnitAssignmentScope(
  executor: Database | Transaction,
  input: {
    productId: string;
    combinationKey: string | null;
    selectedAttributes: UnitAttributes | null;
  },
): Promise<UnitAssignmentScope> {
  const [product] = await executor
    .select({ bookingAttributeAxes: products.bookingAttributeAxes })
    .from(products)
    .where(eq(products.id, input.productId));
  const axes = (product?.bookingAttributeAxes ?? []) as BookingAttributeAxis[];

  if (input.combinationKey === null || isPooledCombinationKey(axes, input.combinationKey)) {
    return {
      combinationKey: null,
      selectedAttributes: canonicalizeAttributes(axes, input.selectedAttributes),
    };
  }

  return { combinationKey: input.combinationKey, selectedAttributes: {} };
}

export function unitMatchesAssignmentScope(
  scope: UnitAssignmentScope,
  unit: { combinationKey: string | null; attributes: UnitAttributes | null },
): boolean {
  return scope.combinationKey
    ? (unit.combinationKey || DEFAULT_COMBINATION_KEY) === scope.combinationKey
    : matchesSelectedAttributes(scope.selectedAttributes, unit.attributes);
}

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

  const allUnits = (
    await db
      .select({
        id: productUnits.id,
        identifier: productUnits.identifier,
        notes: productUnits.notes,
        attributes: productUnits.attributes,
      })
      .from(productUnits)
      .where(and(...unitConditions))
  )
    .filter((unit) =>
      matchesSelectedAttributes(options.selectedAttributes, unit.attributes),
    )
    .map(({ id, identifier, notes }) => ({ id, identifier, notes }));

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
