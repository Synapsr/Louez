import { AsyncLocalStorage } from "node:async_hooks";

import { eq } from "drizzle-orm";

import type { Transaction } from "./index";
import { apiOperations } from "./schema";

/**
 * The agent-ready API's write running now (packages/api
 * platform/operations.ts), as its own transactions see it: what the write
 * did that only its business code knows, recorded where it happens.
 */
export interface ApiOperationScope {
  /** `api_operations.id` of the write. */
  operationId: string;
  /**
   * The write sets a store up (platform/setup-analytics.ts): when it locks a
   * store row while that store is offline, its record names the store
   * (`setup_store_id`), in the same transaction.
   */
  marksSetup: boolean;
  /** A confirmation token was spent by this write (platform/confirmation.ts). */
  confirmed: boolean;
  /** False once the handler returned: a task it left behind marks nothing. */
  active: boolean;
}

const scope = new AsyncLocalStorage<ApiOperationScope>();

/** Runs a write's handler with its scope. */
export function runInApiOperation<T>(value: ApiOperationScope, run: () => T): T {
  return scope.run(value, run);
}

/** The write running now, while its handler runs; undefined outside one. */
export function currentApiOperation(): ApiOperationScope | undefined {
  const value = scope.getStore();
  return value?.active ? value : undefined;
}

/**
 * Marks the running write as one that set `storeId` up, in `tx`, the
 * transaction that holds the store row's lock: whether the store was offline
 * is read under that lock, so a launch committed before the write is seen,
 * and one after it waits. Nothing outside a setup write, or once the store is
 * online. The mark commits or rolls back with the write.
 */
export async function markSetupWrite(tx: Transaction, storeId: string, online: boolean) {
  const operation = currentApiOperation();
  if (!operation?.marksSetup || online) return;
  await tx
    .update(apiOperations)
    .set({ setupStoreId: storeId })
    .where(eq(apiOperations.id, operation.operationId));
}

/**
 * Takes back the running write's setup mark, in `tx`: a write refused with a
 * preview under its lock commits that transaction (the preview's row) and
 * sets nothing up, so its mark goes with that same commit.
 */
export async function unmarkSetupWrite(tx: Transaction) {
  const operation = currentApiOperation();
  if (!operation?.marksSetup) return;
  await tx
    .update(apiOperations)
    .set({ setupStoreId: null })
    .where(eq(apiOperations.id, operation.operationId));
}
