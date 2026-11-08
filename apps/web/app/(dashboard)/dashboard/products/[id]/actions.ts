'use server';

import { revalidatePath } from 'next/cache';

import { and, eq, inArray, not } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import {
  buildUnitRentableDuringPredicate,
  db,
  findBusyUnitIds,
  getBlockingReservationStatuses,
  productUnitEvents,
  productUnits,
  products,
  type Transaction,
  reservationActivity,
  reservationItemUnits,
  reservationItems,
  reservations,
  retryOnceOnDeadlock,
} from '@louez/db';
import {
  type ReassignReservationItemUnitInput,
  reassignReservationItemUnitSchema,
} from '@louez/validations';

import { auth } from '@/lib/auth';
import { getCurrentStore } from '@/lib/store-context';
import { buildUnitEvent } from '@louez/api/services/unit-mutations';
import {
  lockReservationProducts,
  reserveInventory,
} from '@louez/api/services/reservation-inventory';
import {
  resolveUnitAssignmentScope,
  unitMatchesAssignmentScope,
} from '@louez/api/services/unit-availability';

// Units, downtimes and the variant catalog are procedures of the products
// router (packages/api). Moving a booking to another unit stays here until
// the reservations lot that owns unit assignment.

async function getStoreForUser() {
  return getCurrentStore();
}

async function getActorUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
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

function revalidateInventoryPaths(productId?: string, reservationId?: string) {
  revalidatePath('/dashboard/products');

  if (productId) {
    revalidatePath(`/dashboard/products/${productId}`);
    revalidatePath(`/dashboard/products/${productId}/edit`);
  }

  if (reservationId) {
    revalidatePath(`/dashboard/reservations/${reservationId}`);
  }
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
      selectedAttributes: reservationItems.selectedAttributes,
      quantity: reservationItems.quantity,
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
    const reassignUnit = async (tx: Transaction) => {
      const [lockedReservation] = await tx
        .select({ id: reservations.id })
        .from(reservations)
        .where(
          and(
            eq(reservations.id, item.reservationId),
            eq(reservations.storeId, store.id),
          ),
        )
        .for('update');

      if (!lockedReservation) {
        return { error: 'errors.notFound' };
      }

      // Locks come first, as locking reads only, in the order of the other
      // reservation writers (reservation, then product, then units). The
      // first consistent read happens after them, so every validation below
      // sees what was committed before the locks were taken.
      if (item.productId) {
        await tx
          .select({ id: products.id })
          .from(products)
          .where(
            and(eq(products.id, item.productId), eq(products.storeId, store.id)),
          )
          .for('update');
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

      const lockedProductsById = item.productId
        ? await lockReservationProducts(tx, store.id, [item.productId])
        : new Map();

      const [currentItem] = await tx
        .select({
          id: reservationItems.id,
          productId: reservationItems.productId,
          combinationKey: reservationItems.combinationKey,
      selectedAttributes: reservationItems.selectedAttributes,
      quantity: reservationItems.quantity,
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
          attributes: productUnits.attributes,
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

      // The replacement must be able to serve the line: its exact combination,
      // or any unit matching what a pooled line did choose.
      const assignmentScope = currentItem.productId
        ? await resolveUnitAssignmentScope(tx, {
            productId: currentItem.productId,
            combinationKey: currentItem.combinationKey,
            selectedAttributes: currentItem.selectedAttributes,
          })
        : null;

      if (
        assignmentScope &&
        !unitMatchesAssignmentScope(assignmentScope, {
          combinationKey: toUnit.combinationKey,
          attributes: toUnit.attributes,
        })
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

      // A pooled line may move to a unit of another combination, as long as
      // that combination keeps enough stock for the lines that booked it
      // specifically. Checked under the product lock, like a checkout.
      if (assignmentScope?.combinationKey === null && currentItem.productId) {
        const heldAssignments = await tx
          .select({ productUnitId: reservationItemUnits.productUnitId })
          .from(reservationItemUnits)
          .where(eq(reservationItemUnits.reservationItemId, currentItem.id));
        const nextUnitIds = heldAssignments
          .flatMap((assignment) =>
            assignment.productUnitId && assignment.productUnitId !== fromUnit.id
              ? [assignment.productUnitId]
              : [],
          )
          .concat(toUnit.id);
        const productId = currentItem.productId;
        const checkStock = (bufferMinutes: number) =>
          reserveInventory({
            tx,
            storeId: store.id,
            lockedProductsById,
            lines: [
              {
                lineId: currentItem.id,
                productId,
                // Only the units held after the move are checked: a line
                // booked with an explicit overbooking keeps its remainder.
                quantity: nextUnitIds.length,
                selectedAttributes: currentItem.selectedAttributes ?? undefined,
                combinationKey: currentItem.combinationKey,
                assignedUnitIds: nextUnitIds,
                pooled: true,
              },
            ],
            window: { start: currentItem.startDate, end: currentItem.endDate },
            turnoverBufferMinutes: bufferMinutes,
            blockingStatuses,
            excludeReservationItemIds: [currentItem.id],
            skipConsumableCheck: true,
            skipRequiredAccessoryCheck: true,
          });
        const strictStock = await checkStock(0);
        if (!strictStock.ok) {
          return { error: 'errors.invalidUnits', failedUnitIds: [toUnit.id] };
        }
        if (!validated.data.overrideTurnoverBuffer && turnoverBufferMinutes > 0) {
          const bufferedStock = await checkStock(turnoverBufferMinutes);
          if (!bufferedStock.ok) {
            return {
              error: 'errors.turnoverBufferConflict',
              bufferConflict: true,
              failedUnitIds: [toUnit.id],
            };
          }
        }
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
    };
    const reassignmentResult = await retryOnceOnDeadlock(() =>
      db.transaction(reassignUnit),
    );

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
