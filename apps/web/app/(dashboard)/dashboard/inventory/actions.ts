'use server';

import { revalidatePath } from 'next/cache';

import { and, eq, inArray, not } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import {
  buildUnitRentableDuringPredicate,
  db,
  findBusyUnitIds,
  getBlockingReservationStatuses,
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
import { getUnitConflicts } from '@/lib/utils/unit-conflicts';
import {
  buildUnitEvent,
  updateUnits,
} from '@/lib/utils/unit-mutations';

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
      unitIdentifier: productUnits.identifier,
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
          event: {
            storeId: store.id,
            type: 'downtime_declared',
            actorUserId,
            identifierSnapshot: unit.identifier,
            payload: {
              downtimeId,
              reason: validated.data.reason,
              startsAt: validated.data.startsAt.toISOString(),
              endsAt: toJsonDate(endsAt),
              note,
            },
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
      excludeReservationItemIds: validated.data.excludeReservationItemIds,
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
          event: {
            storeId: store.id,
            type: 'downtime_updated',
            actorUserId,
            identifierSnapshot: downtime.unitIdentifier,
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
      excludeReservationItemIds: validated.data.excludeReservationItemIds,
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
          event: {
            storeId: store.id,
            type: 'downtime_closed',
            actorUserId,
            identifierSnapshot: downtime.unitIdentifier,
            payload: {
              downtimeId: downtime.id,
              endsAt: endsAt.toISOString(),
            },
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
          event: {
            storeId: store.id,
            type: 'downtime_deleted',
            actorUserId,
            identifierSnapshot: downtime.unitIdentifier,
            payload: {
              downtimeId: downtime.id,
              reason: downtime.reason,
              startsAt: downtime.startsAt.toISOString(),
              endsAt: toJsonDate(downtime.endsAt),
              note: downtime.note,
            },
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
      await updateUnits(tx, [
        {
          unitId: unit.id,
          values: {
            lifecycleStatus: 'retired',
            retiredAt: now,
            retirementReason: validated.data.reason,
            retirementNote: note,
          },
          event: {
            storeId: store.id,
            type: 'retired',
            actorUserId,
            identifierSnapshot: unit.identifier,
            payload: {
              reason: validated.data.reason,
              note,
              retiredAt: now.toISOString(),
            },
          },
        },
      ]);
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
      await updateUnits(tx, [
        {
          unitId: unit.id,
          values: {
            lifecycleStatus: 'active',
            retiredAt: null,
            retirementReason: null,
            retirementNote: null,
          },
          event: {
            storeId: store.id,
            type: 'reinstated',
            actorUserId,
            identifierSnapshot: unit.identifier,
            payload: {
              previous: {
                retiredAt: toJsonDate(unit.retiredAt),
                retirementReason: unit.retirementReason,
                retirementNote: unit.retirementNote,
              },
            },
          },
        },
      ]);
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
      await updateUnits(tx, [
        {
          unitId: unit.id,
          values: updates,
          event: {
            storeId: store.id,
            type: 'updated',
            actorUserId,
            identifierSnapshot: unit.identifier,
            payload: { changes },
          },
        },
      ]);
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
): Promise<{
  success?: boolean;
  error?: string;
  bufferConflict?: boolean;
  failedUnitIds?: string[];
}> {
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

  const actorUserId = await getActorUserId();
  const eventPayload = {
    reservationId: item.reservationId,
    reservationItemId: item.id,
  };
  const blockingStatuses = getBlockingReservationStatuses(
    store.settings?.pendingBlocksAvailability ?? true,
  );
  const turnoverBufferMinutes = store.settings?.turnoverBufferMinutes ?? 0;

  try {
    const reassignmentResult = await db.transaction(async (tx) => {
      const [lockedReservation] = await tx
        .select({ id: reservations.id })
        .from(reservations)
        .where(
          and(eq(reservations.id, item.reservationId), eq(reservations.storeId, store.id)),
        )
        .for('update');

      if (!lockedReservation) {
        return { error: 'errors.notFound' };
      }

      const sortedLockUnitIds = [
        ...new Set([validated.data.fromUnitId, validated.data.toUnitId]),
      ].sort((a, b) => a.localeCompare(b, 'en'));

      await tx
        .select({ id: productUnits.id })
        .from(productUnits)
        .where(inArray(productUnits.id, sortedLockUnitIds))
        .orderBy(productUnits.id)
        .for('update');

      const [currentItem] = await tx
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

      if (!currentItem || !currentItem.productId) {
        return { error: 'errors.notFound' };
      }

      const units = await tx
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
            inArray(productUnits.id, sortedLockUnitIds),
            eq(products.storeId, store.id),
          ),
        );

      const fromUnit = units.find(
        (unit) => unit.id === validated.data.fromUnitId,
      );
      const toUnit = units.find((unit) => unit.id === validated.data.toUnitId);

      if (!fromUnit || !toUnit) {
        return {
          error: 'errors.invalidUnits',
          failedUnitIds: !toUnit ? [validated.data.toUnitId] : undefined,
        };
      }

      if (
        fromUnit.productId !== currentItem.productId ||
        toUnit.productId !== currentItem.productId
      ) {
        return {
          error: 'errors.unitProductMismatch',
          failedUnitIds: [toUnit.id],
        };
      }

      if (toUnit.lifecycleStatus !== 'active') {
        return { error: 'errors.invalidUnits', failedUnitIds: [toUnit.id] };
      }

      const fromCombinationKey =
        fromUnit.combinationKey || DEFAULT_COMBINATION_KEY;
      const toCombinationKey = toUnit.combinationKey || DEFAULT_COMBINATION_KEY;
      const itemCombinationKey =
        currentItem.combinationKey || DEFAULT_COMBINATION_KEY;

      if (
        fromCombinationKey !== toCombinationKey ||
        toCombinationKey !== itemCombinationKey
      ) {
        return {
          error: 'errors.unitCombinationMismatch',
          failedUnitIds: [toUnit.id],
        };
      }

      const [existingAssignment] = await tx
        .select({ id: reservationItemUnits.id })
        .from(reservationItemUnits)
        .where(
          and(
            eq(reservationItemUnits.reservationItemId, currentItem.id),
            eq(reservationItemUnits.productUnitId, fromUnit.id),
          ),
        )
        .limit(1);

      if (!existingAssignment) {
        return { error: 'errors.notFound' };
      }

      const [duplicateAssignment] = await tx
        .select({ id: reservationItemUnits.id })
        .from(reservationItemUnits)
        .where(
          and(
            eq(reservationItemUnits.reservationItemId, currentItem.id),
            eq(reservationItemUnits.productUnitId, toUnit.id),
          ),
        )
        .limit(1);

      if (duplicateAssignment) {
        return { error: 'errors.invalidUnits', failedUnitIds: [toUnit.id] };
      }

      const [siblingAssignment] = await tx
        .select({ id: reservationItemUnits.id })
        .from(reservationItemUnits)
        .innerJoin(
          reservationItems,
          eq(reservationItemUnits.reservationItemId, reservationItems.id),
        )
        .where(
          and(
            eq(reservationItems.reservationId, currentItem.reservationId),
            not(eq(reservationItemUnits.reservationItemId, currentItem.id)),
            eq(reservationItemUnits.productUnitId, toUnit.id),
          ),
        )
        .limit(1);

      if (siblingAssignment) {
        return { error: 'errors.invalidUnits', failedUnitIds: [toUnit.id] };
      }

      const rentableUnits = await tx
        .select({ id: productUnits.id })
        .from(productUnits)
        .where(
          and(
            eq(productUnits.id, toUnit.id),
            buildUnitRentableDuringPredicate(
              tx,
              currentItem.startDate,
              currentItem.endDate,
            ),
          ),
        );
      if (rentableUnits.length === 0) {
        return { error: 'errors.invalidUnits', failedUnitIds: [toUnit.id] };
      }

      const busyUnitIds = await findBusyUnitIds(tx, {
        unitIds: [toUnit.id],
        start: currentItem.startDate,
        end: currentItem.endDate,
        blockingStatuses,
        turnoverBufferMinutes,
        excludeReservationItemId: currentItem.id,
      });
      const busyReason = busyUnitIds.get(toUnit.id);
      if (busyReason === 'overlap') {
        return { error: 'errors.invalidUnits', failedUnitIds: [toUnit.id] };
      }
      if (busyReason === 'buffer' && !validated.data.overrideTurnoverBuffer) {
        return {
          error: 'errors.turnoverBufferConflict',
          bufferConflict: true,
          failedUnitIds: [toUnit.id],
        };
      }

      await tx
        .delete(reservationItemUnits)
        .where(eq(reservationItemUnits.id, existingAssignment.id));

      await tx.insert(reservationItemUnits).values({
        id: nanoid(),
        reservationItemId: currentItem.id,
        productUnitId: toUnit.id,
        identifierSnapshot: toUnit.identifier,
        assignedAt: new Date(),
      });

      await tx.insert(productUnitEvents).values([
        buildUnitEvent({
          productUnitId: fromUnit.id,
          event: {
            storeId: store.id,
            type: 'unassigned',
            actorUserId,
            identifierSnapshot: fromUnit.identifier,
            payload: eventPayload,
          },
        }),
        buildUnitEvent({
          productUnitId: toUnit.id,
          event: {
            storeId: store.id,
            type: 'assigned',
            actorUserId,
            identifierSnapshot: toUnit.identifier,
            payload: eventPayload,
          },
        }),
      ]);

      return {
        success: true,
        fromIdentifier: fromUnit.identifier,
        toIdentifier: toUnit.identifier,
      };
    });

    if ('error' in reassignmentResult && reassignmentResult.error) {
      return reassignmentResult;
    }

    await logReservationActivity(item.reservationId, 'modified', {
      action: 'unit_reassigned',
      reservationItemId: item.id,
      unitIdentifiers: {
        from: reassignmentResult.fromIdentifier,
        to: reassignmentResult.toIdentifier,
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
