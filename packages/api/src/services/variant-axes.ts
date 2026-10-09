import {
  type Database,
  type Transaction,
  productUnits,
  products,
  reservationItems,
} from "@louez/db";
import type { BookingAttributeAxis, UnitAttributes } from "@louez/types";
import { buildCombinationKey, findMatchingVariant } from "@louez/utils";
import { and, eq, inArray, isNotNull } from "drizzle-orm";

type Executor = Database | Transaction;

/** The catalog entry an axis is compared with: its canonical key and label. */
export interface VariantAxisRef {
  key: string;
  label?: string;
}

export interface CombinationKeySyncResult {
  unitsRekeyed: number;
  reservationItemsRekeyed: number;
}

export interface RemoveVariantResult extends CombinationKeySyncResult {
  /** Products whose booking axes or unit values lost the variant. */
  productIds: string[];
  unitsStripped: number;
}

const matchesVariant = (key: string, variant: VariantAxisRef): boolean =>
  findMatchingVariant(key, [variant]) !== undefined;

/**
 * The product axes without the one matching the variant, renumbered from 0.
 * Null when the product does not use the variant, so callers can skip it.
 */
export const removeMatchingAxis = (
  axes: readonly BookingAttributeAxis[] | null | undefined,
  variant: VariantAxisRef,
): BookingAttributeAxis[] | null => {
  const current = axes ?? [];
  const remaining = current.filter((axis) => !matchesVariant(axis.key, variant));
  if (remaining.length === current.length) return null;

  return [...remaining]
    .sort((left, right) => left.position - right.position)
    .map((axis, index) => ({ ...axis, position: index }));
};

/**
 * The attribute key the units use for the variant, e.g. `taille` on a store
 * whose Size preset was adopted under its French label. Null when no unit
 * carries a value for it.
 */
/**
 * The unit attributes without the keys matching the variant. Null when the
 * unit carries no value for it.
 */
export const stripMatchingAttributes = (
  attributes: UnitAttributes | null | undefined,
  variant: VariantAxisRef,
): UnitAttributes | null => {
  const entries = Object.entries(attributes ?? {});
  const remaining = entries.filter(([key]) => !matchesVariant(key, variant));
  if (remaining.length === entries.length) return null;
  return Object.fromEntries(remaining);
};

/**
 * The products that use the variant: those declaring it as a booking axis,
 * and those whose units carry a value for it without declaring it (the
 * storefront infers axes from unit values when a product declares none).
 * Exactly what a withdrawal touches, so previews, backups and counts agree.
 */
export const selectProductsUsingVariant = <T extends { id: string }>(
  productRows: ReadonlyArray<T & { axes: readonly BookingAttributeAxis[] | null }>,
  unitRows: ReadonlyArray<{ productId: string; attributes: UnitAttributes | null | undefined }>,
  variant: VariantAxisRef,
): T[] => {
  const withValues = new Set(
    unitRows
      .filter((unit) => stripMatchingAttributes(unit.attributes, variant) !== null)
      .map((unit) => unit.productId),
  );
  return productRows.filter(
    (row) => removeMatchingAxis(row.axes, variant) !== null || withValues.has(row.id),
  );
};

/** The products of a store that still use the variant, by axis or by unit values. */
export const findProductsUsingVariant = async (
  executor: Executor,
  input: { storeId: string; variant: VariantAxisRef },
): Promise<{ id: string; name: string }[]> => {
  const rows = await executor
    .select({ id: products.id, name: products.name, axes: products.bookingAttributeAxes })
    .from(products)
    .where(eq(products.storeId, input.storeId));
  const units =
    rows.length > 0
      ? await executor
          .select({ productId: productUnits.productId, attributes: productUnits.attributes })
          .from(productUnits)
          .where(
            and(
              inArray(
                productUnits.productId,
                rows.map((row) => row.id),
              ),
              isNotNull(productUnits.attributes),
            ),
          )
      : [];
  return selectProductsUsingVariant(rows, units, input.variant).map((row) => ({
    id: row.id,
    name: row.name,
  }));
};

/**
 * Rows grouped by the key they should now carry, skipping those already
 * correct, so each distinct key costs one UPDATE.
 */
export const groupIdsByNextCombinationKey = (
  axes: readonly BookingAttributeAxis[],
  rows: ReadonlyArray<{
    id: string;
    combinationKey: string | null;
    attributes: UnitAttributes | null | undefined;
  }>,
): Map<string, string[]> => {
  const idsByKey = new Map<string, string[]>();
  for (const row of rows) {
    const nextKey = buildCombinationKey([...axes], row.attributes);
    if (nextKey === row.combinationKey) continue;
    const ids = idsByKey.get(nextKey) ?? [];
    ids.push(row.id);
    idsByKey.set(nextKey, ids);
  }
  return idsByKey;
};

/**
 * Recompute the combination key of every unit and every booked line of a
 * product from the given axes. Units derive it from their attributes,
 * reservation items from the attributes chosen at booking time; lines that
 * never had a key (legacy, custom items) are left alone. Run this whenever
 * a product's booking axes change, otherwise stock stays split along axes
 * the product no longer has and unit assignment keeps filtering on them.
 */
export const syncProductCombinationKeys = async (
  executor: Executor,
  input: { productId: string; axes: readonly BookingAttributeAxis[] },
): Promise<CombinationKeySyncResult> => {
  const units = await executor
    .select({
      id: productUnits.id,
      combinationKey: productUnits.combinationKey,
      attributes: productUnits.attributes,
    })
    .from(productUnits)
    .where(eq(productUnits.productId, input.productId));

  let unitsRekeyed = 0;
  for (const [combinationKey, ids] of groupIdsByNextCombinationKey(input.axes, units)) {
    await executor
      .update(productUnits)
      .set({ combinationKey, updatedAt: new Date() })
      .where(inArray(productUnits.id, ids));
    unitsRekeyed += ids.length;
  }

  const items = await executor
    .select({
      id: reservationItems.id,
      combinationKey: reservationItems.combinationKey,
      attributes: reservationItems.selectedAttributes,
    })
    .from(reservationItems)
    .where(
      and(
        eq(reservationItems.productId, input.productId),
        isNotNull(reservationItems.combinationKey),
      ),
    );

  let reservationItemsRekeyed = 0;
  for (const [combinationKey, ids] of groupIdsByNextCombinationKey(input.axes, items)) {
    await executor
      .update(reservationItems)
      .set({ combinationKey })
      .where(inArray(reservationItems.id, ids));
    reservationItemsRekeyed += ids.length;
  }

  return { unitsRekeyed, reservationItemsRekeyed };
};

/**
 * Withdraw a variant from a whole store: drop the matching axis from every
 * product that declares it, clear the matching value from units, and re-key
 * units and booked lines, so the storefront, availability and unit
 * assignment all forget about it at once. Unit values go too: the storefront
 * infers axes from unit values when a product declares none, so leftovers
 * would bring the variant back. Same result as removing the axis in each
 * product form, done in one go.
 */
export const removeVariantFromStoreProducts = async (
  executor: Executor,
  input: { storeId: string; variant: VariantAxisRef },
): Promise<RemoveVariantResult> => {
  // Row locks: two toggles on the same store derive the next axes from the
  // same row, and the second must read what the first wrote.
  const rows = await executor
    .select({ id: products.id, bookingAttributeAxes: products.bookingAttributeAxes })
    .from(products)
    .where(eq(products.storeId, input.storeId))
    .for("update");

  const result: RemoveVariantResult = {
    productIds: [],
    unitsStripped: 0,
    unitsRekeyed: 0,
    reservationItemsRekeyed: 0,
  };
  const touchedProductIds = new Set<string>();

  if (rows.length > 0) {
    const units = await executor
      .select({
        id: productUnits.id,
        productId: productUnits.productId,
        attributes: productUnits.attributes,
      })
      .from(productUnits)
      .where(
        inArray(
          productUnits.productId,
          rows.map((row) => row.id),
        ),
      );

    for (const unit of units) {
      const attributes = stripMatchingAttributes(unit.attributes, input.variant);
      if (!attributes) continue;
      await executor
        .update(productUnits)
        .set({ attributes, updatedAt: new Date() })
        .where(eq(productUnits.id, unit.id));
      result.unitsStripped += 1;
      touchedProductIds.add(unit.productId);
    }
  }

  for (const row of rows) {
    const axes = removeMatchingAxis(row.bookingAttributeAxes, input.variant);
    if (!axes) continue;

    await executor
      .update(products)
      .set({ bookingAttributeAxes: axes.length > 0 ? axes : null, updatedAt: new Date() })
      .where(eq(products.id, row.id));

    const synced = await syncProductCombinationKeys(executor, { productId: row.id, axes });
    touchedProductIds.add(row.id);
    result.unitsRekeyed += synced.unitsRekeyed;
    result.reservationItemsRekeyed += synced.reservationItemsRekeyed;
  }

  result.productIds = rows.map((row) => row.id).filter((id) => touchedProductIds.has(id));
  return result;
};
