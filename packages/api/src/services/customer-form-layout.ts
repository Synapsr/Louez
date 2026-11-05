import { customerFieldDefinitions, db, stores } from "@louez/db";
import type { Transaction } from "@louez/db";
import type { CustomerFieldScope, StoreSettings } from "@louez/types";
import {
  lastStoredCustomerFormLayoutPosition,
  planCustomerFormLayoutUpdate,
  resolveStoreCustomerFormLayout,
  type CustomerFormLayoutDefinition,
  type CustomerFormLayoutItem,
  type CustomerFormLayoutUpdateInput,
} from "@louez/validations";
import { and, eq, sql } from "drizzle-orm";

import { listCustomerFieldDefinitions } from "./customer-fields";

type Executor = typeof db | Transaction;

/** What a store's settings hold of the layout: its Louez fields' places and their visibility. */
async function getStoreSettings(
  storeId: string,
  executor: Executor,
): Promise<{ settings: StoreSettings | null } | null> {
  const [store] = await executor
    .select({ settings: stores.settings })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);
  return store ?? null;
}

/**
 * The scope's layout with every item, hidden ones included (the settings
 * page), for definitions the caller already listed; null when the store is gone.
 */
export async function getCustomerFormLayout<TDefinition extends CustomerFormLayoutDefinition>(
  storeId: string,
  scope: CustomerFieldScope,
  definitions: readonly TDefinition[],
  executor: Executor = db,
): Promise<CustomerFormLayoutItem<TDefinition>[] | null> {
  const store = await getStoreSettings(storeId, executor);
  if (!store) return null;
  return resolveStoreCustomerFormLayout({
    settings: store.settings,
    scope,
    definitions,
    includeHidden: true,
  });
}

export type UpdateCustomerFormLayoutResult =
  | { ok: true }
  | { ok: false; error: "storeNotFound" | "invalidData" };

/**
 * Saves a new order and widths for one scope, in one transaction: positions
 * 0..n in the order sent, the Louez fields' entries into the store settings
 * (re-read under a row lock, every other group kept), the custom fields'
 * positions and widths onto their definitions.
 */
export async function updateCustomerFormLayout(
  storeId: string,
  input: CustomerFormLayoutUpdateInput,
): Promise<UpdateCustomerFormLayoutResult> {
  return db.transaction(async (tx): Promise<UpdateCustomerFormLayoutResult> => {
    const [store] = await tx
      .select({ settings: stores.settings })
      .from(stores)
      .where(eq(stores.id, storeId))
      .for("update");
    if (!store) return { ok: false, error: "storeNotFound" };

    const definitions = await listCustomerFieldDefinitions(storeId, { scope: input.scope }, tx);
    const current = resolveStoreCustomerFormLayout({
      settings: store.settings,
      scope: input.scope,
      definitions,
      includeHidden: true,
    });
    const plan = planCustomerFormLayoutUpdate({ current, items: input.items });
    if (!plan.ok) return { ok: false, error: "invalidData" };

    const before = new Map(definitions.map((definition) => [definition.id, definition]));
    for (const { id, position, width } of plan.definitions) {
      const previous = before.get(id);
      if (previous?.position === position && previous.width === width) continue;
      await tx
        .update(customerFieldDefinitions)
        .set({ position, width, updatedAt: new Date() })
        .where(
          and(eq(customerFieldDefinitions.id, id), eq(customerFieldDefinitions.storeId, storeId)),
        );
    }

    if (input.scope === "customer") {
      const settings = store.settings ?? {
        reservationMode: "payment" as const,
        advanceNoticeMinutes: 1440,
      };
      await tx
        .update(stores)
        .set({
          settings: { ...settings, customerFormLayout: plan.builtIns },
          updatedAt: new Date(),
        })
        .where(eq(stores.id, storeId));
    }
    return { ok: true };
  });
}

/**
 * Where the next new field goes: after every field of the store and after
 * every Louez field placed by the stored layout, so it lands at the very end.
 */
export async function nextCustomerFieldPosition(tx: Transaction, storeId: string): Promise<number> {
  const [{ maxPosition }] = await tx
    .select({ maxPosition: sql<number>`COALESCE(MAX(${customerFieldDefinitions.position}), 0)` })
    .from(customerFieldDefinitions)
    .where(eq(customerFieldDefinitions.storeId, storeId));
  const store = await getStoreSettings(storeId, tx);
  const layoutMax = lastStoredCustomerFormLayoutPosition(store?.settings?.customerFormLayout);
  return Math.max(Number(maxPosition), layoutMax ?? 0) + 1;
}
