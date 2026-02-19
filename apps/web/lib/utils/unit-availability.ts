import { db } from '@louez/db'
import {
  productUnits,
  reservationItemUnits,
  reservationItems,
  reservations,
} from '@louez/db'
import { and, eq, inArray, lte, gte, not } from 'drizzle-orm'

export interface AvailableUnit {
  id: string
  identifier: string
  notes: string | null
  status: 'available' | 'maintenance' | 'retired'
}

/**
 * Reservation statuses that block unit availability.
 * Units assigned to reservations with these statuses cannot be reassigned
 * to overlapping reservations.
 */
const BLOCKING_STATUSES = ['pending', 'confirmed', 'ongoing'] as const

/**
 * Get available units for a product within a date range.
 *
 * Returns units that:
 * 1. Have status 'available' (not maintenance or retired)
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
): Promise<AvailableUnit[]> {
  const unitConditions = [
    eq(productUnits.productId, productId),
    eq(productUnits.status, 'available'),
  ]

  if (combinationKey) {
    unitConditions.push(eq(productUnits.combinationKey, combinationKey))
  }

  // 1. Get all units for the product with status 'available'
  const allUnits = await db
    .select({
      id: productUnits.id,
      identifier: productUnits.identifier,
      notes: productUnits.notes,
      status: productUnits.status,
    })
    .from(productUnits)
    .where(
      and(...unitConditions),
    )

  if (allUnits.length === 0) {
    return []
  }

  // 2. Find units that are assigned to overlapping reservations
  const unitIds = allUnits.map((u) => u.id)

  // Build the reservation filter conditions
  const reservationConditions = [
    // Overlapping date range: starts before period ends AND ends after period starts
    lte(reservations.startDate, endDate),
    gte(reservations.endDate, startDate),
    // Only blocking statuses
    inArray(reservations.status, [...BLOCKING_STATUSES]),
  ]

  // Exclude specific reservation if editing
  if (excludeReservationId) {
    reservationConditions.push(not(eq(reservations.id, excludeReservationId)))
  }

  // Query for busy units
  const busyUnitAssignments = await db
    .select({
      productUnitId: reservationItemUnits.productUnitId,
    })
    .from(reservationItemUnits)
    .innerJoin(reservationItems, eq(reservationItemUnits.reservationItemId, reservationItems.id))
    .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
    .where(
      and(inArray(reservationItemUnits.productUnitId, unitIds), ...reservationConditions)
    )

  // 3. Filter out busy units
  const busyUnitIds = new Set(busyUnitAssignments.map((a) => a.productUnitId))
  const availableUnits = allUnits.filter((unit) => !busyUnitIds.has(unit.id))

  return availableUnits
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
  excludeReservationId?: string
): Promise<Record<string, boolean>> {
  if (unitIds.length === 0) {
    return {}
  }

  // Build the reservation filter conditions
  const reservationConditions = [
    lte(reservations.startDate, endDate),
    gte(reservations.endDate, startDate),
    inArray(reservations.status, [...BLOCKING_STATUSES]),
  ]

  if (excludeReservationId) {
    reservationConditions.push(not(eq(reservations.id, excludeReservationId)))
  }

  // Find busy units among the requested ones
  const busyUnitAssignments = await db
    .select({
      productUnitId: reservationItemUnits.productUnitId,
    })
    .from(reservationItemUnits)
    .innerJoin(reservationItems, eq(reservationItemUnits.reservationItemId, reservationItems.id))
    .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
    .where(
      and(inArray(reservationItemUnits.productUnitId, unitIds), ...reservationConditions)
    )

  const busyUnitIds = new Set(busyUnitAssignments.map((a) => a.productUnitId))

  // Build availability map
  const availability: Record<string, boolean> = {}
  for (const unitId of unitIds) {
    availability[unitId] = !busyUnitIds.has(unitId)
  }

  return availability
}

/**
 * Get units currently assigned to a reservation item.
 *
 * @param reservationItemId - The reservation item ID
 * @returns Array of assigned units with their snapshot identifiers
 */
export async function getAssignedUnitsForReservationItem(
  reservationItemId: string
): Promise<
  Array<{
    id: string
    productUnitId: string
    identifierSnapshot: string
    assignedAt: Date
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
    .where(eq(reservationItemUnits.reservationItemId, reservationItemId))

  return assigned
}
