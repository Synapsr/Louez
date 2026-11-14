import {
  db,
  inspections,
  productUnitDowntimes,
  productUnitEvents,
  productUnits,
  products,
  reservationItemUnits,
  reservationItems,
  reservations,
  retryOnceOnDeadlock,
  type Transaction,
} from "@louez/db";
import type { BookingAttributeAxis } from "@louez/types";
import { buildCombinationKey } from "@louez/utils";
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { z } from "zod";

import {
  productUnitErrors,
  type closeDowntimeInput,
  type declareDowntimeInput,
  type retireUnitInput,
  type updateDowntimeInput,
  type updateUnitDetailsInput,
} from "../contracts/product-units";
import { readAfterCommit } from "../platform/errors";
import { getProductUnitHistory } from "./product-unit-history";
import {
  emit,
  eventStore,
  lockStoreProducts,
  type ConfirmStep,
  type ProductActor,
} from "./products";
import { getUnitConflicts, type UnitConflict } from "./unit-conflicts";
import { buildUnitEvent, updateUnits } from "./unit-mutations";
import { raiseConfirmation, type ConfirmationRefusal } from "../platform/confirmation";

/**
 * A product's units: downtimes, retirement, reinstatement and their details,
 * moved from the dashboard's server actions. A downtime or a retirement takes
 * the unit out of availability, so each write locks in the codebase's order
 * (the store's product lock, the product, then the unit) before its first
 * plain read: the reservations it reports, and asks a confirmation about,
 * are those committed before the locks. Checkout locks the product before it
 * books, so a booking either lands before and is reported, or waits and then
 * sees the downtime.
 */

type DeclareDowntimeInput = z.infer<typeof declareDowntimeInput>;
type UpdateDowntimeInput = z.infer<typeof updateDowntimeInput>;
type CloseDowntimeInput = z.infer<typeof closeDowntimeInput>;
type RetireUnitInput = z.infer<typeof retireUnitInput>;
type UpdateUnitDetailsInput = z.infer<typeof updateUnitDetailsInput>;

interface UnitRef {
  id: string;
  productId: string;
}

/** What a preview names: the unit, its product, the window, and every reservation that holds it then. */
export interface UnitAvailabilityPreview {
  unit: { id: string; identifier: string };
  product: { id: string; name: string };
  /** The downtime's window once merged with what is stored; a retirement's starts now. */
  window: { start: Date; end: Date | null };
  conflicts: UnitConflict[];
  summary: string;
}

export interface DowntimeDeletionPreview {
  unit: { id: string; identifier: string };
  product: { id: string; name: string };
  downtime: {
    id: string;
    reason: string;
    startsAt: Date;
    endsAt: Date | null;
    note: string | null;
  };
  summary: string;
}

const normalizeNullableText = (value: string | null | undefined) => value?.trim() || null;
const normalizeMoney = (value: string | null | undefined) =>
  value?.trim().replace(",", ".") || null;
const toJsonDate = (value: Date | null) => (value ? value.toISOString() : null);

function conflictSettings(actor: ProductActor) {
  return {
    storeId: actor.storeId,
    pendingBlocksAvailability: actor.store.settings?.pendingBlocksAvailability,
    turnoverBufferMinutes: actor.store.settings?.turnoverBufferMinutes ?? 0,
  };
}

function describeWindow(start: Date, end: Date | null) {
  return end
    ? `from ${start.toISOString()} to ${end.toISOString()}`
    : `from ${start.toISOString()} until it is closed`;
}

/** Counts the bookings only: the preview's details name them, as far as the caller may see them. */
function describeConflicts(conflicts: UnitConflict[]) {
  if (conflicts.length === 0) return "";
  const count = new Set(conflicts.map((conflict) => conflict.reservationId)).size;
  return ` ${count} reservation(s) hold it then: they keep this unit until you move them to another one.`;
}

/** Where a unit is: its product never changes, so this read may come before the locks. */
async function findUnit(storeId: string, unitId: string): Promise<UnitRef> {
  const [row] = await db
    .select({ id: productUnits.id, productId: productUnits.productId })
    .from(productUnits)
    .innerJoin(products, eq(productUnits.productId, products.id))
    .where(and(eq(productUnits.id, unitId), eq(products.storeId, storeId)))
    .limit(1);
  if (!row) throw productUnitErrors.unitNotFound(unitId);
  return row;
}

async function findDowntime(storeId: string, downtimeId: string) {
  const [row] = await db
    .select({
      id: productUnitDowntimes.id,
      unitId: productUnitDowntimes.productUnitId,
      productId: productUnits.productId,
    })
    .from(productUnitDowntimes)
    .innerJoin(productUnits, eq(productUnitDowntimes.productUnitId, productUnits.id))
    .innerJoin(products, eq(productUnits.productId, products.id))
    .where(and(eq(productUnitDowntimes.id, downtimeId), eq(products.storeId, storeId)))
    .limit(1);
  if (!row) throw productUnitErrors.downtimeNotFound(downtimeId);
  return row;
}

/**
 * The store's product lock, the product, then the unit, as locking reads:
 * nothing of the transaction has read before them.
 */
async function lockUnit(tx: Transaction, storeId: string, ref: UnitRef) {
  await lockStoreProducts(tx, storeId);
  const [product] = await tx
    .select({
      id: products.id,
      name: products.name,
      bookingAttributeAxes: products.bookingAttributeAxes,
    })
    .from(products)
    .where(and(eq(products.id, ref.productId), eq(products.storeId, storeId)))
    .for("update");
  if (!product) throw productUnitErrors.unitNotFound(ref.id);
  const [unit] = await tx
    .select({
      id: productUnits.id,
      identifier: productUnits.identifier,
      notes: productUnits.notes,
      attributes: productUnits.attributes,
      lifecycleStatus: productUnits.lifecycleStatus,
      retiredAt: productUnits.retiredAt,
      retirementReason: productUnits.retirementReason,
      retirementNote: productUnits.retirementNote,
      purchasePrice: productUnits.purchasePrice,
      purchasedAt: productUnits.purchasedAt,
    })
    .from(productUnits)
    .where(and(eq(productUnits.id, ref.id), eq(productUnits.productId, ref.productId)))
    .for("update");
  if (!unit) throw productUnitErrors.unitNotFound(ref.id);
  return { product, unit };
}

async function lockDowntime(tx: Transaction, storeId: string, downtimeId: string) {
  const [downtime] = await tx
    .select({
      id: productUnitDowntimes.id,
      reason: productUnitDowntimes.reason,
      startsAt: productUnitDowntimes.startsAt,
      endsAt: productUnitDowntimes.endsAt,
      note: productUnitDowntimes.note,
    })
    .from(productUnitDowntimes)
    .where(and(eq(productUnitDowntimes.id, downtimeId), eq(productUnitDowntimes.storeId, storeId)))
    .for("update");
  if (!downtime) throw productUnitErrors.downtimeNotFound(downtimeId);
  return downtime;
}

/**
 * The lines a downtime may leave out of its conflicts: those that hold the
 * unit, of reservations of the store whose return inspection is done, so the
 * unit is back (the return flow declares a repair right after). Any other
 * line is refused.
 */
async function checkedExclusions(
  tx: Transaction,
  storeId: string,
  unitId: string,
  ids: readonly string[] | undefined,
) {
  const wanted = [...new Set(ids ?? [])];
  if (wanted.length === 0) return new Set<string>();
  const rows = await tx
    .selectDistinct({ id: reservationItems.id })
    .from(reservationItems)
    .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
    .innerJoin(
      reservationItemUnits,
      eq(reservationItemUnits.reservationItemId, reservationItems.id),
    )
    .innerJoin(
      inspections,
      and(
        eq(inspections.reservationId, reservations.id),
        eq(inspections.storeId, storeId),
        eq(inspections.type, "return"),
        inArray(inspections.status, ["completed", "signed"]),
      ),
    )
    .where(
      and(
        inArray(reservationItems.id, wanted),
        eq(reservations.storeId, storeId),
        eq(reservationItemUnits.productUnitId, unitId),
      ),
    );
  const valid = new Set(rows.map((row) => row.id));
  const invalid = wanted.filter((id) => !valid.has(id));
  if (invalid.length > 0) throw productUnitErrors.exclusionInvalid(invalid);
  return valid;
}

const unitChanged = (actor: ProductActor, productId: string) =>
  emit(actor, { type: "product.units.changed", store: eventStore(actor), productId });

// --- History -----------------------------------------------------------------

export async function getUnitHistory(storeId: string, unitId: string) {
  const history = await getProductUnitHistory({ storeId, unitId });
  if (!history) throw productUnitErrors.unitNotFound(unitId);
  return history;
}

// --- Downtimes -----------------------------------------------------------------

/**
 * Takes a unit out of availability over a window. Reservations that hold the
 * unit then keep it and are returned, with the units that could serve them
 * instead. `confirm` is asked when there are any.
 */
export async function declareDowntime(
  actor: ProductActor,
  input: DeclareDowntimeInput,
  options: { confirm?: ConfirmStep<UnitAvailabilityPreview> } = {},
) {
  const { storeId } = actor;
  const endsAt = input.endsAt ?? null;
  if (endsAt && input.startsAt >= endsAt) throw productUnitErrors.downtimeDates();
  const note = normalizeNullableText(input.note);
  const ref = await findUnit(storeId, input.unitId);
  let refusal: ConfirmationRefusal | null = null;
  let result: { downtimeId: string; conflicts: UnitConflict[] } = { downtimeId: "", conflicts: [] };

  await retryOnceOnDeadlock(() =>
    db.transaction(async (tx) => {
      refusal = null;
      const { product, unit } = await lockUnit(tx, storeId, ref);
      const excluded = await checkedExclusions(
        tx,
        storeId,
        unit.id,
        input.excludeReservationItemIds,
      );
      // The confirmation names every booking; exclusions only trim the list returned.
      const conflicts = await getUnitConflicts(
        unit.id,
        { start: input.startsAt, end: endsAt },
        { ...conflictSettings(actor), executor: tx },
      );
      if (options.confirm && conflicts.length > 0) {
        refusal = await options.confirm(
          {
            unit: { id: unit.id, identifier: unit.identifier },
            product: { id: product.id, name: product.name },
            window: { start: input.startsAt, end: endsAt },
            conflicts,
            summary:
              `Take the unit "${unit.identifier}" of "${product.name}" out of service ${describeWindow(input.startsAt, endsAt)}.` +
              describeConflicts(conflicts),
          },
          tx,
        );
        if (refusal) return;
      }

      const downtimeId = nanoid();
      await tx.insert(productUnitDowntimes).values({
        id: downtimeId,
        productUnitId: unit.id,
        storeId,
        reason: input.reason,
        startsAt: input.startsAt,
        endsAt,
        note,
        createdByUserId: actor.userId,
      });
      await tx.insert(productUnitEvents).values(
        buildUnitEvent({
          productUnitId: unit.id,
          event: {
            storeId,
            type: "downtime_declared",
            actorUserId: actor.userId,
            identifierSnapshot: unit.identifier,
            payload: {
              downtimeId,
              reason: input.reason,
              startsAt: input.startsAt.toISOString(),
              endsAt: toJsonDate(endsAt),
              note,
            },
          },
        }),
      );
      result = {
        downtimeId,
        conflicts: conflicts.filter((conflict) => !excluded.has(conflict.reservationItemId)),
      };
    }),
  );

  if (refusal) return raiseConfirmation(refusal);
  unitChanged(actor, ref.productId);
  return result;
}

/**
 * Changes a downtime: a field left out is unchanged. Reservations that hold
 * the unit over the new window are returned; `confirm` is asked when there
 * are any.
 */
export async function updateDowntime(
  actor: ProductActor,
  input: UpdateDowntimeInput,
  options: { confirm?: ConfirmStep<UnitAvailabilityPreview> } = {},
) {
  const { storeId } = actor;
  const ref = await findDowntime(storeId, input.downtimeId);
  let refusal: ConfirmationRefusal | null = null;
  let conflictsFound: UnitConflict[] = [];

  await retryOnceOnDeadlock(() =>
    db.transaction(async (tx) => {
      refusal = null;
      const { product, unit } = await lockUnit(tx, storeId, {
        id: ref.unitId,
        productId: ref.productId,
      });
      const downtime = await lockDowntime(tx, storeId, ref.id);

      const startsAt = input.startsAt ?? downtime.startsAt;
      const endsAt = input.endsAt === undefined ? downtime.endsAt : input.endsAt;
      if (endsAt && startsAt >= endsAt) throw productUnitErrors.downtimeDates();
      const reason = input.reason ?? downtime.reason;
      const note = input.note === undefined ? downtime.note : normalizeNullableText(input.note);

      const excluded = await checkedExclusions(
        tx,
        storeId,
        unit.id,
        input.excludeReservationItemIds,
      );
      const conflicts = await getUnitConflicts(
        unit.id,
        { start: startsAt, end: endsAt },
        { ...conflictSettings(actor), executor: tx },
      );
      if (options.confirm && conflicts.length > 0) {
        refusal = await options.confirm(
          {
            unit: { id: unit.id, identifier: unit.identifier },
            product: { id: product.id, name: product.name },
            window: { start: startsAt, end: endsAt },
            conflicts,
            summary:
              `Keep the unit "${unit.identifier}" of "${product.name}" out of service ${describeWindow(startsAt, endsAt)}.` +
              describeConflicts(conflicts),
          },
          tx,
        );
        if (refusal) return;
      }

      await tx
        .update(productUnitDowntimes)
        .set({ reason, startsAt, endsAt, note, updatedAt: new Date() })
        .where(eq(productUnitDowntimes.id, downtime.id));
      await tx.insert(productUnitEvents).values(
        buildUnitEvent({
          productUnitId: unit.id,
          event: {
            storeId,
            type: "downtime_updated",
            actorUserId: actor.userId,
            identifierSnapshot: unit.identifier,
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
      conflictsFound = conflicts.filter((conflict) => !excluded.has(conflict.reservationItemId));
    }),
  );

  if (refusal) return raiseConfirmation(refusal);
  unitChanged(actor, ref.productId);
  return { downtimeId: ref.id, conflicts: conflictsFound };
}

/**
 * Ends a downtime at `endsAt`, now by default: the unit is back in service
 * from then. Closing only ends it earlier: a later end, which could overlap
 * bookings, goes through `updateDowntime` and its checks.
 */
export async function closeDowntime(actor: ProductActor, input: CloseDowntimeInput) {
  const { storeId } = actor;
  const endsAt = input.endsAt ?? new Date();
  const ref = await findDowntime(storeId, input.downtimeId);

  await retryOnceOnDeadlock(() =>
    db.transaction(async (tx) => {
      const { unit } = await lockUnit(tx, storeId, { id: ref.unitId, productId: ref.productId });
      const downtime = await lockDowntime(tx, storeId, ref.id);
      if (downtime.startsAt >= endsAt) throw productUnitErrors.downtimeDates();
      if (downtime.endsAt && endsAt > downtime.endsAt) {
        throw productUnitErrors.closeExtends({ id: downtime.id, endsAt: downtime.endsAt });
      }

      await tx
        .update(productUnitDowntimes)
        .set({ endsAt, updatedAt: new Date() })
        .where(eq(productUnitDowntimes.id, downtime.id));
      await tx.insert(productUnitEvents).values(
        buildUnitEvent({
          productUnitId: unit.id,
          event: {
            storeId,
            type: "downtime_closed",
            actorUserId: actor.userId,
            identifierSnapshot: unit.identifier,
            payload: { downtimeId: downtime.id, endsAt: endsAt.toISOString() },
          },
        }),
      );
    }),
  );

  unitChanged(actor, ref.productId);
  return { downtimeId: ref.id, endsAt };
}

/**
 * Removes a downtime, as if it never was: the unit is available on its days
 * again. The unit's history keeps a "downtime deleted" event with what it
 * held. `confirm` receives the downtime, under the lock.
 */
export async function deleteDowntime(
  actor: ProductActor,
  downtimeId: string,
  options: { confirm?: ConfirmStep<DowntimeDeletionPreview> } = {},
) {
  const { storeId } = actor;
  const ref = await findDowntime(storeId, downtimeId);
  let refusal: ConfirmationRefusal | null = null;

  await retryOnceOnDeadlock(() =>
    db.transaction(async (tx) => {
      refusal = null;
      const { product, unit } = await lockUnit(tx, storeId, {
        id: ref.unitId,
        productId: ref.productId,
      });
      const downtime = await lockDowntime(tx, storeId, ref.id);
      if (options.confirm) {
        refusal = await options.confirm(
          {
            unit: { id: unit.id, identifier: unit.identifier },
            product: { id: product.id, name: product.name },
            downtime,
            summary: `Delete the ${downtime.reason} downtime of the unit "${unit.identifier}" of "${product.name}" (${describeWindow(downtime.startsAt, downtime.endsAt)}): the unit becomes available on those days again.`,
          },
          tx,
        );
        if (refusal) return;
      }

      await tx.insert(productUnitEvents).values(
        buildUnitEvent({
          productUnitId: unit.id,
          event: {
            storeId,
            type: "downtime_deleted",
            actorUserId: actor.userId,
            identifierSnapshot: unit.identifier,
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
      await tx.delete(productUnitDowntimes).where(eq(productUnitDowntimes.id, downtime.id));
    }),
  );

  if (refusal) return raiseConfirmation(refusal);
  unitChanged(actor, ref.productId);
  return { downtimeId: ref.id };
}

// --- Retirement and details ------------------------------------------------------

/**
 * Retires a unit for good (sold, lost, broken): it leaves availability from
 * now on. Current and future reservations that hold it keep it and are
 * returned, with the units that could serve them instead. `confirm` is asked
 * every time: a retirement always takes a unit out.
 */
export async function retireUnit(
  actor: ProductActor,
  input: RetireUnitInput,
  options: { confirm?: ConfirmStep<UnitAvailabilityPreview> } = {},
) {
  const { storeId } = actor;
  const note = normalizeNullableText(input.note);
  const ref = await findUnit(storeId, input.unitId);
  let refusal: ConfirmationRefusal | null = null;
  let conflictsFound: UnitConflict[] = [];

  await retryOnceOnDeadlock(() =>
    db.transaction(async (tx) => {
      refusal = null;
      const { product, unit } = await lockUnit(tx, storeId, ref);
      if (unit.lifecycleStatus === "retired") throw productUnitErrors.alreadyRetired(unit.id);
      const now = new Date();
      const conflicts = await getUnitConflicts(
        unit.id,
        { start: now, end: null },
        { ...conflictSettings(actor), executor: tx },
      );
      if (options.confirm) {
        refusal = await options.confirm(
          {
            unit: { id: unit.id, identifier: unit.identifier },
            product: { id: product.id, name: product.name },
            window: { start: now, end: null },
            conflicts,
            summary:
              `Retire the unit "${unit.identifier}" of "${product.name}" (${input.reason}): it leaves the stock from now on.` +
              describeConflicts(conflicts),
          },
          tx,
        );
        if (refusal) return;
      }

      await updateUnits(tx, [
        {
          unitId: unit.id,
          values: {
            lifecycleStatus: "retired",
            retiredAt: now,
            retirementReason: input.reason,
            retirementNote: note,
          },
          event: {
            storeId,
            type: "retired",
            actorUserId: actor.userId,
            identifierSnapshot: unit.identifier,
            payload: { reason: input.reason, note, retiredAt: now.toISOString() },
          },
        },
      ]);
      conflictsFound = conflicts;
    }),
  );

  if (refusal) return raiseConfirmation(refusal);
  unitChanged(actor, ref.productId);
  return { unitId: ref.id, conflicts: conflictsFound };
}

/** Puts a retired unit back in service, keyed on the product's current variants. */
export async function reinstateUnit(actor: ProductActor, unitId: string) {
  const { storeId } = actor;
  const ref = await findUnit(storeId, unitId);

  await retryOnceOnDeadlock(() =>
    db.transaction(async (tx) => {
      const { product, unit } = await lockUnit(tx, storeId, ref);
      if (unit.lifecycleStatus !== "retired") throw productUnitErrors.notRetired(unit.id);
      await updateUnits(tx, [
        {
          unitId: unit.id,
          values: {
            lifecycleStatus: "active",
            retiredAt: null,
            retirementReason: null,
            retirementNote: null,
            // The product's axes may have changed while the unit was retired.
            combinationKey: buildCombinationKey(
              (product.bookingAttributeAxes ?? []) as BookingAttributeAxis[],
              unit.attributes,
            ),
          },
          event: {
            storeId,
            type: "reinstated",
            actorUserId: actor.userId,
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
    }),
  );

  unitChanged(actor, ref.productId);
  return { unitId: ref.id };
}

/** Changes a unit's notes and purchase details: a field left out is unchanged, null clears it. */
export async function updateUnitDetails(actor: ProductActor, input: UpdateUnitDetailsInput) {
  const { storeId } = actor;
  const ref = await findUnit(storeId, input.unitId);
  let changed = false;

  await retryOnceOnDeadlock(() =>
    db.transaction(async (tx) => {
      const { unit } = await lockUnit(tx, storeId, ref);
      const updates: Partial<typeof productUnits.$inferInsert> = {};
      const changes: Record<string, { from: unknown; to: unknown }> = {};

      if (input.notes !== undefined) {
        const notes = normalizeNullableText(input.notes);
        if (notes !== unit.notes) {
          updates.notes = notes;
          changes.notes = { from: unit.notes, to: notes };
        }
      }
      if (input.purchasePrice !== undefined) {
        const purchasePrice = normalizeMoney(input.purchasePrice);
        if (purchasePrice !== unit.purchasePrice) {
          updates.purchasePrice = purchasePrice;
          changes.purchasePrice = { from: unit.purchasePrice, to: purchasePrice };
        }
      }
      if (input.purchasedAt !== undefined) {
        const purchasedAt = input.purchasedAt;
        if ((unit.purchasedAt?.getTime() ?? null) !== (purchasedAt?.getTime() ?? null)) {
          updates.purchasedAt = purchasedAt;
          changes.purchasedAt = {
            from: toJsonDate(unit.purchasedAt),
            to: toJsonDate(purchasedAt),
          };
        }
      }

      changed = Object.keys(changes).length > 0;
      if (!changed) return;

      await updateUnits(tx, [
        {
          unitId: unit.id,
          values: updates,
          event: {
            storeId,
            type: "updated",
            actorUserId: actor.userId,
            identifierSnapshot: unit.identifier,
            payload: { changes },
          },
        },
      ]);
    }),
  );

  if (changed) unitChanged(actor, ref.productId);
  // Read back: the database stores the price with its two decimals.
  const details = await readAfterCommit(async () => {
    const [row] = await db
      .select({
        notes: productUnits.notes,
        purchasePrice: productUnits.purchasePrice,
        purchasedAt: productUnits.purchasedAt,
      })
      .from(productUnits)
      .where(eq(productUnits.id, ref.id));
    if (!row) throw productUnitErrors.unitNotFound(ref.id);
    return row;
  });
  return { unitId: ref.id, ...details };
}
