import {
  db,
  productUnits,
  products,
  variantDefinitions,
  variantValues,
  type Transaction,
} from "@louez/db";
import type { BookingAttributeAxis, UnitAttributes } from "@louez/types";
import { findMatchingVariant, normalizeAxisKey } from "@louez/utils";
import { and, asc, count, eq, gt, inArray, isNotNull, ne, or, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";

import {
  VARIANT_STORE_MAX,
  VARIANT_USAGE_PRODUCTS_MAX,
  VARIANT_VALUE_MAX,
  variantErrors,
  type VariantDefinition,
  type createVariantValueInput,
  type ensureVariantDefinitionInput,
  type updateVariantValueInput,
} from "../contracts/product-variants";
import { readAfterCommit } from "../platform/errors";
import {
  emit,
  eventStore,
  lockStoreProducts,
  type ConfirmStep,
  type ProductActor,
} from "./products";
import {
  removeVariantFromStoreProducts,
  selectProductsUsingVariant,
  type VariantAxisRef,
} from "./variant-axes";
import { raiseConfirmation, type ConfirmationRefusal } from "../platform/confirmation";

/**
 * The store's variant catalog, moved from the dashboard's variants router.
 * Its writes take the store's product lock, as every product write does: a
 * deletion checks the products that use a variant, and a withdrawal changes
 * them, so neither may race a product save.
 */

type Executor = Transaction | typeof db;

export interface VariantDeletionPreview {
  definition: { id: string; key: string; label: string; valueIds: string[] };
  summary: string;
}

export interface VariantWithdrawalPreview {
  definition: { id: string; key: string; label: string };
  products: Array<{ id: string; name: string }>;
  summary: string;
}

export interface VariantValueDeletionPreview {
  value: { id: string; label: string };
  definition: { id: string; label: string };
  /** Products whose units carry the value: they keep it. */
  products: Array<{ id: string; name: string }>;
  summary: string;
}

const definitionColumns = {
  id: variantDefinitions.id,
  key: variantDefinitions.key,
  label: variantDefinitions.label,
  kind: variantDefinitions.kind,
  isActive: variantDefinitions.isActive,
  position: variantDefinitions.position,
};

const valueColumns = {
  id: variantValues.id,
  definitionId: variantValues.definitionId,
  label: variantValues.label,
  colorHex: variantValues.colorHex,
  position: variantValues.position,
};

const byName = (left: { name: string }, right: { name: string }) =>
  left.name.localeCompare(right.name);

async function withValues(
  executor: Executor,
  definitions: Array<Omit<VariantDefinition, "values">>,
): Promise<VariantDefinition[]> {
  if (definitions.length === 0) return [];
  const values = await executor
    .select(valueColumns)
    .from(variantValues)
    .where(
      inArray(
        variantValues.definitionId,
        definitions.map((definition) => definition.id),
      ),
    )
    .orderBy(asc(variantValues.position), asc(variantValues.label));
  const byDefinition = new Map<string, VariantDefinition["values"]>();
  for (const { definitionId, ...value } of values) {
    const list = byDefinition.get(definitionId) ?? [];
    list.push(value);
    byDefinition.set(definitionId, list);
  }
  return definitions.map((definition) => ({
    ...definition,
    values: byDefinition.get(definition.id) ?? [],
  }));
}

async function findDefinition(executor: Executor, storeId: string, id: string) {
  const [row] = await executor
    .select(definitionColumns)
    .from(variantDefinitions)
    .where(and(eq(variantDefinitions.id, id), eq(variantDefinitions.storeId, storeId)))
    .limit(1);
  if (!row) throw variantErrors.notFound(id);
  return row;
}

async function getDefinition(executor: Executor, storeId: string, id: string) {
  const [definition] = await withValues(executor, [await findDefinition(executor, storeId, id)]);
  return definition;
}

async function findValue(executor: Executor, storeId: string, id: string) {
  const [row] = await executor
    .select({
      ...valueColumns,
      definitionLabel: variantDefinitions.label,
      key: variantDefinitions.key,
    })
    .from(variantValues)
    .innerJoin(variantDefinitions, eq(variantDefinitions.id, variantValues.definitionId))
    .where(and(eq(variantValues.id, id), eq(variantDefinitions.storeId, storeId)))
    .limit(1);
  if (!row) throw variantErrors.valueNotFound(id);
  return row;
}

/** The store's products and their units' values, read once for every variant asked about. */
async function readStoreUsage(executor: Executor, storeId: string) {
  const rows = await executor
    .select({ id: products.id, name: products.name, axes: products.bookingAttributeAxes })
    .from(products)
    .where(eq(products.storeId, storeId));
  const units =
    rows.length > 0
      ? await executor
          .select({ productId: productUnits.productId, attributes: productUnits.attributes })
          .from(productUnits)
          .innerJoin(products, eq(productUnits.productId, products.id))
          .where(and(eq(products.storeId, storeId), isNotNull(productUnits.attributes)))
      : [];
  return {
    rows: rows as Array<{ id: string; name: string; axes: BookingAttributeAxis[] | null }>,
    units: units as Array<{ productId: string; attributes: UnitAttributes | null }>,
  };
}

function productsUsing(usage: Awaited<ReturnType<typeof readStoreUsage>>, variant: VariantAxisRef) {
  return selectProductsUsingVariant(usage.rows, usage.units, variant)
    .map((row) => ({ id: row.id, name: row.name }))
    .sort(byName);
}

/** Products whose units carry `label` for the variant (case-insensitive). */
function productsCarryingValue(
  usage: Awaited<ReturnType<typeof readStoreUsage>>,
  variant: VariantAxisRef,
  label: string,
) {
  const wanted = label.toLocaleLowerCase();
  const ids = new Set(
    usage.units
      .filter((unit) =>
        Object.entries(unit.attributes ?? {}).some(
          ([key, value]) =>
            findMatchingVariant(key, [variant]) !== undefined &&
            value.toLocaleLowerCase() === wanted,
        ),
      )
      .map((unit) => unit.productId),
  );
  return usage.rows
    .filter((row) => ids.has(row.id))
    .map((row) => ({ id: row.id, name: row.name }))
    .sort(byName);
}

// --- Reads -------------------------------------------------------------------

/** One page of the store's variants with their values, by position, then label, then id. */
export async function listVariants(
  storeId: string,
  input: { cursor?: string; limit?: number },
): Promise<{ items: VariantDefinition[]; nextCursor: string | null }> {
  const limit = input.limit ?? VARIANT_STORE_MAX;
  const conditions: SQL[] = [eq(variantDefinitions.storeId, storeId)];
  if (input.cursor) {
    const [after] = await db
      .select({ position: variantDefinitions.position, label: variantDefinitions.label })
      .from(variantDefinitions)
      .where(and(eq(variantDefinitions.id, input.cursor), eq(variantDefinitions.storeId, storeId)))
      .limit(1);
    if (!after) throw variantErrors.invalidCursor();
    conditions.push(
      or(
        gt(variantDefinitions.position, after.position),
        and(
          eq(variantDefinitions.position, after.position),
          or(
            gt(variantDefinitions.label, after.label),
            and(eq(variantDefinitions.label, after.label), gt(variantDefinitions.id, input.cursor)),
          ),
        ),
      ) as SQL,
    );
  }

  const rows = await db
    .select(definitionColumns)
    .from(variantDefinitions)
    .where(and(...conditions))
    .orderBy(
      asc(variantDefinitions.position),
      asc(variantDefinitions.label),
      asc(variantDefinitions.id),
    )
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: await withValues(db, page),
    nextCursor: rows.length > limit && last ? last.id : null,
  };
}

/** Which products use each variant, as a booking axis or through their units' values. */
export async function getVariantUsage(storeId: string, input: { definitionId?: string }) {
  const definitions = input.definitionId
    ? [await findDefinition(db, storeId, input.definitionId)]
    : await db
        .select(definitionColumns)
        .from(variantDefinitions)
        .where(eq(variantDefinitions.storeId, storeId))
        .orderBy(asc(variantDefinitions.position), asc(variantDefinitions.label));
  const usage = definitions.length > 0 ? await readStoreUsage(db, storeId) : null;
  return {
    items: definitions.map((definition) => {
      const using = usage ? productsUsing(usage, definition) : [];
      return {
        definitionId: definition.id,
        productCount: using.length,
        products: using.slice(0, VARIANT_USAGE_PRODUCTS_MAX),
      };
    }),
  };
}

// --- Variants ----------------------------------------------------------------

/**
 * Creates a variant, or returns the store's variant of the same key as is.
 * Used for custom variants and to adopt a preset (the dashboard sends the
 * localized label and its values). Values are only added to a variant that
 * has none. It never touches products: only withdrawing does.
 */
export async function ensureVariantDefinition(
  storeId: string,
  input: z.infer<typeof ensureVariantDefinitionInput>,
) {
  const key = normalizeAxisKey(input.key ?? input.label);
  if (!key) throw variantErrors.invalidKey();

  const { id, created } = await db.transaction(async (tx) => {
    await lockStoreProducts(tx, storeId);
    const [existing] = await tx
      .select({ id: variantDefinitions.id })
      .from(variantDefinitions)
      .where(and(eq(variantDefinitions.storeId, storeId), eq(variantDefinitions.key, key)))
      .limit(1);
    let definitionId = existing?.id;
    if (!definitionId) {
      const [{ maxPosition, total }] = await tx
        .select({
          maxPosition: sql<number>`COALESCE(MAX(${variantDefinitions.position}), 0)`.mapWith(
            Number,
          ),
          total: count(),
        })
        .from(variantDefinitions)
        .where(eq(variantDefinitions.storeId, storeId));
      if (total >= VARIANT_STORE_MAX) throw variantErrors.limitReached();
      const [inserted] = await tx
        .insert(variantDefinitions)
        .values({
          storeId,
          key,
          label: input.label,
          kind: input.kind,
          isActive: input.isActive,
          position: maxPosition + 1,
        })
        .$returningId();
      definitionId = inserted.id;
    }

    const [{ valueCount }] = await tx
      .select({ valueCount: count() })
      .from(variantValues)
      .where(eq(variantValues.definitionId, definitionId));
    if (valueCount === 0 && input.values.length > 0) {
      await tx
        .insert(variantValues)
        .values(
          input.values.map((value, index) => ({
            definitionId: definitionId as string,
            label: value.label,
            colorHex: value.colorHex ?? null,
            position: index,
          })),
        )
        // Two seed values equal but for case land on the unique key once.
        .onDuplicateKeyUpdate({ set: { position: sql`${variantValues.position}` } });
    }
    return { id: definitionId, created: !existing };
  });

  return { ...(await readAfterCommit(() => getDefinition(db, storeId, id))), created };
}

/** Renames a variant. Its key stays, so products keep their link to it. */
export async function updateVariantDefinition(
  storeId: string,
  input: { id: string; label: string },
) {
  await db.transaction(async (tx) => {
    await lockStoreProducts(tx, storeId);
    await findDefinition(tx, storeId, input.id);
    await tx
      .update(variantDefinitions)
      .set({ label: input.label, updatedAt: new Date() })
      .where(and(eq(variantDefinitions.id, input.id), eq(variantDefinitions.storeId, storeId)));
  });
  return readAfterCommit(() => getDefinition(db, storeId, input.id));
}

/**
 * Turns a variant on or off. Off only means "no longer offered when editing
 * products": products that carry it keep it, on the dashboard as in the
 * storefront. Withdrawing it from them is `withdrawVariantFromProducts`.
 */
export async function setVariantDefinitionActive(
  storeId: string,
  input: { id: string; isActive: boolean },
) {
  await db.transaction(async (tx) => {
    await lockStoreProducts(tx, storeId);
    await findDefinition(tx, storeId, input.id);
    await tx
      .update(variantDefinitions)
      .set({ isActive: input.isActive, updatedAt: new Date() })
      .where(and(eq(variantDefinitions.id, input.id), eq(variantDefinitions.storeId, storeId)));
  });
  return { id: input.id, isActive: input.isActive };
}

/**
 * Deletes a variant and its values from the catalog. Refused while products
 * use it (VARIANT_IN_USE names them): deleting under them would leave their
 * axes pointing at nothing. `confirm` receives the variant, under the lock.
 */
export async function deleteVariantDefinition(
  storeId: string,
  id: string,
  options: { confirm?: ConfirmStep<VariantDeletionPreview> } = {},
) {
  let refusal: ConfirmationRefusal | null = null;
  await db.transaction(async (tx) => {
    await lockStoreProducts(tx, storeId);
    const definition = await getDefinition(tx, storeId, id);
    const using = productsUsing(await readStoreUsage(tx, storeId), definition);
    if (using.length > 0) {
      throw variantErrors.inUse(using.slice(0, VARIANT_USAGE_PRODUCTS_MAX), using.length);
    }
    if (options.confirm) {
      refusal = await options.confirm(
        {
          definition: {
            id: definition.id,
            key: definition.key,
            label: definition.label,
            valueIds: definition.values.map((value) => value.id),
          },
          summary: `Delete the variant "${definition.label}" and its ${definition.values.length} value(s) from the catalog. No product uses it.`,
        },
        tx,
      );
      if (refusal) return;
    }
    await tx.delete(variantValues).where(eq(variantValues.definitionId, id));
    await tx
      .delete(variantDefinitions)
      .where(and(eq(variantDefinitions.id, id), eq(variantDefinitions.storeId, storeId)));
  });
  if (refusal) return raiseConfirmation(refusal);
  return { id };
}

/**
 * Withdraws a variant from every product of the store at once: their axis
 * goes, their units' values for it are cleared, and units and booked lines
 * are re-keyed. `confirm` receives the products it changes, under the lock.
 */
export async function withdrawVariantFromProducts(
  actor: ProductActor,
  id: string,
  options: { confirm?: ConfirmStep<VariantWithdrawalPreview> } = {},
) {
  const { storeId } = actor;
  let refusal: ConfirmationRefusal | null = null;
  let affectedProductCount = 0;
  await db.transaction(async (tx) => {
    await lockStoreProducts(tx, storeId);
    // Every product of the store, before the first plain read: the preview
    // names the products the withdrawal then changes.
    await tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.storeId, storeId))
      .orderBy(asc(products.id))
      .for("update");
    const definition = await findDefinition(tx, storeId, id);
    if (options.confirm) {
      const using = productsUsing(await readStoreUsage(tx, storeId), definition);
      refusal = await options.confirm(
        {
          definition: { id: definition.id, key: definition.key, label: definition.label },
          products: using,
          summary:
            using.length > 0
              ? `Withdraw the variant "${definition.label}" from ${using.length} product(s) (${using
                  .slice(0, 10)
                  .map((product) => product.name)
                  .join(
                    ", ",
                  )}${using.length > 10 ? ", …" : ""}): their units lose their "${definition.label}" value, and their stock and bookings stop being split by it.`
              : `Withdraw the variant "${definition.label}": no product uses it, nothing changes.`,
        },
        tx,
      );
      if (refusal) return;
    }
    const removed = await removeVariantFromStoreProducts(tx, {
      storeId,
      variant: { key: definition.key, label: definition.label },
    });
    affectedProductCount = removed.productIds.length;
  });
  if (refusal) return raiseConfirmation(refusal);
  if (affectedProductCount > 0) emit(actor, { type: "products.changed", store: eventStore(actor) });
  return { id, affectedProductCount };
}

// --- Values ------------------------------------------------------------------

/**
 * Adds a value to a variant, or returns the variant's value of the same
 * label (the collation ignores case) with its color updated when one is sent.
 */
export async function createVariantValue(
  storeId: string,
  input: z.infer<typeof createVariantValueInput>,
) {
  const { valueId, created } = await db.transaction(async (tx) => {
    await lockStoreProducts(tx, storeId);
    await findDefinition(tx, storeId, input.definitionId);
    const [existing] = await tx
      .select({ id: variantValues.id })
      .from(variantValues)
      .where(
        and(
          eq(variantValues.definitionId, input.definitionId),
          eq(variantValues.label, input.label),
        ),
      )
      .limit(1);
    if (existing) {
      if (input.colorHex) {
        await tx
          .update(variantValues)
          .set({ colorHex: input.colorHex })
          .where(eq(variantValues.id, existing.id));
      }
      return { valueId: existing.id, created: false };
    }

    const [{ maxPosition, total }] = await tx
      .select({
        maxPosition: sql<number>`COALESCE(MAX(${variantValues.position}), 0)`.mapWith(Number),
        total: count(),
      })
      .from(variantValues)
      .where(eq(variantValues.definitionId, input.definitionId));
    if (total >= VARIANT_VALUE_MAX) throw variantErrors.valueLimitReached();
    const [inserted] = await tx
      .insert(variantValues)
      .values({
        definitionId: input.definitionId,
        label: input.label,
        colorHex: input.colorHex ?? null,
        position: maxPosition + 1,
      })
      .$returningId();
    return { valueId: inserted.id, created: true };
  });

  const {
    definitionId: _definitionId,
    definitionLabel: _label,
    key: _key,
    ...value
  } = await readAfterCommit(() => findValue(db, storeId, valueId));
  return { ...value, created };
}

/** Changes a value's label or color: a field left out is unchanged, colorHex null clears it. */
export async function updateVariantValue(
  storeId: string,
  input: z.infer<typeof updateVariantValueInput>,
) {
  await db.transaction(async (tx) => {
    await lockStoreProducts(tx, storeId);
    const value = await findValue(tx, storeId, input.id);
    if (input.label !== undefined) {
      const [duplicate] = await tx
        .select({ id: variantValues.id })
        .from(variantValues)
        .where(
          and(
            eq(variantValues.definitionId, value.definitionId),
            ne(variantValues.id, input.id),
            eq(sql`LOWER(${variantValues.label})`, input.label.toLowerCase()),
          ),
        )
        .limit(1);
      if (duplicate) throw variantErrors.valueExists(input.label);
    }
    if (input.label === undefined && input.colorHex === undefined) return;
    await tx
      .update(variantValues)
      .set({
        ...(input.label !== undefined && { label: input.label }),
        ...(input.colorHex !== undefined && { colorHex: input.colorHex }),
      })
      .where(eq(variantValues.id, input.id));
  });

  const {
    definitionId: _definitionId,
    definitionLabel: _label,
    key: _key,
    ...value
  } = await readAfterCommit(() => findValue(db, storeId, input.id));
  return value;
}

/**
 * Removes a value from a variant's catalog: products no longer get it
 * offered. Units that carry it keep it. `confirm` receives the products
 * whose units carry it, under the lock.
 */
export async function deleteVariantValue(
  storeId: string,
  id: string,
  options: { confirm?: ConfirmStep<VariantValueDeletionPreview> } = {},
) {
  let refusal: ConfirmationRefusal | null = null;
  await db.transaction(async (tx) => {
    await lockStoreProducts(tx, storeId);
    const value = await findValue(tx, storeId, id);
    if (options.confirm) {
      const carrying = productsCarryingValue(
        await readStoreUsage(tx, storeId),
        { key: value.key, label: value.definitionLabel },
        value.label,
      );
      refusal = await options.confirm(
        {
          value: { id: value.id, label: value.label },
          definition: { id: value.definitionId, label: value.definitionLabel },
          products: carrying,
          summary:
            `Delete the value "${value.label}" of the variant "${value.definitionLabel}" from the catalog: it is no longer offered to products.` +
            (carrying.length > 0
              ? ` The units of ${carrying.length} product(s) that carry it keep it (${carrying
                  .slice(0, 10)
                  .map((product) => product.name)
                  .join(", ")}${carrying.length > 10 ? ", …" : ""}).`
              : ""),
        },
        tx,
      );
      if (refusal) return;
    }
    await tx.delete(variantValues).where(eq(variantValues.id, id));
  });
  if (refusal) return raiseConfirmation(refusal);
  return { id };
}
