import { and, eq, gt, inArray, lt, not, sql } from 'drizzle-orm';
import 'server-only';

import {
  customers,
  db,
  productUnits,
  products,
  reservationItemUnits,
  reservationItems,
  reservations,
} from '@louez/db';

import {
  type AvailableUnit,
  type BlockingReservationStatus,
  getAvailableUnitsForProduct,
  getBlockingReservationStatuses,
} from './unit-availability';

export type UnitConflictWindow = {
  start: Date;
  end: Date | null;
};

export type UnitConflict = {
  reservationId: string;
  reservationNumber: string;
  customerName: string | null;
  startDate: Date;
  endDate: Date;
  reservationItemId: string;
  replacementCandidates: AvailableUnit[];
};

type GetUnitConflictsOptions = {
  storeId: string;
  pendingBlocksAvailability?: boolean;
  excludeReservationItemId?: string;
};

type GetUnitConflictFlagsOptions = {
  storeId: string;
  pendingBlocksAvailability?: boolean;
};

function getBlockingStatuses(
  pendingBlocksAvailability: boolean | undefined,
): BlockingReservationStatus[] {
  return getBlockingReservationStatuses(pendingBlocksAvailability ?? true);
}

export async function getUnitConflicts(
  unitId: string,
  window: UnitConflictWindow,
  options: GetUnitConflictsOptions,
): Promise<UnitConflict[]> {
  const blockingStatuses = getBlockingStatuses(
    options.pendingBlocksAvailability,
  );

  const [unit] = await db
    .select({
      id: productUnits.id,
      productId: productUnits.productId,
      combinationKey: productUnits.combinationKey,
    })
    .from(productUnits)
    .innerJoin(products, eq(productUnits.productId, products.id))
    .where(
      and(eq(productUnits.id, unitId), eq(products.storeId, options.storeId)),
    )
    .limit(1);

  if (!unit) {
    return [];
  }

  const conditions = [
    eq(reservationItemUnits.productUnitId, unitId),
    eq(reservations.storeId, options.storeId),
    inArray(reservations.status, blockingStatuses),
    gt(reservations.endDate, window.start),
  ];

  if (window.end) {
    conditions.push(lt(reservations.startDate, window.end));
  }

  if (options.excludeReservationItemId) {
    conditions.push(
      not(eq(reservationItems.id, options.excludeReservationItemId)),
    );
  }

  const conflicts = await db
    .select({
      reservationId: reservations.id,
      reservationNumber: reservations.number,
      customerName: sql<
        string | null
      >`NULLIF(TRIM(CONCAT(COALESCE(${customers.firstName}, ''), ' ', COALESCE(${customers.lastName}, ''))), '')`,
      startDate: reservations.startDate,
      endDate: reservations.endDate,
      reservationItemId: reservationItems.id,
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
    .leftJoin(customers, eq(reservations.customerId, customers.id))
    .where(and(...conditions));

  return Promise.all(
    conflicts.map(async (conflict) => {
      const candidates = await getAvailableUnitsForProduct(
        unit.productId,
        conflict.startDate,
        conflict.endDate,
        conflict.reservationId,
        unit.combinationKey,
        blockingStatuses,
      );

      return {
        ...conflict,
        replacementCandidates: candidates.filter(
          (candidate) => candidate.id !== unit.id,
        ),
      };
    }),
  );
}

export async function getUnitConflictFlags(
  windows: Array<{ unitId: string; window: UnitConflictWindow }>,
  options: GetUnitConflictFlagsOptions,
): Promise<Record<string, boolean>> {
  const flags: Record<string, boolean> = {};
  if (windows.length === 0) {
    return flags;
  }

  const blockingStatuses = getBlockingStatuses(
    options.pendingBlocksAvailability,
  );
  const windowsByUnitId = new Map<string, UnitConflictWindow[]>();

  for (const item of windows) {
    flags[item.unitId] = false;
    const unitWindows = windowsByUnitId.get(item.unitId) ?? [];
    unitWindows.push(item.window);
    windowsByUnitId.set(item.unitId, unitWindows);
  }

  const unitIds = [...windowsByUnitId.keys()];
  const minStart = new Date(
    Math.min(...windows.map((item) => item.window.start.getTime())),
  );
  const finiteEnds = windows
    .map((item) => item.window.end)
    .filter((end): end is Date => end !== null);
  const maxFiniteEnd =
    finiteEnds.length === windows.length
      ? new Date(Math.max(...finiteEnds.map((end) => end.getTime())))
      : null;

  const conditions = [
    inArray(reservationItemUnits.productUnitId, unitIds),
    eq(reservations.storeId, options.storeId),
    inArray(reservations.status, blockingStatuses),
    gt(reservations.endDate, minStart),
  ];

  if (maxFiniteEnd) {
    conditions.push(lt(reservations.startDate, maxFiniteEnd));
  }

  const assignments = await db
    .select({
      productUnitId: reservationItemUnits.productUnitId,
      startDate: reservations.startDate,
      endDate: reservations.endDate,
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
    .where(and(...conditions));

  for (const assignment of assignments) {
    const unitWindows = windowsByUnitId.get(assignment.productUnitId) ?? [];

    if (
      unitWindows.some(
        (window) =>
          assignment.endDate > window.start &&
          (window.end === null || assignment.startDate < window.end),
      )
    ) {
      flags[assignment.productUnitId] = true;
    }
  }

  return flags;
}
