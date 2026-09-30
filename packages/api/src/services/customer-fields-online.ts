import {
  categories,
  customerFieldTargets,
  db,
  productCategories,
  products,
  reservationItemDetails,
  reservationItems,
  reservations,
} from "@louez/db";
import type { Transaction } from "@louez/db";
import type {
  CustomerFieldDefinition,
  CustomerFieldTarget,
  CustomerFieldValues,
  ReservationItemDetail,
  ResolvedCustomerProfileSettings,
} from "@louez/types";
import {
  itemFieldsForProduct,
  resolveCheckoutFields,
  resolveCheckoutProfileFields,
  type CheckoutProfileField,
  type ResolvedCheckoutFields,
} from "@louez/validations";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { listCustomerFieldDefinitions } from "./customer-fields";

type Executor = typeof db | Transaction;

// ----------------------------------------------------------------------------
// Products and their categories
// ----------------------------------------------------------------------------

/**
 * Every category of each product of the store: the primary `category_id` and
 * the extra `product_categories` links. Products of another store are absent.
 */
export async function getProductCategoryIds(
  storeId: string,
  productIds: readonly string[],
  executor: Executor = db,
): Promise<Map<string, string[]>> {
  const ids = [...new Set(productIds)];
  const byProduct = new Map<string, string[]>();
  if (ids.length === 0) return byProduct;

  const rows = await executor
    .select({ id: products.id, categoryId: products.categoryId })
    .from(products)
    .where(and(eq(products.storeId, storeId), inArray(products.id, ids)));
  for (const row of rows) {
    byProduct.set(row.id, row.categoryId ? [row.categoryId] : []);
  }
  if (byProduct.size === 0) return byProduct;

  const links = await executor
    .select({ productId: productCategories.productId, categoryId: productCategories.categoryId })
    .from(productCategories)
    .where(inArray(productCategories.productId, [...byProduct.keys()]));
  for (const link of links) {
    const current = byProduct.get(link.productId);
    if (current && !current.includes(link.categoryId)) current.push(link.categoryId);
  }
  return byProduct;
}

// ----------------------------------------------------------------------------
// Targets
// ----------------------------------------------------------------------------

/** Deduplicated targets that exist in the store; anything else is dropped. */
export async function filterOwnedTargets(
  storeId: string,
  targets: readonly CustomerFieldTarget[],
  executor: Executor = db,
): Promise<CustomerFieldTarget[]> {
  const unique = [
    ...new Map(targets.map((target) => [`${target.type}:${target.id}`, target])).values(),
  ];
  const categoryIds = unique.filter((target) => target.type === "category").map((t) => t.id);
  const productIds = unique.filter((target) => target.type === "product").map((t) => t.id);

  const ownedCategories =
    categoryIds.length > 0
      ? await executor
          .select({ id: categories.id })
          .from(categories)
          .where(and(eq(categories.storeId, storeId), inArray(categories.id, categoryIds)))
      : [];
  const ownedProducts =
    productIds.length > 0
      ? await executor
          .select({ id: products.id })
          .from(products)
          .where(and(eq(products.storeId, storeId), inArray(products.id, productIds)))
      : [];

  const owned = new Set([
    ...ownedCategories.map((row) => `category:${row.id}`),
    ...ownedProducts.map((row) => `product:${row.id}`),
  ]);
  return unique.filter((target) => owned.has(`${target.type}:${target.id}`));
}

/** Replace-all of the targets of each definition. Targets outside the store are dropped. */
export async function replaceCustomerFieldTargets(
  tx: Transaction,
  params: {
    storeId: string;
    definitionIds: readonly string[];
    targets: readonly CustomerFieldTarget[];
  },
): Promise<void> {
  if (params.definitionIds.length === 0) return;
  const owned = await filterOwnedTargets(params.storeId, params.targets, tx);

  await tx
    .delete(customerFieldTargets)
    .where(
      and(
        eq(customerFieldTargets.storeId, params.storeId),
        inArray(customerFieldTargets.definitionId, [...params.definitionIds]),
      ),
    );
  if (owned.length === 0) return;

  await tx.insert(customerFieldTargets).values(
    params.definitionIds.flatMap((definitionId) =>
      owned.map((target) => ({
        storeId: params.storeId,
        definitionId,
        targetType: target.type,
        targetId: target.id,
      })),
    ),
  );
}

export interface CustomerFieldTargetOptions {
  categories: { id: string; name: string }[];
  products: {
    id: string;
    name: string;
    status: "draft" | "active" | "archived";
    image: string | null;
    categoryIds: string[];
  }[];
}

/**
 * Categories and products for the "Pour" picker and the preview's "Aperçu
 * pour". Archived products are listed (with their status) so a target set
 * before the archive still shows a name.
 */
export async function listCustomerFieldTargetOptions(
  storeId: string,
): Promise<CustomerFieldTargetOptions> {
  const categoryRows = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.storeId, storeId))
    .orderBy(asc(categories.order), asc(categories.name));

  const productRows = await db
    .select({
      id: products.id,
      name: products.name,
      status: products.status,
      images: products.images,
    })
    .from(products)
    .where(eq(products.storeId, storeId))
    .orderBy(asc(products.name));

  const categoryIds = await getProductCategoryIds(
    storeId,
    productRows.map((row) => row.id),
  );

  return {
    categories: categoryRows,
    products: productRows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status ?? "active",
      image: row.images?.[0] ?? null,
      categoryIds: categoryIds.get(row.id) ?? [],
    })),
  };
}

// ----------------------------------------------------------------------------
// Checkout resolution against the database
// ----------------------------------------------------------------------------

export interface ResolvedCartCustomerFields extends ResolvedCheckoutFields<CustomerFieldDefinition> {
  /** Native profile fields asked, in the record's order; both buyer types. */
  profileFields: CheckoutProfileField[];
}

/**
 * What the checkout asks for this cart, resolved from the store's live
 * definitions, its native field settings and the products' categories. Lines
 * whose product is not in the store ask nothing and concern no field.
 */
export async function resolveCartCustomerFields(
  storeId: string,
  lines: readonly { productId: string; quantity: number }[],
  customerType: "individual" | "business",
  profileSettings: ResolvedCustomerProfileSettings,
  executor: Executor = db,
): Promise<ResolvedCartCustomerFields> {
  const definitions = await listCustomerFieldDefinitions(
    storeId,
    { activeOnly: true, scope: "all" },
    executor,
  );
  const empty = {
    customerFields: [],
    lines: lines.map(() => ({ itemFields: [] })),
    profileFields: [],
  };
  const asksProfile = Object.values(profileSettings).some(
    (field) => field.visibility !== "hidden" && field.collectMode !== "never",
  );
  if (!asksProfile && !definitions.some((definition) => definition.collectMode !== "never")) {
    return empty;
  }

  const categoryIds = await getProductCategoryIds(
    storeId,
    lines.map((line) => line.productId),
    executor,
  );
  const known = lines.flatMap((line, index) => {
    const productCategoryIds = categoryIds.get(line.productId);
    return productCategoryIds
      ? [{ index, line: { ...line, categoryIds: productCategoryIds } }]
      : [];
  });
  const resolved = resolveCheckoutFields(
    definitions,
    known.map((entry) => entry.line),
    customerType,
  );
  const itemFieldsByIndex = new Map(
    known.map((entry, position) => [entry.index, resolved.lines[position]?.itemFields ?? []]),
  );

  return {
    customerFields: resolved.customerFields,
    lines: lines.map((_, index) => ({ itemFields: itemFieldsByIndex.get(index) ?? [] })),
    profileFields: resolveCheckoutProfileFields(
      profileSettings,
      known.map((entry) => ({ id: entry.line.productId, categoryIds: entry.line.categoryIds })),
    ),
  };
}

// ----------------------------------------------------------------------------
// Reservation item details (item-scope values per rented unit)
// ----------------------------------------------------------------------------

const storedValuesSchema = z.record(z.string(), z.string());

/** The JSON column as written by this module; anything else reads as empty. */
const toStoredValues = (raw: unknown): CustomerFieldValues => {
  const parsed = storedValuesSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
};

/** Units recorded on a reservation, keyed by reservation item id, in unit order. */
export async function getReservationItemDetails(
  storeId: string,
  reservationId: string,
  executor: Executor = db,
): Promise<Map<string, ReservationItemDetail[]>> {
  const rows = await executor
    .select({
      reservationItemId: reservationItemDetails.reservationItemId,
      unitIndex: reservationItemDetails.unitIndex,
      participantName: reservationItemDetails.participantName,
      values: reservationItemDetails.values,
    })
    .from(reservationItemDetails)
    .where(
      and(
        eq(reservationItemDetails.storeId, storeId),
        eq(reservationItemDetails.reservationId, reservationId),
      ),
    )
    .orderBy(asc(reservationItemDetails.unitIndex));

  const byItem = new Map<string, ReservationItemDetail[]>();
  for (const row of rows) {
    byItem.set(row.reservationItemId, [
      ...(byItem.get(row.reservationItemId) ?? []),
      {
        unitIndex: row.unitIndex,
        participantName: row.participantName,
        values: toStoredValues(row.values),
      },
    ]);
  }
  return byItem;
}

export interface ReservationItemDetailsWrite {
  reservationItemId: string;
  /** Fields this write owns on the item: their values are replaced, other recorded keys are kept. */
  managedDefinitionIds: readonly string[];
  /** When false, "Pour qui ?" keeps what is stored. */
  managesParticipantName: boolean;
  /** Normalised units; a unit left out is untouched. */
  units: readonly ReservationItemDetail[];
}

/**
 * Replaces, unit by unit, what the caller owns. A unit left with nothing
 * recorded loses its row. The caller guarantees that every item belongs to
 * the reservation and the reservation to the store.
 */
export async function saveReservationItemDetails(
  tx: Transaction,
  params: {
    storeId: string;
    reservationId: string;
    items: readonly ReservationItemDetailsWrite[];
  },
): Promise<void> {
  const itemIds = params.items.map((item) => item.reservationItemId);
  if (itemIds.length === 0) return;

  const existingRows = await tx
    .select({
      id: reservationItemDetails.id,
      reservationItemId: reservationItemDetails.reservationItemId,
      unitIndex: reservationItemDetails.unitIndex,
      participantName: reservationItemDetails.participantName,
      values: reservationItemDetails.values,
    })
    .from(reservationItemDetails)
    .where(
      and(
        eq(reservationItemDetails.storeId, params.storeId),
        eq(reservationItemDetails.reservationId, params.reservationId),
        inArray(reservationItemDetails.reservationItemId, itemIds),
      ),
    );
  const existingByUnit = new Map(
    existingRows.map((row) => [`${row.reservationItemId}:${row.unitIndex}`, row]),
  );

  for (const item of params.items) {
    const managed = new Set(item.managedDefinitionIds);
    for (const unit of item.units) {
      const existing = existingByUnit.get(`${item.reservationItemId}:${unit.unitIndex}`);
      const kept = Object.entries(toStoredValues(existing?.values)).filter(
        ([definitionId]) => !managed.has(definitionId),
      );
      const written = Object.entries(unit.values).filter(
        ([definitionId, value]) => managed.has(definitionId) && value !== "",
      );
      const values: CustomerFieldValues = Object.fromEntries([...kept, ...written]);
      const participantName = item.managesParticipantName
        ? unit.participantName
        : (existing?.participantName ?? null);

      if (Object.keys(values).length === 0 && participantName === null) {
        if (existing) {
          await tx
            .delete(reservationItemDetails)
            .where(
              and(
                eq(reservationItemDetails.id, existing.id),
                eq(reservationItemDetails.storeId, params.storeId),
              ),
            );
        }
        continue;
      }

      await tx
        .insert(reservationItemDetails)
        .values({
          storeId: params.storeId,
          reservationId: params.reservationId,
          reservationItemId: item.reservationItemId,
          unitIndex: unit.unitIndex,
          participantName,
          values,
        })
        .onDuplicateKeyUpdate({ set: { participantName, values, updatedAt: new Date() } });
    }
  }
}

export type ReservationItemDetailsAudience = "team" | "customer";

export interface ReservationItemDetailsView {
  reservationItemId: string;
  productId: string;
  /** Name at booking time (product snapshot). */
  productName: string;
  productImage: string | null;
  quantity: number;
  /**
   * Item-scope fields shown for this line, definitions order: those that apply
   * to the product, plus any other active one a unit holds a value for. The
   * customer only ever sees fields the checkout asks.
   */
  fields: CustomerFieldDefinition[];
  /** Exactly `quantity` units, in order; values restricted to `fields`. */
  units: ReservationItemDetail[];
}

/** The catalog lines of a reservation of the store (custom lines and insurance aside). */
export async function listReservationProductItems(
  storeId: string,
  reservationId: string,
  executor: Executor = db,
) {
  return executor
    .select({
      id: reservationItems.id,
      productId: reservationItems.productId,
      quantity: reservationItems.quantity,
      productSnapshot: reservationItems.productSnapshot,
    })
    .from(reservationItems)
    .innerJoin(
      reservations,
      and(eq(reservations.id, reservationItems.reservationId), eq(reservations.storeId, storeId)),
    )
    .where(
      and(
        eq(reservationItems.reservationId, reservationId),
        eq(reservationItems.isCustomItem, false),
        isNotNull(reservationItems.productId),
      ),
    )
    .orderBy(asc(reservationItems.createdAt), asc(reservationItems.id));
}

/**
 * "Détails de la location" of a reservation: one entry per catalog line that
 * has item-scope fields to show. The caller checks that the viewer may see
 * the reservation.
 */
export async function listReservationItemDetails(params: {
  storeId: string;
  reservationId: string;
  audience: ReservationItemDetailsAudience;
}): Promise<ReservationItemDetailsView[]> {
  const items = await listReservationProductItems(params.storeId, params.reservationId);
  if (items.length === 0) return [];

  const definitions = (
    await listCustomerFieldDefinitions(params.storeId, { activeOnly: true, scope: "item" })
  ).filter((definition) => params.audience === "team" || definition.collectMode !== "never");
  if (definitions.length === 0) return [];

  const categoryIds = await getProductCategoryIds(
    params.storeId,
    items.flatMap((item) => (item.productId ? [item.productId] : [])),
  );
  const details = await getReservationItemDetails(params.storeId, params.reservationId);

  return items.flatMap((item): ReservationItemDetailsView[] => {
    if (!item.productId) return [];
    const stored = (details.get(item.id) ?? []).filter((unit) => unit.unitIndex < item.quantity);
    const applicable = new Set(
      itemFieldsForProduct(definitions, {
        id: item.productId,
        categoryIds: categoryIds.get(item.productId) ?? [],
      }).map((definition) => definition.id),
    );
    const fields = definitions.filter(
      (definition) =>
        applicable.has(definition.id) || stored.some((unit) => Boolean(unit.values[definition.id])),
    );
    if (fields.length === 0) return [];

    const storedByIndex = new Map(stored.map((unit) => [unit.unitIndex, unit]));
    const units = Array.from({ length: item.quantity }, (_, unitIndex) => {
      const unit = storedByIndex.get(unitIndex);
      return {
        unitIndex,
        participantName: unit?.participantName ?? null,
        values: Object.fromEntries(
          fields.flatMap((field) => {
            const value = unit?.values[field.id];
            return value ? [[field.id, value]] : [];
          }),
        ),
      };
    });

    return [
      {
        reservationItemId: item.id,
        productId: item.productId,
        productName: item.productSnapshot.name,
        productImage: item.productSnapshot.images?.[0] ?? null,
        quantity: item.quantity,
        fields,
        units,
      },
    ];
  });
}

/**
 * Erases one item-scope field from every unit of the store, for a permanent
 * delete. A unit left with nothing recorded loses its row.
 */
export async function removeItemFieldValues(
  tx: Transaction,
  storeId: string,
  definitionId: string,
): Promise<void> {
  // Definition ids are nanoids; the path is still bound, never interpolated.
  const path = `$."${definitionId}"`;
  await tx
    .update(reservationItemDetails)
    .set({
      values: sql`JSON_REMOVE(${reservationItemDetails.values}, ${path})`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(reservationItemDetails.storeId, storeId),
        sql`JSON_CONTAINS_PATH(${reservationItemDetails.values}, 'one', ${path})`,
      ),
    );
  await tx
    .delete(reservationItemDetails)
    .where(
      and(
        eq(reservationItemDetails.storeId, storeId),
        isNull(reservationItemDetails.participantName),
        sql`JSON_LENGTH(${reservationItemDetails.values}) = 0`,
      ),
    );
}

const itemValueCountRowsSchema = z.array(
  z.object({ definitionId: z.string(), total: z.coerce.number() }),
);

/**
 * How many rented units hold a value, per item-scope definition. Feeds the
 * same "archive rather than delete" guard as customer values.
 */
export async function countItemFieldValues(storeId: string): Promise<Map<string, number>> {
  const [rows] = await db.execute(sql`
    SELECT keys_table.definition_id AS definitionId, COUNT(*) AS total
    FROM ${reservationItemDetails},
      JSON_TABLE(
        JSON_KEYS(${reservationItemDetails.values}),
        '$[*]' COLUMNS (definition_id VARCHAR(21) PATH '$')
      ) AS keys_table
    WHERE ${reservationItemDetails.storeId} = ${storeId}
    GROUP BY keys_table.definition_id
  `);
  const parsed = itemValueCountRowsSchema.safeParse(rows);
  return new Map(parsed.success ? parsed.data.map((row) => [row.definitionId, row.total]) : []);
}
