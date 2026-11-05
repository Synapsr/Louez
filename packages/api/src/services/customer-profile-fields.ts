import { customers, db, stores } from "@louez/db";
import type { Transaction } from "@louez/db";
import {
  CUSTOMER_PROFILE_FIELD_KEYS,
  type CustomerFieldValues,
  type CustomerProfileFieldKey,
  type ResolvedCustomerProfileSettings,
} from "@louez/types";
import {
  listAskedProfileFields,
  mergeCustomerProfileFieldSettings,
  pickCustomerProfileValues,
  planCustomerProfileValuesSave,
  resolveCustomerProfileSettings,
  resolveStoreCustomerFormLayout,
  toAccountCustomerField,
  toCustomerExtraLayout,
  type AccountProfileField,
  type CustomerExtraLayoutItem,
  type CustomerFieldAccount,
  type CustomerProfileFieldUpdateInput,
  type CustomerProfileValues,
  type CustomerProfileValuesPatch,
} from "@louez/validations";
import { and, eq } from "drizzle-orm";

import { getCustomerFieldValues, listCustomerFieldDefinitions } from "./customer-fields";
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

// ----------------------------------------------------------------------------
// The customer's own account
// ----------------------------------------------------------------------------

/** `storefront.customerFields.myValues`: what a signed-in customer's account reads. */
export interface CustomerAccountFields {
  /** The profile's type; a checkout may still be done as the other type. */
  customerType: "individual" | "business";
  /** Customer-scope fields a checkout may ask, whatever the cart and the type. */
  fields: CustomerFieldAccount[];
  values: CustomerFieldValues;
  /** Native fields a checkout may ask, whatever the cart. */
  profileFields: AccountProfileField[];
  /** The customer's native values; null for a field the store does not ask. */
  profile: CustomerProfileValues;
  /** The extra block of the account and checkout forms: those fields, as laid out. */
  customerLayout: CustomerExtraLayoutItem[];
}

/**
 * The native and customer-scope fields a checkout may ask (whatever the cart),
 * the signed-in customer's values for them, and how the forms lay them out.
 * A customer's own values never tell more than the store asks. Null when the
 * customer is not one of the store's.
 */
export async function getCustomerAccountFields(params: {
  storeId: string;
  customerId: string;
  settings: { customerProfile?: unknown; customerFormLayout?: unknown } | null | undefined;
}): Promise<CustomerAccountFields | null> {
  const [customer] = await db
    .select({ customerType: customers.customerType, ...profileColumns })
    .from(customers)
    .where(and(eq(customers.id, params.customerId), eq(customers.storeId, params.storeId)))
    .limit(1);
  if (!customer) return null;

  const definitions = (
    await listCustomerFieldDefinitions(params.storeId, { activeOnly: true, scope: "customer" })
  ).filter((definition) => definition.collectMode !== "never");
  const stored =
    definitions.length > 0 ? await getCustomerFieldValues(params.storeId, params.customerId) : {};
  const profileFields = listAskedProfileFields(
    resolveCustomerProfileSettings(params.settings?.customerProfile),
  );

  return {
    customerType: customer.customerType,
    fields: definitions.map(toAccountCustomerField),
    values: Object.fromEntries(
      definitions.flatMap((definition) => {
        const value = stored[definition.id];
        return value ? [[definition.id, value]] : [];
      }),
    ),
    profileFields,
    profile:
      profileFields.length > 0
        ? pickCustomerProfileValues(customer, profileFields)
        : NO_CUSTOMER_PROFILE_VALUES,
    customerLayout: toCustomerExtraLayout(
      resolveStoreCustomerFormLayout({
        settings: params.settings,
        scope: "customer",
        definitions,
      }),
      { profileFields, customerFields: definitions },
    ),
  };
}
