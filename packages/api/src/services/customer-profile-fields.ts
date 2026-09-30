import { customers, db, stores } from "@louez/db";
import type { Transaction } from "@louez/db";
import {
  CUSTOMER_PROFILE_FIELD_KEYS,
  type CustomerProfileFieldKey,
  type ResolvedCustomerProfileSettings,
} from "@louez/types";
import {
  mergeCustomerProfileFieldSettings,
  planCustomerProfileValuesSave,
  resolveCustomerProfileSettings,
  type CustomerProfileFieldUpdateInput,
  type CustomerProfileValues,
  type CustomerProfileValuesPatch,
} from "@louez/validations";
import { and, eq } from "drizzle-orm";

import { filterOwnedTargets } from "./customer-fields-online";

type Executor = typeof db | Transaction;

// ----------------------------------------------------------------------------
// Settings (stores.settings.customerProfile)
// ----------------------------------------------------------------------------

/**
 * The store's native field settings with targets that still exist, so the
 * editor never shows a nameless chip and the next save drops them.
 */
export async function getCustomerProfileSettings(
  storeId: string,
  executor: Executor = db,
): Promise<ResolvedCustomerProfileSettings | null> {
  const store = await executor.query.stores.findFirst({
    columns: { settings: true },
    where: eq(stores.id, storeId),
  });
  if (!store) return null;

  const resolved = resolveCustomerProfileSettings(store.settings?.customerProfile);
  const owned = new Set(
    (
      await filterOwnedTargets(
        storeId,
        CUSTOMER_PROFILE_FIELD_KEYS.flatMap((key) => resolved[key].targets),
        executor,
      )
    ).map((target) => `${target.type}:${target.id}`),
  );
  const withOwnedTargets = (key: CustomerProfileFieldKey) => ({
    ...resolved[key],
    targets: resolved[key].targets.filter((target) => owned.has(`${target.type}:${target.id}`)),
  });
  return {
    birthDate: withOwnedTargets("birthDate"),
    acquisitionSource: withOwnedTargets("acquisitionSource"),
    socialLinks: withOwnedTargets("socialLinks"),
  };
}

export type UpdateCustomerProfileFieldResult =
  | { ok: true; settings: ResolvedCustomerProfileSettings }
  | { ok: false; error: "storeNotFound" | "invalidData" };

/**
 * Applies one field's patch. The settings JSON is re-read under a row lock
 * and every other group kept as is, so a stale copy never overwrites them;
 * targets outside the store are dropped. Every field is written back in its
 * resolved shape (legacy strings included), which retires the early format.
 */
export async function updateCustomerProfileField(
  storeId: string,
  input: CustomerProfileFieldUpdateInput,
): Promise<UpdateCustomerProfileFieldResult> {
  return db.transaction(async (tx): Promise<UpdateCustomerProfileFieldResult> => {
    const [store] = await tx
      .select({ settings: stores.settings })
      .from(stores)
      .where(eq(stores.id, storeId))
      .for("update");
    if (!store) return { ok: false, error: "storeNotFound" };

    const { field, ...patch } = input;
    const current = resolveCustomerProfileSettings(store.settings?.customerProfile);
    const targets = patch.targets
      ? await filterOwnedTargets(storeId, patch.targets, tx)
      : undefined;
    const merged = mergeCustomerProfileFieldSettings(field, current[field], {
      ...patch,
      ...(targets ? { targets } : {}),
    });
    if (!merged) return { ok: false, error: "invalidData" };

    const customerProfile = { ...current, [field]: merged };
    const settings = store.settings ?? {
      reservationMode: "payment" as const,
      advanceNoticeMinutes: 1440,
    };
    await tx
      .update(stores)
      .set({ settings: { ...settings, customerProfile }, updatedAt: new Date() })
      .where(eq(stores.id, storeId));
    return { ok: true, settings: customerProfile };
  });
}

// ----------------------------------------------------------------------------
// Values (customers columns)
// ----------------------------------------------------------------------------

const profileColumns = {
  birthDate: customers.birthDate,
  acquisitionSource: customers.acquisitionSource,
  acquisitionSourceDetail: customers.acquisitionSourceDetail,
  socialLinks: customers.socialLinks,
};

export const NO_CUSTOMER_PROFILE_VALUES: CustomerProfileValues = {
  birthDate: null,
  acquisitionSource: null,
  acquisitionSourceDetail: null,
  socialLinks: null,
};

/** A customer's native values; empty for a customer of another store. */
export async function getCustomerProfileValues(
  storeId: string,
  customerId: string,
  executor: Executor = db,
): Promise<CustomerProfileValues> {
  const [row] = await executor
    .select(profileColumns)
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.storeId, storeId)))
    .limit(1);
  return row ?? NO_CUSTOMER_PROFILE_VALUES;
}

/**
 * Writes validated native values following `planCustomerProfileValuesSave`:
 * `overwrite` for the customer themselves, `fillEmpty` for anyone typing their
 * e-mail. The current values are read in the same transaction.
 */
export async function saveCustomerProfileValues(
  tx: Transaction,
  params: {
    storeId: string;
    customerId: string;
    values: CustomerProfileValuesPatch;
    mode: "overwrite" | "fillEmpty";
  },
): Promise<void> {
  if (Object.keys(params.values).length === 0) return;
  const current = await getCustomerProfileValues(params.storeId, params.customerId, tx);
  const changes = planCustomerProfileValuesSave({
    current,
    values: params.values,
    mode: params.mode,
  });
  if (Object.keys(changes).length === 0) return;

  await tx
    .update(customers)
    .set({ ...changes, updatedAt: new Date() })
    .where(and(eq(customers.id, params.customerId), eq(customers.storeId, params.storeId)));
}
