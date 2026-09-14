import { and, eq, like } from "drizzle-orm";

import { pickUniqueSlug, slugify } from "./slug";

import { categories, products } from "./schema";
import type { Database, Transaction } from "./index";

type Executor = Database | Transaction;

const takenSlugs = async (
  executor: Executor,
  table: typeof products | typeof categories,
  storeId: string,
  base: string,
): Promise<Set<string>> => {
  const rows = await executor
    .select({ slug: table.slug })
    .from(table)
    .where(and(eq(table.storeId, storeId), like(table.slug, `${base}%`)));

  return new Set(rows.flatMap((row) => (row.slug ? [row.slug] : [])));
};

/**
 * A free product slug for `name` in the store: the slugified name, numbered
 * when a sibling already holds it. Call inside the same transaction as the
 * insert so two concurrent creations cannot pick the same value; the unique
 * index is the last line of defence.
 */
export const nextProductSlug = async (
  executor: Executor,
  storeId: string,
  name: string,
): Promise<string> => {
  const base = slugify(name);
  return pickUniqueSlug(base, await takenSlugs(executor, products, storeId, base), "produit");
};

/** Same as `nextProductSlug`, for a category. */
export const nextCategorySlug = async (
  executor: Executor,
  storeId: string,
  name: string,
): Promise<string> => {
  const base = slugify(name);
  return pickUniqueSlug(base, await takenSlugs(executor, categories, storeId, base), "categorie");
};
