import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  like,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import 'server-only';

import {
  buildUnitInDowntimeAtPredicate,
  customers,
  db,
  getBlockingReservationStatuses,
  productUnitDowntimes,
  productUnitEvents,
  productUnits,
  products,
  reservationItemUnits,
  reservationItems,
  reservations,
  users,
} from '@louez/db';
import type { BlockingReservationStatus } from '@louez/db';
import type { UnitAttributes } from '@louez/types';
import {
  type GetInventoryInput,
  type GetUnitDowntimesInput,
  type GetUnitTimelineInput,
  getInventorySchema,
  getUnitDowntimesSchema,
  getUnitTimelineSchema,
} from '@louez/validations';

import { getCurrentStore } from '@/lib/store-context';
import { getUnitConflictFlags } from '@/lib/utils/unit-conflicts';

export type InventoryOperationalState =
  | 'available'
  | 'reserved'
  | 'rented_out'
  | 'overdue'
  | 'in_downtime'
  | 'retired';

export type InventoryDowntimeSummary = {
  id: string;
  reason: 'maintenance' | 'repair' | 'other';
  startsAt: Date;
  endsAt: Date | null;
  note: string | null;
};

export type InventoryProductCounters = {
  productId: string;
  totalUnits: number;
  reservedWithoutAssignment: number;
};

export type InventoryUnitRow = {
  kind: 'unit';
  id: string;
  productId: string;
  productName: string;
  productImage: string | null;
  identifier: string;
  notes: string | null;
  attributes: UnitAttributes | null;
  combinationKey: string;
  lifecycleStatus: 'active' | 'retired';
  purchasePrice: string | null;
  purchasedAt: Date | null;
  currentDowntime: InventoryDowntimeSummary | null;
  nextDowntime: InventoryDowntimeSummary | null;
  state: InventoryOperationalState;
  hasConflicts: boolean;
  counters: InventoryProductCounters;
};

export type InventoryBulkProductRow = {
  kind: 'bulk_product';
  productId: string;
  productName: string;
  productImage: string | null;
  quantity: number;
  counters: InventoryProductCounters;
};

export type InventoryRow = InventoryUnitRow | InventoryBulkProductRow;

export type UnitTimelineEntry =
  | {
      kind: 'event';
      id: string;
      type: (typeof productUnitEvents.$inferSelect)['type'];
      actorUserId: string | null;
      actorName: string | null;
      payload: Record<string, unknown> | null;
      createdAt: Date;
    }
  | {
      kind: 'assignment';
      id: string;
      type: 'assigned';
      reservationId: string;
      reservationNumber: string;
      reservationItemId: string;
      identifierSnapshot: string;
      customerName: string | null;
      startDate: Date;
      endDate: Date;
      createdAt: Date;
    };

export type UnitDowntimeStatus = 'current' | 'upcoming' | 'past';

export type UnitDowntimeEntry = {
  id: string;
  reason: 'maintenance' | 'repair' | 'other';
  startsAt: Date;
  endsAt: Date | null;
  note: string | null;
  status: UnitDowntimeStatus;
};

function getCounter(
  countersByProductId: Map<string, InventoryProductCounters>,
  productId: string,
): InventoryProductCounters {
  const existing = countersByProductId.get(productId);
  if (existing) {
    return existing;
  }

  return {
    productId,
    totalUnits: 0,
    reservedWithoutAssignment: 0,
  };
}

function toDowntimeSummary(row: {
  id: string;
  reason: 'maintenance' | 'repair' | 'other';
  startsAt: Date;
  endsAt: Date | null;
  note: string | null;
}): InventoryDowntimeSummary {
  return {
    id: row.id,
    reason: row.reason,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    note: row.note,
  };
}

function deriveOperationalState(params: {
  lifecycleStatus: 'active' | 'retired';
  currentDowntime: InventoryDowntimeSummary | null;
  assignments: Array<{
    status: 'pending' | 'confirmed' | 'ongoing';
    startDate: Date;
    endDate: Date;
  }>;
  blockingStatuses: BlockingReservationStatus[];
  now: Date;
}): InventoryOperationalState {
  if (params.lifecycleStatus === 'retired') {
    return 'retired';
  }

  if (params.currentDowntime) {
    return 'in_downtime';
  }

  if (
    params.assignments.some(
      (assignment) =>
        assignment.status === 'ongoing' && assignment.endDate < params.now,
    )
  ) {
    return 'overdue';
  }

  if (
    params.assignments.some(
      (assignment) =>
        assignment.status === 'ongoing' &&
        assignment.startDate <= params.now &&
        assignment.endDate >= params.now,
    )
  ) {
    return 'rented_out';
  }

  if (
    params.assignments.some(
      (assignment) =>
        assignment.status !== 'ongoing' &&
        params.blockingStatuses.includes(assignment.status) &&
        assignment.endDate >= params.now,
    )
  ) {
    return 'reserved';
  }

  return 'available';
}

function getDowntimeStatus(
  downtime: Pick<UnitDowntimeEntry, 'startsAt' | 'endsAt'>,
  now: Date,
): UnitDowntimeStatus {
  if (downtime.startsAt <= now && (!downtime.endsAt || downtime.endsAt > now)) {
    return 'current';
  }

  if (downtime.startsAt > now) {
    return 'upcoming';
  }

  return 'past';
}

function getDowntimeStatusOrder(status: UnitDowntimeStatus): number {
  if (status === 'current') {
    return 0;
  }

  if (status === 'upcoming') {
    return 1;
  }

  return 2;
}

export async function getInventory(input: GetInventoryInput = {}) {
  const store = await getCurrentStore();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  const validated = getInventorySchema.safeParse(input);
  if (!validated.success) {
    return { error: 'errors.invalidData' };
  }

  const now = new Date();
  const page = validated.data.page ?? 1;
  const pageSize = validated.data.pageSize ?? 50;
  const search = validated.data.search?.trim();
  const blockingStatuses = getBlockingReservationStatuses(
    store.settings?.pendingBlocksAvailability ?? true,
  );

  const unitConditions = [
    eq(products.storeId, store.id),
    eq(products.trackUnits, true),
  ];

  if (validated.data.productId) {
    unitConditions.push(eq(products.id, validated.data.productId));
  }

  if (validated.data.lifecycle) {
    unitConditions.push(
      eq(productUnits.lifecycleStatus, validated.data.lifecycle),
    );
  }

  if (search) {
    const searchCondition = or(
      like(productUnits.identifier, `%${search}%`),
      like(products.name, `%${search}%`),
    );

    if (searchCondition) {
      unitConditions.push(searchCondition);
    }
  }

  const unitRows = await db
    .select({
      id: productUnits.id,
      productId: productUnits.productId,
      productName: products.name,
      productImages: products.images,
      identifier: productUnits.identifier,
      notes: productUnits.notes,
      attributes: productUnits.attributes,
      combinationKey: productUnits.combinationKey,
      lifecycleStatus: productUnits.lifecycleStatus,
      purchasePrice: productUnits.purchasePrice,
      purchasedAt: productUnits.purchasedAt,
    })
    .from(productUnits)
    .innerJoin(products, eq(productUnits.productId, products.id))
    .where(and(...unitConditions))
    .orderBy(asc(products.name), asc(productUnits.identifier));

  const unitIds = unitRows.map((unit) => unit.id);
  const productIds = [...new Set(unitRows.map((unit) => unit.productId))];

  const [
    currentDowntimeRows,
    upcomingDowntimeRows,
    assignmentRows,
    totalUnitRows,
    reservedWithoutAssignmentRows,
  ] = unitIds.length
    ? await Promise.all([
        db
          .select({
            id: productUnitDowntimes.id,
            productUnitId: productUnitDowntimes.productUnitId,
            reason: productUnitDowntimes.reason,
            startsAt: productUnitDowntimes.startsAt,
            endsAt: productUnitDowntimes.endsAt,
            note: productUnitDowntimes.note,
          })
          .from(productUnitDowntimes)
          .where(
            and(
              eq(productUnitDowntimes.storeId, store.id),
              inArray(productUnitDowntimes.productUnitId, unitIds),
              buildUnitInDowntimeAtPredicate(now),
            ),
          )
          .orderBy(desc(productUnitDowntimes.startsAt)),
        db
          .select({
            id: productUnitDowntimes.id,
            productUnitId: productUnitDowntimes.productUnitId,
            reason: productUnitDowntimes.reason,
            startsAt: productUnitDowntimes.startsAt,
            endsAt: productUnitDowntimes.endsAt,
            note: productUnitDowntimes.note,
          })
          .from(productUnitDowntimes)
          .where(
            and(
              eq(productUnitDowntimes.storeId, store.id),
              inArray(productUnitDowntimes.productUnitId, unitIds),
              gt(productUnitDowntimes.startsAt, now),
            ),
          )
          .orderBy(asc(productUnitDowntimes.startsAt)),
        db
          .select({
            productUnitId: reservationItemUnits.productUnitId,
            status: reservations.status,
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
          .where(
            and(
              inArray(reservationItemUnits.productUnitId, unitIds),
              eq(reservations.storeId, store.id),
              inArray(reservations.status, blockingStatuses),
            ),
          ),
        db
          .select({
            productId: productUnits.productId,
            count: sql<number>`count(*)`,
          })
          .from(productUnits)
          .innerJoin(products, eq(productUnits.productId, products.id))
          .where(
            and(
              eq(products.storeId, store.id),
              inArray(productUnits.productId, productIds),
            ),
          )
          .groupBy(productUnits.productId),
        getReservedWithoutAssignmentRows(
          store.id,
          blockingStatuses,
          now,
          productIds,
        ),
      ])
    : [[], [], [], [], []];

  const currentDowntimeByUnitId = new Map<string, InventoryDowntimeSummary>();
  const currentDowntimesByUnitId = new Map<
    string,
    InventoryDowntimeSummary[]
  >();
  for (const downtime of currentDowntimeRows) {
    const summaries =
      currentDowntimesByUnitId.get(downtime.productUnitId) ?? [];
    summaries.push(toDowntimeSummary(downtime));
    currentDowntimesByUnitId.set(downtime.productUnitId, summaries);

    if (!currentDowntimeByUnitId.has(downtime.productUnitId)) {
      currentDowntimeByUnitId.set(
        downtime.productUnitId,
        toDowntimeSummary(downtime),
      );
    }
  }

  const nextDowntimeByUnitId = new Map<string, InventoryDowntimeSummary>();
  const upcomingDowntimesByUnitId = new Map<
    string,
    InventoryDowntimeSummary[]
  >();
  for (const downtime of upcomingDowntimeRows) {
    const summaries =
      upcomingDowntimesByUnitId.get(downtime.productUnitId) ?? [];
    summaries.push(toDowntimeSummary(downtime));
    upcomingDowntimesByUnitId.set(downtime.productUnitId, summaries);

    if (!nextDowntimeByUnitId.has(downtime.productUnitId)) {
      nextDowntimeByUnitId.set(
        downtime.productUnitId,
        toDowntimeSummary(downtime),
      );
    }
  }

  const assignmentsByUnitId = new Map<
    string,
    Array<{
      status: 'pending' | 'confirmed' | 'ongoing';
      startDate: Date;
      endDate: Date;
    }>
  >();
  for (const assignment of assignmentRows) {
    if (!assignment.productUnitId) {
      continue;
    }

    if (
      assignment.status !== 'pending' &&
      assignment.status !== 'confirmed' &&
      assignment.status !== 'ongoing'
    ) {
      continue;
    }

    const assignments = assignmentsByUnitId.get(assignment.productUnitId) ?? [];
    assignments.push({
      status: assignment.status,
      startDate: assignment.startDate,
      endDate: assignment.endDate,
    });
    assignmentsByUnitId.set(assignment.productUnitId, assignments);
  }

  const countersByProductId = new Map<string, InventoryProductCounters>();
  for (const productId of productIds) {
    countersByProductId.set(productId, {
      productId,
      totalUnits: 0,
      reservedWithoutAssignment: 0,
    });
  }

  for (const row of totalUnitRows) {
    countersByProductId.set(row.productId, {
      ...getCounter(countersByProductId, row.productId),
      totalUnits: row.count,
    });
  }

  for (const row of reservedWithoutAssignmentRows) {
    const counter = getCounter(countersByProductId, row.productId);
    countersByProductId.set(row.productId, {
      ...counter,
      reservedWithoutAssignment:
        counter.reservedWithoutAssignment + row.missingQuantity,
    });
  }

  const conflictWindows = unitRows.flatMap((unit) => {
    if (unit.lifecycleStatus === 'retired') {
      return [{ unitId: unit.id, window: { start: now, end: null } }];
    }

    const currentDowntimes = currentDowntimesByUnitId.get(unit.id) ?? [];
    const upcomingDowntimes = upcomingDowntimesByUnitId.get(unit.id) ?? [];

    return [...currentDowntimes, ...upcomingDowntimes].map((downtime) => ({
      unitId: unit.id,
      window: {
        start: downtime.startsAt,
        end: downtime.endsAt,
      },
    }));
  });

  const conflictFlags = await getUnitConflictFlags(conflictWindows, {
    storeId: store.id,
    pendingBlocksAvailability: store.settings?.pendingBlocksAvailability,
    turnoverBufferMinutes: store.settings?.turnoverBufferMinutes ?? 0,
  });

  const unitInventoryRows = unitRows
    .map<InventoryUnitRow>((unit) => {
      const currentDowntime = currentDowntimeByUnitId.get(unit.id) ?? null;
      const nextDowntime = nextDowntimeByUnitId.get(unit.id) ?? null;
      const assignments = assignmentsByUnitId.get(unit.id) ?? [];
      const state = deriveOperationalState({
        lifecycleStatus: unit.lifecycleStatus,
        currentDowntime,
        assignments,
        blockingStatuses,
        now,
      });

      return {
        kind: 'unit',
        id: unit.id,
        productId: unit.productId,
        productName: unit.productName,
        productImage: unit.productImages?.[0] ?? null,
        identifier: unit.identifier,
        notes: unit.notes,
        attributes: unit.attributes ?? null,
        combinationKey: unit.combinationKey,
        lifecycleStatus: unit.lifecycleStatus,
        purchasePrice: unit.purchasePrice,
        purchasedAt: unit.purchasedAt,
        currentDowntime,
        nextDowntime,
        state,
        hasConflicts: conflictFlags[unit.id] ?? false,
        counters: getCounter(countersByProductId, unit.productId),
      };
    })
    .filter(
      (row) => !validated.data.state || row.state === validated.data.state,
    );

  const bulkRows =
    validated.data.lifecycle || validated.data.state
      ? []
      : await getBulkProductRows({
          storeId: store.id,
          productId: validated.data.productId,
          search,
          countersByProductId,
        });

  const rows: InventoryRow[] = [...unitInventoryRows, ...bulkRows];
  const total = rows.length;
  const offset = (page - 1) * pageSize;

  return {
    success: true,
    rows: rows.slice(offset, offset + pageSize),
    page,
    pageSize,
    total,
    counters: [...countersByProductId.values()],
  };
}

async function getReservedWithoutAssignmentRows(
  storeId: string,
  blockingStatuses: BlockingReservationStatus[],
  now: Date,
  productIds: string[],
): Promise<Array<{ productId: string; missingQuantity: number }>> {
  if (productIds.length === 0) {
    return [];
  }

  // Inventory badges only look 30 days ahead to keep the read model bounded.
  const horizonEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      productId: reservationItems.productId,
      quantity: reservationItems.quantity,
      assignedCount: sql<number>`count(${reservationItemUnits.id})`,
    })
    .from(reservationItems)
    .innerJoin(
      reservations,
      eq(reservationItems.reservationId, reservations.id),
    )
    .innerJoin(products, eq(reservationItems.productId, products.id))
    .leftJoin(
      reservationItemUnits,
      eq(reservationItemUnits.reservationItemId, reservationItems.id),
    )
    .where(
      and(
        eq(reservations.storeId, storeId),
        eq(products.trackUnits, true),
        inArray(reservationItems.productId, productIds),
        inArray(reservations.status, blockingStatuses),
        gt(reservations.endDate, now),
        lte(reservations.startDate, horizonEnd),
      ),
    )
    .groupBy(
      reservationItems.id,
      reservationItems.productId,
      reservationItems.quantity,
    );

  return rows.flatMap((row) => {
    if (!row.productId) {
      return [];
    }

    const missingQuantity = Math.max(0, row.quantity - row.assignedCount);
    if (missingQuantity === 0) {
      return [];
    }

    return [{ productId: row.productId, missingQuantity }];
  });
}

async function getBulkProductRows(params: {
  storeId: string;
  productId?: string;
  search?: string;
  countersByProductId: Map<string, InventoryProductCounters>;
}): Promise<InventoryBulkProductRow[]> {
  const conditions = [
    eq(products.storeId, params.storeId),
    eq(products.trackUnits, false),
  ];

  if (params.productId) {
    conditions.push(eq(products.id, params.productId));
  }

  if (params.search) {
    conditions.push(like(products.name, `%${params.search}%`));
  }

  const rows = await db
    .select({
      productId: products.id,
      productName: products.name,
      productImages: products.images,
      quantity: products.quantity,
    })
    .from(products)
    .where(and(...conditions))
    .orderBy(asc(products.name));

  return rows.map((row) => ({
    kind: 'bulk_product',
    productId: row.productId,
    productName: row.productName,
    productImage: row.productImages?.[0] ?? null,
    quantity: row.quantity,
    counters: getCounter(params.countersByProductId, row.productId),
  }));
}

export async function getUnitTimeline(input: GetUnitTimelineInput) {
  const store = await getCurrentStore();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  const validated = getUnitTimelineSchema.safeParse(input);
  if (!validated.success) {
    return { error: 'errors.invalidData' };
  }

  const [unit] = await db
    .select({ id: productUnits.id })
    .from(productUnits)
    .innerJoin(products, eq(productUnits.productId, products.id))
    .where(
      and(
        eq(productUnits.id, validated.data.unitId),
        eq(products.storeId, store.id),
      ),
    )
    .limit(1);

  if (!unit) {
    return { error: 'errors.notFound' };
  }

  const [events, assignments] = await Promise.all([
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
        and(
          eq(productUnitEvents.productUnitId, validated.data.unitId),
          eq(productUnitEvents.storeId, store.id),
        ),
      )
      .orderBy(desc(productUnitEvents.createdAt)),
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
      .innerJoin(
        reservationItems,
        eq(reservationItemUnits.reservationItemId, reservationItems.id),
      )
      .innerJoin(
        reservations,
        eq(reservationItems.reservationId, reservations.id),
      )
      .leftJoin(customers, eq(reservations.customerId, customers.id))
      .where(
        and(
          eq(reservationItemUnits.productUnitId, validated.data.unitId),
          eq(reservations.storeId, store.id),
        ),
      ),
  ]);

  const eventEntries: UnitTimelineEntry[] = events.map((event) => ({
    kind: 'event',
    id: event.id,
    type: event.type,
    actorUserId: event.actorUserId,
    actorName: event.actorName,
    payload: event.payload ?? null,
    createdAt: event.createdAt,
  }));
  const assignmentEntries: UnitTimelineEntry[] = assignments.map(
    (assignment) => ({
      kind: 'assignment',
      id: assignment.id,
      type: 'assigned',
      reservationId: assignment.reservationId,
      reservationNumber: assignment.reservationNumber,
      reservationItemId: assignment.reservationItemId,
      identifierSnapshot: assignment.identifierSnapshot,
      customerName: assignment.customerName,
      startDate: assignment.startDate,
      endDate: assignment.endDate,
      createdAt: assignment.assignedAt,
    }),
  );
  const timeline = [...eventEntries, ...assignmentEntries].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );

  return { success: true, timeline };
}

export async function getUnitDowntimes(input: GetUnitDowntimesInput) {
  const store = await getCurrentStore();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  const validated = getUnitDowntimesSchema.safeParse(input);
  if (!validated.success) {
    return { error: 'errors.invalidData' };
  }

  const [unit] = await db
    .select({ id: productUnits.id })
    .from(productUnits)
    .innerJoin(products, eq(productUnits.productId, products.id))
    .where(
      and(
        eq(productUnits.id, validated.data.unitId),
        eq(products.storeId, store.id),
      ),
    )
    .limit(1);

  if (!unit) {
    return { error: 'errors.notFound' };
  }

  const rows = await db
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
        eq(productUnitDowntimes.productUnitId, validated.data.unitId),
        eq(productUnitDowntimes.storeId, store.id),
      ),
    );

  const now = new Date();
  const downtimes: UnitDowntimeEntry[] = rows
    .map((row) => ({
      ...row,
      status: getDowntimeStatus(row, now),
    }))
    .sort((a, b) => {
      const statusOrder =
        getDowntimeStatusOrder(a.status) - getDowntimeStatusOrder(b.status);
      if (statusOrder !== 0) {
        return statusOrder;
      }

      if (a.status === 'upcoming') {
        return a.startsAt.getTime() - b.startsAt.getTime();
      }

      return b.startsAt.getTime() - a.startsAt.getTime();
    });

  return { success: true, downtimes };
}
