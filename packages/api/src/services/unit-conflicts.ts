import { and, eq, gt, inArray, isNull, lt, not, or, sql } from "drizzle-orm";

import {
  buildReservationOverlapPredicate,
  customers,
  db,
  productUnitDowntimes,
  productUnits,
  products,
  reservationAvailabilityEndSql,
  reservationItemUnits,
  reservationItems,
  reservations,
  type Database,
  type Transaction,
} from "@louez/db";

import {
  type AvailableUnit,
  type BlockingReservationStatus,
  getAvailableUnitsForProduct,
  getBlockingReservationStatuses,
  resolveUnitAssignmentScope,
} from "./unit-availability";

/**
 * The reservations that hold a unit over a window, and the units that could
 * serve each of them instead. A downtime or a retirement shows them, so the
 * owner can move each booking to another unit.
 */

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
  /** The caller's transaction when it holds the unit's locks; the pool otherwise. */
  executor?: Database | Transaction;
  pendingBlocksAvailability?: boolean;
  turnoverBufferMinutes?: number;
  excludeReservationItemId?: string;
  excludeReservationItemIds?: string[];
};

type GetUnitConflictFlagsOptions = {
  storeId: string;
  pendingBlocksAvailability?: boolean;
  turnoverBufferMinutes?: number;
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
  const blockingStatuses = getBlockingStatuses(options.pendingBlocksAvailability);
  const turnoverBufferMinutes = options.turnoverBufferMinutes ?? 0;
  const executor = options.executor ?? db;

  const [unit] = await executor
    .select({
      id: productUnits.id,
      productId: productUnits.productId,
      combinationKey: productUnits.combinationKey,
    })
    .from(productUnits)
    .innerJoin(products, eq(productUnits.productId, products.id))
    .where(and(eq(productUnits.id, unitId), eq(products.storeId, options.storeId)))
    .limit(1);

  if (!unit) {
    return [];
  }

  const conditions = [
    eq(reservationItemUnits.productUnitId, unitId),
    eq(reservations.storeId, options.storeId),
    inArray(reservations.status, blockingStatuses),
  ];

  if (window.end) {
    conditions.push(
      buildReservationOverlapPredicate({
        start: window.start,
        end: window.end,
        turnoverBufferMinutes,
      }),
    );
  } else {
    conditions.push(
      gt(
        reservationAvailabilityEndSql(),
        new Date(window.start.getTime() - Math.max(0, turnoverBufferMinutes) * 60_000),
      ),
    );
  }

  const excludedReservationItemIds = [
    ...(options.excludeReservationItemId ? [options.excludeReservationItemId] : []),
    ...(options.excludeReservationItemIds ?? []),
  ];
  const uniqueExcludedReservationItemIds = [...new Set(excludedReservationItemIds)];

  const [onlyExcludedReservationItemId] = uniqueExcludedReservationItemIds;
  if (uniqueExcludedReservationItemIds.length === 1 && onlyExcludedReservationItemId) {
    conditions.push(not(eq(reservationItems.id, onlyExcludedReservationItemId)));
  } else if (uniqueExcludedReservationItemIds.length > 1) {
    conditions.push(not(inArray(reservationItems.id, uniqueExcludedReservationItemIds)));
  }

  const conflicts = await executor
    .select({
      reservationId: reservations.id,
      reservationNumber: reservations.number,
      customerName: sql<
        string | null
      >`NULLIF(TRIM(CONCAT(COALESCE(${customers.firstName}, ''), ' ', COALESCE(${customers.lastName}, ''))), '')`,
      startDate: reservations.startDate,
      endDate: reservationAvailabilityEndSql(),
      reservationItemId: reservationItems.id,
      itemCombinationKey: reservationItems.combinationKey,
      itemSelectedAttributes: reservationItems.selectedAttributes,
    })
    .from(reservationItemUnits)
    .innerJoin(reservationItems, eq(reservationItemUnits.reservationItemId, reservationItems.id))
    .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
    .leftJoin(customers, eq(reservations.customerId, customers.id))
    .where(and(...conditions))
    .orderBy(reservations.startDate, reservationItems.id);

  // One at a time: a transaction's connection runs one query at once.
  const withCandidates: UnitConflict[] = [];
  for (const { itemCombinationKey, itemSelectedAttributes, ...conflict } of conflicts) {
    // Replacements are the units the booked line may be served from, not
    // only the current unit's combination: a pooled line takes any unit.
    const scope = await resolveUnitAssignmentScope(executor, {
      productId: unit.productId,
      combinationKey: itemCombinationKey,
      selectedAttributes: itemSelectedAttributes,
    });
    const candidates = await getAvailableUnitsForProduct(
      unit.productId,
      conflict.startDate,
      conflict.endDate,
      {
        blockingStatuses,
        turnoverBufferMinutes,
        excludeReservationItemId: conflict.reservationItemId,
        combinationKey: scope.combinationKey,
        selectedAttributes: scope.selectedAttributes,
        executor,
      },
    );
    withCandidates.push({
      ...conflict,
      replacementCandidates: candidates.filter((candidate) => candidate.id !== unit.id),
    });
  }
  return withCandidates;
}

/** What makes a unit unable to serve over a window, and when that was last written here. */
export type UnitConflictCause = { kind: "retired" | "downtime"; changedAt: Date };

/** A window a unit cannot serve, with its cause. */
export type UnitWindow = { unitId: string; window: UnitConflictWindow; cause: UnitConflictCause };

/**
 * The windows the product page checks a unit against: a retired unit
 * conflicts with any booking still to end (an open window from now), an
 * active one with each of its downtimes still open.
 */
export function unitConflictWindows(
  units: ReadonlyArray<{ id: string; lifecycleStatus: string; updatedAt: Date }>,
  openDowntimes: ReadonlyArray<{
    productUnitId: string | null;
    startsAt: Date;
    endsAt: Date | null;
    updatedAt: Date;
  }>,
  now: Date,
): UnitWindow[] {
  return units.flatMap((unit): UnitWindow[] => {
    if (unit.lifecycleStatus === "retired") {
      return [
        {
          unitId: unit.id,
          window: { start: now, end: null },
          cause: { kind: "retired", changedAt: unit.updatedAt },
        },
      ];
    }
    return openDowntimes
      .filter((downtime) => downtime.productUnitId === unit.id)
      .map((downtime) => ({
        unitId: unit.id,
        window: { start: downtime.startsAt, end: downtime.endsAt },
        cause: { kind: "downtime", changedAt: downtime.updatedAt },
      }));
  });
}

/** A booking's hold on a unit that falls in one or more of the unit's windows. */
export type ConflictingAssignment = {
  /** The reservation_item_units row. */
  assignmentId: string;
  productUnitId: string;
  reservationId: string;
  assignedAt: Date;
  /** When the reservation was last written: an edit of its dates may make the conflict. */
  reservationUpdatedAt: Date;
  /** The windows it falls in. */
  causes: UnitConflictCause[];
};

/**
 * The bookings that hold a unit over one of its windows, with the store's
 * turnover buffer around each window: the check behind the product page's
 * conflict flags and the inbox's unit conflicts.
 */
export async function findConflictingAssignments(
  windows: readonly UnitWindow[],
  options: GetUnitConflictFlagsOptions,
): Promise<ConflictingAssignment[]> {
  if (windows.length === 0) return [];

  const blockingStatuses = getBlockingStatuses(options.pendingBlocksAvailability);
  const bufferMs = Math.max(0, options.turnoverBufferMinutes ?? 0) * 60_000;
  const windowsByUnitId = new Map<string, UnitWindow[]>();
  for (const item of windows) {
    const unitWindows = windowsByUnitId.get(item.unitId) ?? [];
    unitWindows.push(item);
    windowsByUnitId.set(item.unitId, unitWindows);
  }

  const unitIds = [...windowsByUnitId.keys()];
  const minStart = new Date(
    Math.min(...windows.map((item) => item.window.start.getTime())) - bufferMs,
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
    conditions.push(lt(reservations.startDate, new Date(maxFiniteEnd.getTime() + bufferMs)));
  }

  const assignments = await db
    .select({
      assignmentId: reservationItemUnits.id,
      productUnitId: reservationItemUnits.productUnitId,
      assignedAt: reservationItemUnits.assignedAt,
      reservationId: reservations.id,
      reservationUpdatedAt: reservations.updatedAt,
      startDate: reservations.startDate,
      endDate: reservationAvailabilityEndSql(),
    })
    .from(reservationItemUnits)
    .innerJoin(reservationItems, eq(reservationItemUnits.reservationItemId, reservationItems.id))
    .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
    .where(and(...conditions));

  return assignments.flatMap((assignment): ConflictingAssignment[] => {
    const { productUnitId } = assignment;
    if (!productUnitId) return [];
    const causes = (windowsByUnitId.get(productUnitId) ?? [])
      .filter(({ window }) => {
        const bufferedStart = new Date(window.start.getTime() - bufferMs);
        const bufferedEnd = window.end ? new Date(window.end.getTime() + bufferMs) : null;
        return (
          assignment.endDate > bufferedStart &&
          (bufferedEnd === null || assignment.startDate < bufferedEnd)
        );
      })
      .map((item) => item.cause);
    if (causes.length === 0) return [];
    return [
      {
        assignmentId: assignment.assignmentId,
        productUnitId,
        reservationId: assignment.reservationId,
        assignedAt: assignment.assignedAt,
        reservationUpdatedAt: assignment.reservationUpdatedAt,
        causes,
      },
    ];
  });
}

/** Whether each unit has a booking over one of its windows, as the product page flags it. */
export async function getUnitConflictFlags(
  windows: readonly UnitWindow[],
  options: GetUnitConflictFlagsOptions,
): Promise<Record<string, boolean>> {
  const flags: Record<string, boolean> = {};
  for (const item of windows) flags[item.unitId] = false;
  for (const assignment of await findConflictingAssignments(windows, options)) {
    flags[assignment.productUnitId] = true;
  }
  return flags;
}

/**
 * Every window of the store's units, as the product page builds them for one
 * product: its retired units that still hold a booking to end, and the open
 * downtimes of its active units.
 */
export async function loadStoreUnitWindows(storeId: string, now: Date): Promise<UnitWindow[]> {
  const [retired, downtimes] = await Promise.all([
    db
      .selectDistinct({
        id: productUnits.id,
        lifecycleStatus: productUnits.lifecycleStatus,
        updatedAt: productUnits.updatedAt,
      })
      .from(productUnits)
      .innerJoin(products, eq(products.id, productUnits.productId))
      .innerJoin(reservationItemUnits, eq(reservationItemUnits.productUnitId, productUnits.id))
      .innerJoin(reservationItems, eq(reservationItems.id, reservationItemUnits.reservationItemId))
      .innerJoin(reservations, eq(reservations.id, reservationItems.reservationId))
      .where(
        and(
          eq(products.storeId, storeId),
          eq(productUnits.lifecycleStatus, "retired"),
          eq(reservations.storeId, storeId),
          gt(reservations.endDate, now),
        ),
      ),
    db
      .select({
        id: productUnits.id,
        lifecycleStatus: productUnits.lifecycleStatus,
        updatedAt: productUnits.updatedAt,
        productUnitId: productUnitDowntimes.productUnitId,
        startsAt: productUnitDowntimes.startsAt,
        endsAt: productUnitDowntimes.endsAt,
        downtimeUpdatedAt: productUnitDowntimes.updatedAt,
      })
      .from(productUnitDowntimes)
      .innerJoin(productUnits, eq(productUnits.id, productUnitDowntimes.productUnitId))
      .where(
        and(
          eq(productUnitDowntimes.storeId, storeId),
          eq(productUnits.lifecycleStatus, "active"),
          or(isNull(productUnitDowntimes.endsAt), gt(productUnitDowntimes.endsAt, now)),
        ),
      ),
  ]);
  const activeUnits = new Map(downtimes.map((row) => [row.id, row]));
  return unitConflictWindows(
    [...retired, ...activeUnits.values()],
    downtimes.map((row) => ({ ...row, updatedAt: row.downtimeUpdatedAt })),
    now,
  );
}
