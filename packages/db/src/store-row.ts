import type { StoreSettings, StoreTheme } from "@louez/types";
import { eq } from "drizzle-orm";

import type { Database, Transaction } from "./index";
import { stores } from "./schema";

/**
 * The store row holds JSON columns that several writers patch key by key:
 * `settings` (company, rules, hours, delivery, taxes, integrations,
 * inspections, customer fields…), `theme`, the store's and the customers'
 * notification settings, and Review Booster's. A writer that reads one of
 * them, then writes it back whole, loses any change committed in between.
 * So every such writer locks the row first, then reads it, then writes.
 */

/**
 * Locks the store row (`SELECT … FOR UPDATE`), the first read of `tx`: under
 * REPEATABLE READ the snapshot is fixed by the first plain read, so a plain
 * read after this lock sees every write committed before it. False when the
 * store does not exist.
 */
export async function lockStoreRow(tx: Transaction, storeId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: stores.id })
    .from(stores)
    .where(eq(stores.id, storeId))
    .for("update");
  return row !== undefined;
}

type StoreSelect = typeof stores.$inferSelect;

/** The JSON columns of a store row, as stored. */
export interface StoreJson {
  settings: StoreSettings | null;
  theme: StoreTheme | null;
  notificationSettings: StoreSelect["notificationSettings"];
  customerNotificationSettings: StoreSelect["customerNotificationSettings"];
  reviewBoosterSettings: StoreSelect["reviewBoosterSettings"];
}

const jsonColumns = {
  settings: stores.settings,
  theme: stores.theme,
  notificationSettings: stores.notificationSettings,
  customerNotificationSettings: stores.customerNotificationSettings,
  reviewBoosterSettings: stores.reviewBoosterSettings,
};

export type StoreRowUpdate = Partial<typeof stores.$inferInsert>;

/**
 * One write of a store row from its current JSON: locks the row, reads its
 * JSON columns (`StoreJson`), and sets what `merge` returns, in one transaction
 * (a new one from the database, or a savepoint of the caller's, whose first
 * read must be this lock). `merge` may write more in `tx` (a billing mark).
 * Returns its `result`, or null when the store does not exist.
 */
export async function mergeStoreRow<TResult = undefined>(
  executor: Database | Transaction,
  storeId: string,
  merge: (
    current: StoreJson,
    tx: Transaction,
  ) =>
    | Promise<{ set: StoreRowUpdate; result?: TResult }>
    | { set: StoreRowUpdate; result?: TResult },
): Promise<{ result: TResult | undefined } | null> {
  const run = async (tx: Transaction) => {
    if (!(await lockStoreRow(tx, storeId))) return null;
    const [current] = await tx.select(jsonColumns).from(stores).where(eq(stores.id, storeId));
    if (!current) return null;
    const { set, result } = await merge(current, tx);
    await tx
      .update(stores)
      .set({ ...set, updatedAt: set.updatedAt ?? new Date() })
      .where(eq(stores.id, storeId));
    return { result };
  };
  // The database opens a transaction; a transaction, a savepoint.
  return executor.transaction(run);
}
