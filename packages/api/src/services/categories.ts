import {
  categories,
  db,
  lockStoreRow,
  nextCategorySlug,
  productCategories,
  products,
  type Transaction,
} from "@louez/db";
import { isOwnedImageUrl } from "@louez/validations";
import { and, asc, count, eq, gt, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";

import {
  CATEGORY_PAGE_MAX,
  CATEGORY_STORE_MAX,
  categoryErrors,
  type Category,
  type createCategoryInput,
  type deleteCategoryInput,
  type updateCategoryInput,
} from "../contracts/categories";
import { readAfterCommit } from "../platform/errors";
import { raiseConfirmation, type ConfirmationRefusal } from "../platform/confirmation";

/**
 * Categories of a store: the business rules behind the categories procedures.
 * Every function takes the store id from the actor and filters on it, so an id
 * from another store is "not found".
 */

/** Where a store's category images live in storage; `isOwnedImageUrl` checks the prefix. */
const categoryImagePrefix = (storeId: string) => `${storeId}/categories`;

const position = sql<number>`COALESCE(${categories.order}, 0)`.mapWith(Number);

/**
 * Products linked to the category, as the dashboard counts them. The columns
 * are qualified by hand: inside a select, Drizzle writes them bare, and a bare
 * `id` would be the link's own.
 */
const productCount = sql<number>`(
  SELECT COUNT(*) FROM ${productCategories}
  WHERE ${productCategories}.${sql.identifier(productCategories.categoryId.name)}
    = ${categories}.${sql.identifier(categories.id.name)}
)`.mapWith(Number);

const categoryColumns = {
  id: categories.id,
  name: categories.name,
  slug: categories.slug,
  description: categories.description,
  imageUrl: categories.imageUrl,
  position,
  productCount,
  createdAt: categories.createdAt,
  updatedAt: categories.updatedAt,
};

const blankToNull = (value: string | null | undefined) =>
  value === undefined ? undefined : value?.trim() || null;

function assertOwnedImage(storeId: string, imageUrl: string) {
  if (!isOwnedImageUrl(imageUrl, categoryImagePrefix(storeId)))
    throw categoryErrors.imageNotOwned();
}

/**
 * Serializes the category writes of one store: creation (name rule, order,
 * slug), rename and reorder read then write, and two of them must not
 * interleave. Released when the transaction ends.
 */
async function lockStoreCategories(tx: Transaction, storeId: string) {
  await lockStoreRow(tx, storeId);
}

async function findByName(executor: Transaction, storeId: string, name: string) {
  const [row] = await executor
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(eq(categories.storeId, storeId), eq(sql`LOWER(${categories.name})`, name.toLowerCase())),
    )
    .orderBy(asc(position), asc(categories.id))
    .limit(1);
  return row ?? null;
}

// --- Reads -----------------------------------------------------------------

// A cursor is the id of the page's last category: short whatever the name,
// and read back in the store, so another store's id is just "invalid".
const encodeCursor = (category: Category) => category.id;

async function decodeCursor(storeId: string, raw: string) {
  const [row] = await db
    .select({ position, name: categories.name, id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, raw), eq(categories.storeId, storeId)))
    .limit(1);
  if (!row) throw categoryErrors.invalidCursor();
  return row;
}

/**
 * One page of the store's categories, in the store's order: position, then
 * name, then id, so the order is total and a cursor never skips or repeats.
 */
export async function listCategories(
  storeId: string,
  input: { cursor?: string; limit?: number },
): Promise<{ items: Category[]; nextCursor: string | null }> {
  const limit = input.limit ?? CATEGORY_PAGE_MAX;
  const conditions: SQL[] = [eq(categories.storeId, storeId)];
  if (input.cursor) {
    const after = await decodeCursor(storeId, input.cursor);
    conditions.push(
      or(
        gt(position, after.position),
        and(
          eq(position, after.position),
          or(
            gt(categories.name, after.name),
            and(eq(categories.name, after.name), gt(categories.id, after.id)),
          ),
        ),
      ) as SQL,
    );
  }

  const rows = await db
    .select(categoryColumns)
    .from(categories)
    .where(and(...conditions))
    .orderBy(asc(position), asc(categories.name), asc(categories.id))
    .limit(limit + 1);

  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(last) : null };
}

export async function getCategory(storeId: string, id: string): Promise<Category> {
  const [row] = await db
    .select(categoryColumns)
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.storeId, storeId)))
    .limit(1);
  if (!row) throw categoryErrors.notFound(id);
  return row;
}

// --- Writes ----------------------------------------------------------------

/**
 * Creates a category, or returns the store's category of the same name
 * (case-insensitive) as is, with `created: false`.
 *
 * The name check and the insert run under the store's category lock, so two
 * concurrent creations of one name, retries included, insert once. There is
 * no unique index on the name: production may already hold duplicates from
 * before the rule, and the index would fail to build there.
 */
export async function createCategory(
  storeId: string,
  input: z.infer<typeof createCategoryInput>,
): Promise<Category & { created: boolean }> {
  const description = blankToNull(input.description) ?? null;
  const imageUrl = blankToNull(input.imageUrl) ?? null;
  if (imageUrl) assertOwnedImage(storeId, imageUrl);

  const { id, created } = await db.transaction(async (tx) => {
    await lockStoreCategories(tx, storeId);
    const existing = await findByName(tx, storeId, input.name);
    if (existing) return { id: existing.id, created: false };

    const [{ maxPosition, total }] = await tx
      .select({
        maxPosition: sql<number>`COALESCE(MAX(${categories.order}), 0)`.mapWith(Number),
        total: count(),
      })
      .from(categories)
      .where(eq(categories.storeId, storeId));
    if (total >= CATEGORY_STORE_MAX) throw categoryErrors.limitReached();
    const [inserted] = await tx
      .insert(categories)
      .values({
        storeId,
        name: input.name,
        slug: await nextCategorySlug(tx, storeId, input.name),
        description,
        imageUrl,
        order: maxPosition + 1,
      })
      .$returningId();
    return { id: inserted.id, created: true };
  });

  return { ...(await readAfterCommit(() => getCategory(storeId, id))), created };
}

/** Changes the fields given: a field left out is unchanged, `null` clears it. */
export async function updateCategory(
  storeId: string,
  input: z.infer<typeof updateCategoryInput>,
): Promise<Category> {
  const description = blankToNull(input.description);
  const imageUrl = blankToNull(input.imageUrl);

  await db.transaction(async (tx) => {
    await lockStoreCategories(tx, storeId);
    const [current] = await tx
      .select({ imageUrl: categories.imageUrl })
      .from(categories)
      .where(and(eq(categories.id, input.id), eq(categories.storeId, storeId)))
      .limit(1);
    if (!current) throw categoryErrors.notFound(input.id);

    // An image kept as it was is not checked again: it may predate the rule.
    if (imageUrl && imageUrl !== current.imageUrl) assertOwnedImage(storeId, imageUrl);

    if (input.name !== undefined) {
      const [duplicate] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(
          and(
            eq(categories.storeId, storeId),
            ne(categories.id, input.id),
            eq(sql`LOWER(${categories.name})`, input.name.toLowerCase()),
          ),
        )
        .limit(1);
      if (duplicate) throw categoryErrors.nameTaken(input.name, duplicate.id);
    }

    await tx
      .update(categories)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(imageUrl !== undefined ? { imageUrl } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(categories.id, input.id), eq(categories.storeId, storeId)));
  });

  return readAfterCommit(() => getCategory(storeId, input.id));
}

/** What deleting a category would do, for its confirmation preview. */
export interface CategoryDeletionPreview {
  category: { id: string; name: string; updatedAt: Date };
  replacement: { id: string; name: string } | null;
  /** Products linked to the category. */
  affectedProductCount: number;
  /** Of those, the products left without any category (no replacement given). */
  uncategorizedProductCount: number;
  summary: string;
}

async function previewCategoryDeletion(
  tx: Transaction,
  storeId: string,
  input: z.infer<typeof deleteCategoryInput>,
): Promise<CategoryDeletionPreview> {
  const replacementId = input.replacementCategoryId ?? null;
  const [category] = await tx
    .select({ id: categories.id, name: categories.name, updatedAt: categories.updatedAt })
    .from(categories)
    .where(and(eq(categories.id, input.id), eq(categories.storeId, storeId)))
    .limit(1);
  if (!category) throw categoryErrors.notFound(input.id);

  let replacement: CategoryDeletionPreview["replacement"] = null;
  if (replacementId) {
    if (replacementId === input.id) throw categoryErrors.replacementNotFound(replacementId);
    const [row] = await tx
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(and(eq(categories.id, replacementId), eq(categories.storeId, storeId)))
      .limit(1);
    if (!row) throw categoryErrors.replacementNotFound(replacementId);
    replacement = row;
  }

  const affected = await tx
    .select({ productId: productCategories.productId })
    .from(productCategories)
    .innerJoin(products, eq(products.id, productCategories.productId))
    .where(and(eq(products.storeId, storeId), eq(productCategories.categoryId, input.id)));
  const affectedIds = affected.map((row) => row.productId);

  let uncategorizedProductCount = 0;
  if (!replacement && affectedIds.length > 0) {
    const linkCounts = await tx
      .select({ links: count() })
      .from(productCategories)
      .where(inArray(productCategories.productId, affectedIds))
      .groupBy(productCategories.productId);
    uncategorizedProductCount = linkCounts.filter((row) => row.links === 1).length;
  }

  const productsText = affectedIds.length === 1 ? "1 product" : `${affectedIds.length} products`;
  const summary =
    affectedIds.length === 0
      ? `Delete the category "${category.name}". No product is linked to it.`
      : replacement
        ? `Delete the category "${category.name}" and move its ${productsText} to "${replacement.name}".`
        : `Delete the category "${category.name}". ${productsText} lose it; ${uncategorizedProductCount} of them are left with no category.`;

  return {
    category,
    replacement,
    affectedProductCount: affectedIds.length,
    uncategorizedProductCount,
    summary,
  };
}

/**
 * Deletes a category. Its products move to the replacement when one is given;
 * otherwise each keeps its other categories, and a product whose main
 * category this was takes its next one (or none).
 *
 * Runs under the store's category lock, so a concurrent deletion of the
 * replacement, or any other category write, cannot interleave. `confirm`
 * receives what the deletion will do, computed under that lock, and the
 * transaction: when it returns an error (a confirmation to ask for), nothing
 * is deleted, the transaction commits what `confirm` wrote on it (the new
 * preview), and the error is thrown once the lock is released.
 */
export async function deleteCategory(
  storeId: string,
  input: z.infer<typeof deleteCategoryInput>,
  options: {
    confirm?: (
      preview: CategoryDeletionPreview,
      tx: Transaction,
    ) => Promise<ConfirmationRefusal | null>;
  } = {},
): Promise<{ id: string; affectedProductCount: number; replacementCategoryId: string | null }> {
  const replacementId = input.replacementCategoryId ?? null;
  let refusal: ConfirmationRefusal | null = null;

  const affectedProductCount = await db.transaction(async (tx) => {
    await lockStoreCategories(tx, storeId);
    // Checks the category and the replacement, and says what will happen.
    const preview = await previewCategoryDeletion(tx, storeId, input);
    refusal = (await options.confirm?.(preview, tx)) ?? null;
    if (refusal) return 0;

    const affectedLinks = await tx
      .select({ productId: productCategories.productId, position: productCategories.position })
      .from(productCategories)
      .innerJoin(products, eq(products.id, productCategories.productId))
      .where(and(eq(products.storeId, storeId), eq(productCategories.categoryId, input.id)));

    await tx.delete(productCategories).where(eq(productCategories.categoryId, input.id));

    const affectedIds = affectedLinks.map((link) => link.productId);
    if (affectedIds.length > 0) {
      if (replacementId) {
        const alreadyLinked = new Set(
          (
            await tx
              .select({ productId: productCategories.productId })
              .from(productCategories)
              .where(
                and(
                  inArray(productCategories.productId, affectedIds),
                  eq(productCategories.categoryId, replacementId),
                ),
              )
          ).map((link) => link.productId),
        );
        const replacementLinks = affectedLinks
          .filter((link) => !alreadyLinked.has(link.productId))
          .map((link) => ({
            productId: link.productId,
            categoryId: replacementId,
            position: link.position,
          }));
        if (replacementLinks.length > 0) {
          await tx.insert(productCategories).values(replacementLinks);
        }
      }

      const remainingLinks = await tx
        .select({
          productId: productCategories.productId,
          categoryId: productCategories.categoryId,
        })
        .from(productCategories)
        .where(inArray(productCategories.productId, affectedIds))
        .orderBy(asc(productCategories.position));
      const nextCategory = new Map<string, string>();
      for (const link of remainingLinks) {
        if (!nextCategory.has(link.productId)) nextCategory.set(link.productId, link.categoryId);
      }

      for (const productId of affectedIds) {
        await tx
          .update(products)
          .set({ categoryId: replacementId ?? nextCategory.get(productId) ?? null })
          .where(
            and(
              eq(products.id, productId),
              eq(products.storeId, storeId),
              eq(products.categoryId, input.id),
            ),
          );
      }
    }

    await tx
      .delete(categories)
      .where(and(eq(categories.id, input.id), eq(categories.storeId, storeId)));
    return affectedIds.length;
  });

  if (refusal) return raiseConfirmation(refusal);
  return { id: input.id, affectedProductCount, replacementCategoryId: replacementId };
}

/**
 * Puts the store's categories in the given order. `ids` must hold every
 * category of the store exactly once, so the result never depends on a
 * category the caller did not know about.
 */
export async function reorderCategories(
  storeId: string,
  ids: readonly string[],
): Promise<{ items: Array<{ id: string; position: number }> }> {
  await db.transaction(async (tx) => {
    await lockStoreCategories(tx, storeId);
    const current = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.storeId, storeId))
      .orderBy(asc(position), asc(categories.name), asc(categories.id));

    const known = new Set(current.map((row) => row.id));
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) duplicates.add(id);
      seen.add(id);
    }
    const missing = current.map((row) => row.id).filter((id) => !seen.has(id));
    const unknown = [...seen].filter((id) => !known.has(id));
    if (missing.length > 0 || unknown.length > 0 || duplicates.size > 0) {
      throw categoryErrors.orderMismatch({ missing, unknown, duplicates: [...duplicates] });
    }

    await tx
      .update(categories)
      .set({
        order: sql`CASE ${categories.id} ${sql.join(
          ids.map((id, index) => sql`WHEN ${id} THEN ${index + 1}`),
          sql` `,
        )} END`,
      })
      .where(and(eq(categories.storeId, storeId), inArray(categories.id, [...ids])));
  });

  return { items: ids.map((id, index) => ({ id, position: index + 1 })) };
}
