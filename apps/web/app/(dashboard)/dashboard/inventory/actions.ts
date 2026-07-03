'use server';

import { revalidatePath } from 'next/cache';

import { and, eq, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import {
  db,
  productUnitDowntimes,
  productUnitEvents,
  productUnits,
  products,
  reservationActivity,
  reservationItemUnits,
  reservationItems,
  reservations,
} from '@louez/db';
import { DEFAULT_COMBINATION_KEY } from '@louez/utils';
import {
  type CloseDowntimeInput,
  type DeclareDowntimeInput,
  type DeleteDowntimeInput,
  type ReassignReservationItemUnitInput,
  type ReinstateUnitInput,
  type RetireUnitInput,
  type UpdateDowntimeInput,
  type UpdateUnitDetailsInput,
  closeDowntimeSchema,
  declareDowntimeSchema,
  deleteDowntimeSchema,
  reassignReservationItemUnitSchema,
  reinstateUnitSchema,
  retireUnitSchema,
  updateDowntimeSchema,
  updateUnitDetailsSchema,
} from '@louez/validations';

import { auth } from '@/lib/auth';
import { getCurrentStore } from '@/lib/store-context';
import {
  checkUnitsAvailability,
  getBlockingReservationStatuses,
} from '@/lib/utils/unit-availability';
import { getUnitConflicts } from '@/lib/utils/unit-conflicts';

import {
  getUnitDowntimes as getUnitDowntimesQuery,
  getUnitTimeline as getUnitTimelineQuery,
} from './queries';

async function getStoreForUser() {
  return getCurrentStore();
}

async function getActorUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

function hasOwnProperty<T extends object>(
  object: T,
  key: PropertyKey,
): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function normalizeNullableText(
  value: string | null | undefined,
): string | null {
  if (value == null) {
    return null;
  }

  return value.trim() || null;
}

function normalizeMoney(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  return value.trim().replace(',', '.') || null;
}

function toJsonDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function buildUnitEvent(values: {
  productUnitId: string;
  storeId: string;
  type: (typeof productUnitEvents.$inferInsert)['type'];
  actorUserId: string | null;
  payload?: Record<string, unknown> | null;
}): typeof productUnitEvents.$inferInsert {
  return {
    id: nanoid(),
    productUnitId: values.productUnitId,
    storeId: values.storeId,
    type: values.type,
    actorUserId: values.actorUserId,
    payload: values.payload ?? null,
  };
}

async function logReservationActivity(
  reservationId: string,
  activityType: 'modified',
  metadata?: Record<string, unknown>,
) {
  const session = await auth();
  const userId = session?.user?.id || null;

  await db.insert(reservationActivity).values({
    id: nanoid(),
    reservationId,
    userId,
    activityType,
    metadata,
  });
}

async function getUnitForStore(unitId: string, storeId: string) {
  const [unit] = await db
    .select({
      id: productUnits.id,
      productId: productUnits.productId,
      identifier: productUnits.identifier,
      notes: productUnits.notes,
      combinationKey: productUnits.combinationKey,
      lifecycleStatus: productUnits.lifecycleStatus,
      retiredAt: productUnits.retiredAt,
      retirementReason: productUnits.retirementReason,
      retirementNote: productUnits.retirementNote,
      purchasePrice: productUnits.purchasePrice,
      purchasedAt: productUnits.purchasedAt,
    })
    .from(productUnits)
    .innerJoin(products, eq(productUnits.productId, products.id))
    .where(and(eq(productUnits.id, unitId), eq(products.storeId, storeId)))
    .limit(1);

  return unit ?? null;
}

async function getDowntimeForStore(downtimeId: string, storeId: string) {
  const [downtime] = await db
    .select({
      id: productUnitDowntimes.id,
      productUnitId: productUnitDowntimes.productUnitId,
      storeId: productUnitDowntimes.storeId,
      reason: productUnitDowntimes.reason,
      startsAt: productUnitDowntimes.startsAt,
      endsAt: productUnitDowntimes.endsAt,
      note: productUnitDowntimes.note,
      productId: productUnits.productId,
    })
    .from(productUnitDowntimes)
    .innerJoin(
      productUnits,
      eq(productUnitDowntimes.productUnitId, productUnits.id),
    )
    .innerJoin(products, eq(productUnits.productId, products.id))
    .where(
      and(
        eq(productUnitDowntimes.id, downtimeId),
        eq(products.storeId, storeId),
      ),
    )
    .limit(1);

  return downtime ?? null;
}

function revalidateInventoryPaths(productId?: string, reservationId?: string) {
  revalidatePath('/dashboard/inventory');
  revalidatePath('/dashboard/products');

  if (productId) {
    revalidatePath(`/dashboard/products/${productId}`);
  }

  if (reservationId) {
    revalidatePath(`/dashboard/reservations/${reservationId}`);
  }
}

async function refreshTrackedProductQuantity(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  productId: string,
) {
  const [product] = await tx
    .select({ trackUnits: products.trackUnits })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);

  if (!product?.trackUnits) {
    return;
  }

  const [activeUnits] = await tx
    .select({ count: sql<number>`count(*)` })
    .from(productUnits)
    .where(
      and(
        eq(productUnits.productId, productId),
        eq(productUnits.lifecycleStatus, 'active'),
      ),
    );

  await tx
    .update(products)
    .set({
      quantity: activeUnits?.count ?? 0,
      updatedAt: new Date(),
    })
    .where(eq(products.id, productId));
}

export async function declareDowntime(input: DeclareDowntimeInput) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  const validated = declareDowntimeSchema.safeParse(input);
  if (!validated.success) {
    return { error: 'errors.invalidData' };
  }

  const unit = await getUnitForStore(validated.data.unitId, store.id);
  if (!unit) {
    return { error: 'errors.notFound' };
  }

  const downtimeId = nanoid();
  const actorUserId = await getActorUserId();
  const note = normalizeNullableText(validated.data.note);
  const endsAt = validated.data.endsAt ?? null;

  try {
    await db.transaction(async (tx) => {
      await tx.insert(productUnitDowntimes).values({
        id: downtimeId,
        productUnitId: unit.id,
        storeId: store.id,
        reason: validated.data.reason,
        startsAt: validated.data.startsAt,
        endsAt,
        note,
        createdByUserId: actorUserId,
      });

      await tx.insert(productUnitEvents).values(
        buildUnitEvent({
          productUnitId: unit.id,
          storeId: store.id,
          type: 'downtime_declared',
          actorUserId,
          payload: {
            downtimeId,
            reason: validated.data.reason,
            startsAt: validated.data.startsAt.toISOString(),
            endsAt: toJsonDate(endsAt),
            note,
          },
        }),
      );
    });
  } catch (error) {
    console.error('Error declaring unit downtime:', error);
    return { error: 'errors.invalidData' };
  }

  const conflicts = await getUnitConflicts(
    unit.id,
    { start: validated.data.startsAt, end: endsAt },
    {
      storeId: store.id,
      pendingBlocksAvailability: store.settings?.pendingBlocksAvailability,
      turnoverBufferMinutes: store.settings?.turnoverBufferMinutes ?? 0,
    },
  );

  revalidateInventoryPaths(unit.productId);
  return { success: true, downtimeId, conflicts };
}

export async function updateDowntime(input: UpdateDowntimeInput) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  const validated = updateDowntimeSchema.safeParse(input);
  if (!validated.success) {
    return { error: 'errors.invalidData' };
  }

  const downtime = await getDowntimeForStore(
    validated.data.downtimeId,
    store.id,
  );
  if (!downtime) {
    return { error: 'errors.notFound' };
  }

  const startsAt = hasOwnProperty(validated.data, 'startsAt')
    ? (validated.data.startsAt ?? downtime.startsAt)
    : downtime.startsAt;
  const endsAt =
    !hasOwnProperty(validated.data, 'endsAt') ||
    validated.data.endsAt === undefined
      ? downtime.endsAt
      : validated.data.endsAt;

  if (endsAt && startsAt >= endsAt) {
    return { error: 'errors.invalidData' };
  }

  const reason = validated.data.reason ?? downtime.reason;
  const note = hasOwnProperty(validated.data, 'note')
    ? normalizeNullableText(validated.data.note)
    : downtime.note;
  const actorUserId = await getActorUserId();

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(productUnitDowntimes)
        .set({
          reason,
          startsAt,
          endsAt,
          note,
          updatedAt: new Date(),
        })
        .where(eq(productUnitDowntimes.id, downtime.id));

      await tx.insert(productUnitEvents).values(
        buildUnitEvent({
          productUnitId: downtime.productUnitId,
          storeId: store.id,
          type: 'downtime_updated',
          actorUserId,
          payload: {
            downtimeId: downtime.id,
            previous: {
              reason: downtime.reason,
              startsAt: downtime.startsAt.toISOString(),
              endsAt: toJsonDate(downtime.endsAt),
              note: downtime.note,
            },
            current: {
              reason,
              startsAt: startsAt.toISOString(),
              endsAt: toJsonDate(endsAt),
              note,
            },
          },
        }),
      );
    });
  } catch (error) {
    console.error('Error updating unit downtime:', error);
    return { error: 'errors.invalidData' };
  }

  const conflicts = await getUnitConflicts(
    downtime.productUnitId,
    { start: startsAt, end: endsAt },
    {
      storeId: store.id,
      pendingBlocksAvailability: store.settings?.pendingBlocksAvailability,
      turnoverBufferMinutes: store.settings?.turnoverBufferMinutes ?? 0,
    },
  );

  revalidateInventoryPaths(downtime.productId);
  return { success: true, conflicts };
}

export async function closeDowntime(input: CloseDowntimeInput) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  const validated = closeDowntimeSchema.safeParse(input);
  if (!validated.success) {
    return { error: 'errors.invalidData' };
  }

  const downtime = await getDowntimeForStore(
    validated.data.downtimeId,
    store.id,
  );
  if (!downtime) {
    return { error: 'errors.notFound' };
  }

  const endsAt = validated.data.endsAt ?? new Date();
  if (downtime.startsAt >= endsAt) {
    return { error: 'errors.invalidData' };
  }

  const actorUserId = await getActorUserId();

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(productUnitDowntimes)
        .set({
          endsAt,
          updatedAt: new Date(),
        })
        .where(eq(productUnitDowntimes.id, downtime.id));

      await tx.insert(productUnitEvents).values(
        buildUnitEvent({
          productUnitId: downtime.productUnitId,
          storeId: store.id,
          type: 'downtime_closed',
          actorUserId,
          payload: {
            downtimeId: downtime.id,
            endsAt: endsAt.toISOString(),
          },
        }),
      );
    });
  } catch (error) {
    console.error('Error closing unit downtime:', error);
    return { error: 'errors.invalidData' };
  }

  revalidateInventoryPaths(downtime.productId);
  return { success: true };
}

export async function deleteDowntime(input: DeleteDowntimeInput) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  const validated = deleteDowntimeSchema.safeParse(input);
  if (!validated.success) {
    return { error: 'errors.invalidData' };
  }

  const downtime = await getDowntimeForStore(
    validated.data.downtimeId,
    store.id,
  );
  if (!downtime) {
    return { error: 'errors.notFound' };
  }

  const actorUserId = await getActorUserId();

  try {
    await db.transaction(async (tx) => {
      await tx.insert(productUnitEvents).values(
        buildUnitEvent({
          productUnitId: downtime.productUnitId,
          storeId: store.id,
          type: 'downtime_deleted',
          actorUserId,
          payload: {
            downtimeId: downtime.id,
            reason: downtime.reason,
            startsAt: downtime.startsAt.toISOString(),
            endsAt: toJsonDate(downtime.endsAt),
            note: downtime.note,
          },
        }),
      );

      await tx
        .delete(productUnitDowntimes)
        .where(eq(productUnitDowntimes.id, downtime.id));
    });
  } catch (error) {
    console.error('Error deleting unit downtime:', error);
    return { error: 'errors.invalidData' };
  }

  revalidateInventoryPaths(downtime.productId);
  return { success: true };
}

export async function retireUnit(input: RetireUnitInput) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  const validated = retireUnitSchema.safeParse(input);
  if (!validated.success) {
    return { error: 'errors.invalidData' };
  }

  const unit = await getUnitForStore(validated.data.unitId, store.id);
  if (!unit) {
    return { error: 'errors.notFound' };
  }

  if (unit.lifecycleStatus === 'retired') {
    return { error: 'errors.unitAlreadyRetired' };
  }

  const now = new Date();
  const actorUserId = await getActorUserId();
  const note = normalizeNullableText(validated.data.note);

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(productUnits)
        .set({
          lifecycleStatus: 'retired',
          retiredAt: now,
          retirementReason: validated.data.reason,
          retirementNote: note,
          updatedAt: new Date(),
        })
        .where(eq(productUnits.id, unit.id));

      await refreshTrackedProductQuantity(tx, unit.productId);

      await tx.insert(productUnitEvents).values(
        buildUnitEvent({
          productUnitId: unit.id,
          storeId: store.id,
          type: 'retired',
          actorUserId,
          payload: {
            reason: validated.data.reason,
            note,
            retiredAt: now.toISOString(),
          },
        }),
      );
    });
  } catch (error) {
    console.error('Error retiring unit:', error);
    return { error: 'errors.invalidData' };
  }

  const conflicts = await getUnitConflicts(
    unit.id,
    { start: now, end: null },
    {
      storeId: store.id,
      pendingBlocksAvailability: store.settings?.pendingBlocksAvailability,
      turnoverBufferMinutes: store.settings?.turnoverBufferMinutes ?? 0,
    },
  );

  revalidateInventoryPaths(unit.productId);
  return { success: true, conflicts };
}

export async function reinstateUnit(input: ReinstateUnitInput) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  const validated = reinstateUnitSchema.safeParse(input);
  if (!validated.success) {
    return { error: 'errors.invalidData' };
  }

  const unit = await getUnitForStore(validated.data.unitId, store.id);
  if (!unit) {
    return { error: 'errors.notFound' };
  }

  if (unit.lifecycleStatus !== 'retired') {
    return { error: 'errors.unitNotRetired' };
  }

  const actorUserId = await getActorUserId();

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(productUnits)
        .set({
          lifecycleStatus: 'active',
          retiredAt: null,
          retirementReason: null,
          retirementNote: null,
          updatedAt: new Date(),
        })
        .where(eq(productUnits.id, unit.id));

      await refreshTrackedProductQuantity(tx, unit.productId);

      await tx.insert(productUnitEvents).values(
        buildUnitEvent({
          productUnitId: unit.id,
          storeId: store.id,
          type: 'reinstated',
          actorUserId,
          payload: {
            previous: {
              retiredAt: toJsonDate(unit.retiredAt),
              retirementReason: unit.retirementReason,
              retirementNote: unit.retirementNote,
            },
          },
        }),
      );
    });
  } catch (error) {
    console.error('Error reinstating unit:', error);
    return { error: 'errors.invalidData' };
  }

  revalidateInventoryPaths(unit.productId);
  return { success: true };
}

export async function updateUnitDetails(input: UpdateUnitDetailsInput) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  const validated = updateUnitDetailsSchema.safeParse(input);
  if (!validated.success) {
    return { error: 'errors.invalidData' };
  }

  const unit = await getUnitForStore(validated.data.unitId, store.id);
  if (!unit) {
    return { error: 'errors.notFound' };
  }

  const updates: Partial<typeof productUnits.$inferInsert> = {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  if (hasOwnProperty(validated.data, 'notes')) {
    const nextNotes = normalizeNullableText(validated.data.notes);
    if (nextNotes !== unit.notes) {
      updates.notes = nextNotes;
      changes.notes = { from: unit.notes, to: nextNotes };
    }
  }

  if (hasOwnProperty(validated.data, 'purchasePrice')) {
    const nextPurchasePrice = normalizeMoney(validated.data.purchasePrice);
    if (nextPurchasePrice !== unit.purchasePrice) {
      updates.purchasePrice = nextPurchasePrice;
      changes.purchasePrice = {
        from: unit.purchasePrice,
        to: nextPurchasePrice,
      };
    }
  }

  if (hasOwnProperty(validated.data, 'purchasedAt')) {
    const nextPurchasedAt = validated.data.purchasedAt ?? null;
    const currentPurchasedAtTime = unit.purchasedAt?.getTime() ?? null;
    const nextPurchasedAtTime = nextPurchasedAt?.getTime() ?? null;

    if (currentPurchasedAtTime !== nextPurchasedAtTime) {
      updates.purchasedAt = nextPurchasedAt;
      changes.purchasedAt = {
        from: toJsonDate(unit.purchasedAt),
        to: toJsonDate(nextPurchasedAt),
      };
    }
  }

  if (Object.keys(changes).length === 0) {
    return { success: true };
  }

  const actorUserId = await getActorUserId();

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(productUnits)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(productUnits.id, unit.id));

      await tx.insert(productUnitEvents).values(
        buildUnitEvent({
          productUnitId: unit.id,
          storeId: store.id,
          type: 'updated',
          actorUserId,
          payload: { changes },
        }),
      );
    });
  } catch (error) {
    console.error('Error updating unit details:', error);
    return { error: 'errors.invalidData' };
  }

  revalidateInventoryPaths(unit.productId);
  return { success: true };
}

export async function reassignReservationItemUnit(
  input: ReassignReservationItemUnitInput,
) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  const validated = reassignReservationItemUnitSchema.safeParse(input);
  if (!validated.success) {
    return { error: 'errors.invalidData' };
  }

  if (validated.data.fromUnitId === validated.data.toUnitId) {
    return { error: 'errors.invalidData' };
  }

  const [item] = await db
    .select({
      id: reservationItems.id,
      productId: reservationItems.productId,
      combinationKey: reservationItems.combinationKey,
      reservationId: reservationItems.reservationId,
      startDate: reservations.startDate,
      endDate: reservations.endDate,
    })
    .from(reservationItems)
    .innerJoin(
      reservations,
      eq(reservationItems.reservationId, reservations.id),
    )
    .where(
      and(
        eq(reservationItems.id, validated.data.reservationItemId),
        eq(reservations.storeId, store.id),
      ),
    )
    .limit(1);

  if (!item || !item.productId) {
    return { error: 'errors.notFound' };
  }

  const units = await db
    .select({
      id: productUnits.id,
      productId: productUnits.productId,
      identifier: productUnits.identifier,
      combinationKey: productUnits.combinationKey,
      lifecycleStatus: productUnits.lifecycleStatus,
    })
    .from(productUnits)
    .innerJoin(products, eq(productUnits.productId, products.id))
    .where(
      and(
        inArray(productUnits.id, [
          validated.data.fromUnitId,
          validated.data.toUnitId,
        ]),
        eq(products.storeId, store.id),
      ),
    );

  const fromUnit = units.find((unit) => unit.id === validated.data.fromUnitId);
  const toUnit = units.find((unit) => unit.id === validated.data.toUnitId);

  if (!fromUnit || !toUnit) {
    return { error: 'errors.invalidUnits' };
  }

  if (
    fromUnit.productId !== item.productId ||
    toUnit.productId !== item.productId
  ) {
    return { error: 'errors.unitProductMismatch' };
  }

  if (toUnit.lifecycleStatus !== 'active') {
    return { error: 'errors.invalidUnits' };
  }

  const fromCombinationKey = fromUnit.combinationKey || DEFAULT_COMBINATION_KEY;
  const toCombinationKey = toUnit.combinationKey || DEFAULT_COMBINATION_KEY;
  const itemCombinationKey = item.combinationKey || DEFAULT_COMBINATION_KEY;

  if (
    fromCombinationKey !== toCombinationKey ||
    toCombinationKey !== itemCombinationKey
  ) {
    return { error: 'errors.unitCombinationMismatch' };
  }

  const [existingAssignment] = await db
    .select({ id: reservationItemUnits.id })
    .from(reservationItemUnits)
    .where(
      and(
        eq(reservationItemUnits.reservationItemId, item.id),
        eq(reservationItemUnits.productUnitId, fromUnit.id),
      ),
    )
    .limit(1);

  if (!existingAssignment) {
    return { error: 'errors.notFound' };
  }

  const [duplicateAssignment] = await db
    .select({ id: reservationItemUnits.id })
    .from(reservationItemUnits)
    .where(
      and(
        eq(reservationItemUnits.reservationItemId, item.id),
        eq(reservationItemUnits.productUnitId, toUnit.id),
      ),
    )
    .limit(1);

  if (duplicateAssignment) {
    return { error: 'errors.invalidUnits' };
  }

  const availability = await checkUnitsAvailability(
    [toUnit.id],
    item.startDate,
    item.endDate,
    {
      blockingStatuses: getBlockingReservationStatuses(
        (store.settings?.pendingBlocksAvailability) ?? true,
      ),
      turnoverBufferMinutes: store.settings?.turnoverBufferMinutes ?? 0,
      excludeReservationItemId: item.id,
    },
  );

  if (!availability[toUnit.id]) {
    return { error: 'errors.invalidUnits' };
  }

  const actorUserId = await getActorUserId();
  const eventPayload = {
    reservationId: item.reservationId,
    reservationItemId: item.id,
  };

  try {
    await db.transaction(async (tx) => {
      await tx
        .delete(reservationItemUnits)
        .where(eq(reservationItemUnits.id, existingAssignment.id));

      await tx.insert(reservationItemUnits).values({
        id: nanoid(),
        reservationItemId: item.id,
        productUnitId: toUnit.id,
        identifierSnapshot: toUnit.identifier,
        assignedAt: new Date(),
      });

      await tx.insert(productUnitEvents).values([
        buildUnitEvent({
          productUnitId: fromUnit.id,
          storeId: store.id,
          type: 'unassigned',
          actorUserId,
          payload: eventPayload,
        }),
        buildUnitEvent({
          productUnitId: toUnit.id,
          storeId: store.id,
          type: 'assigned',
          actorUserId,
          payload: eventPayload,
        }),
      ]);
    });

    await logReservationActivity(item.reservationId, 'modified', {
      action: 'unit_reassigned',
      reservationItemId: item.id,
      unitIdentifiers: {
        from: fromUnit.identifier,
        to: toUnit.identifier,
      },
    });
  } catch (error) {
    console.error('Error reassigning reservation item unit:', error);
    return { error: 'errors.invalidData' };
  }

  revalidateInventoryPaths(item.productId, item.reservationId);
  return { success: true };
}

export async function loadUnitTimeline(input: { unitId: string }) {
  return getUnitTimelineQuery(input);
}

export async function loadUnitDowntimes(input: { unitId: string }) {
  return getUnitDowntimesQuery(input);
}
