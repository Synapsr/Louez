import { and, eq, gte, inArray, lte, not } from 'drizzle-orm';

import {
  buildUnitRentableDuringPredicate,
  db,
  productUnits,
  reservationItemUnits,
  reservationItems,
  reservations,
} from '@louez/db';

export interface AvailableUnit {
  id: string;
  identifier: string;
  notes: string | null;
}

/**
 * Reservation statuses that block unit availability.
 * Units assigned to reservations with these statuses cannot be reassigned
 * to overlapping reservations.
 */
export const BLOCKING_STATUSES = ['pending', 'confirmed', 'ongoing'] as const;
export type BlockingReservationStatus = (typeof BLOCKING_STATUSES)[number];

export function getBlockingReservationStatuses(
  pendingBlocksAvailability: boolean,
): BlockingReservationStatus[] {
  return pendingBlocksAvailability
    ? [...BLOCKING_STATUSES]
    : ['confirmed', 'ongoing'];
}

export function isUnitRentableDuring(startDate: Date, endDate: Date) {
  return buildUnitRentableDuringPredicate(db, startDate, endDate);
}

/**
 * Get available units for a product within a date range.
 *
 * Returns units that:
 * 1. Are active and have no overlapping downtime
 * 2. Are NOT assigned to any reservation that overlaps with the given period
 *    (unless that reservation is the one being edited, via excludeReservationId)
 *
 * @param productId - The product ID to get units for
 * @param startDate - Start of the rental period
 * @param endDate - End of the rental period
 * @param excludeReservationId - Optional reservation ID to exclude (for editing)
 * @returns Array of available units
 */
export async function getAvailableUnitsForProduct(
  productId: string,
  startDate: Date,
  endDate: Date,
  excludeReservationId?: string,
  combinationKey?: string | null,
  blockingStatuses: readonly BlockingReservationStatus[] = BLOCKING_STATUSES,
): Promise<AvailableUnit[]> {
  const unitConditions = [
    eq(productUnits.productId, productId),
    isUnitRentableDuring(startDate, endDate),
  ];

  if (combinationKey) {
    unitConditions.push(eq(productUnits.combinationKey, combinationKey));
  }

  // 1. Get all rentable units for the product
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

  // 2. Find units that are assigned to overlapping reservations
  const unitIds = allUnits.map((u) => u.id);

  // Build the reservation filter conditions
  const reservationConditions = [
    // Overlapping date range: starts before period ends AND ends after period starts
    lte(reservations.startDate, endDate),
    gte(reservations.endDate, startDate),
    // Only blocking statuses
    inArray(reservations.status, [...blockingStatuses]),
  ];

  // Exclude specific reservation if editing
  if (excludeReservationId) {
    reservationConditions.push(not(eq(reservations.id, excludeReservationId)));
  }

  // Query for busy units
  const busyUnitAssignments = await db
    .select({
      productUnitId: reservationItemUnits.productUnitId,
    })
    .from(reservationItemUnits)
    .innerJoin(
      reservationItems,
      eq(reservationItemUnits.reservationItemId, reservationItems.id),
    )
    .innerJoin(
      reservations,
      eq(reservationItems.reservationId, reservations.id),
    )
    .where(
      and(
        inArray(reservationItemUnits.productUnitId, unitIds),
        ...reservationConditions,
      ),
    );

  // 3. Filter out busy units
  const busyUnitIds = new Set(busyUnitAssignments.map((a) => a.productUnitId));
  const availableUnits = allUnits.filter((unit) => !busyUnitIds.has(unit.id));

  return availableUnits;
}

/**
 * Check if specific units are available for a reservation period.
 *
 * @param unitIds - Array of unit IDs to check
 * @param startDate - Start of the rental period
 * @param endDate - End of the rental period
 * @param excludeReservationId - Optional reservation ID to exclude (for editing)
 * @returns Object mapping unit IDs to their availability status
 */
export async function checkUnitsAvailability(
  unitIds: string[],
  startDate: Date,
  endDate: Date,
  excludeReservationId?: string,
  blockingStatuses: readonly BlockingReservationStatus[] = BLOCKING_STATUSES,
): Promise<Record<string, boolean>> {
  if (unitIds.length === 0) {
    return {};
  }

  const rentableUnits = await db
    .select({
      id: productUnits.id,
    })
    .from(productUnits)
    .where(
      and(
        inArray(productUnits.id, unitIds),
        isUnitRentableDuring(startDate, endDate),
      ),
    );

  const rentableUnitIds = new Set(rentableUnits.map((unit) => unit.id));

  // Build the reservation filter conditions
  const reservationConditions = [
    lte(reservations.startDate, endDate),
    gte(reservations.endDate, startDate),
    inArray(reservations.status, [...blockingStatuses]),
  ];

  if (excludeReservationId) {
    reservationConditions.push(not(eq(reservations.id, excludeReservationId)));
  }

  // Find busy units among the requested ones
  const busyUnitAssignments = await db
    .select({
      productUnitId: reservationItemUnits.productUnitId,
    })
    .from(reservationItemUnits)
    .innerJoin(
      reservationItems,
      eq(reservationItemUnits.reservationItemId, reservationItems.id),
    )
    .innerJoin(
      reservations,
      eq(reservationItems.reservationId, reservations.id),
    )
    .where(
      and(
        inArray(reservationItemUnits.productUnitId, unitIds),
        ...reservationConditions,
      ),
    );

  const busyUnitIds = new Set(busyUnitAssignments.map((a) => a.productUnitId));

  // Build availability map
  const availability: Record<string, boolean> = {};
  for (const unitId of unitIds) {
    availability[unitId] =
      rentableUnitIds.has(unitId) && !busyUnitIds.has(unitId);
  }

  return availability;
}

/**
 * Get units currently assigned to a reservation item.
 *
 * @param reservationItemId - The reservation item ID
 * @returns Array of assigned units with their snapshot identifiers
 */
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
