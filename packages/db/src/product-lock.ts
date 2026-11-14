import { sql } from "drizzle-orm";

import type { Database, Transaction } from "./index";

/**
 * The row locks on products, taken in one order by every transaction that
 * takes several: by id, within a store. Each statement names the index it
 * reads through, so the order is the index's and never the optimizer's
 * choice: another index of the table (the store's slugs) reads the same rows
 * in another order, and two transactions that took them through different
 * indexes could each hold a row the other waits for.
 */

/** Locks these products of the store, by id, through the primary key. */
export async function lockProductRows(
  tx: Transaction | Database,
  storeId: string,
  productIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return;
  const list = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
  await tx.execute(
    sql`SELECT id FROM products FORCE INDEX (PRIMARY)
        WHERE id IN (${list}) AND store_id = ${storeId} ORDER BY id FOR UPDATE`,
  );
}

/** Locks every product of the store, by id, through the store's index. */
export async function lockStoreProductRows(
  tx: Transaction | Database,
  storeId: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT id FROM products FORCE INDEX (products_store_idx)
        WHERE store_id = ${storeId} ORDER BY id FOR UPDATE`,
  );
}
