import {
  customerFieldDefinitions,
  customerFieldTargets,
  customerFieldValues,
  customers,
  db,
} from "@louez/db";
import type { Transaction } from "@louez/db";
import {
  CUSTOMER_FIELD_FORMATS,
  type CustomerFieldDefinition,
  type CustomerFieldFormat,
  type CustomerFieldScope,
  type CustomerFieldTarget,
  type CustomerFieldType,
  type CustomerFieldValues,
} from "@louez/types";
import { toCustomerFieldSearchValue } from "@louez/validations";
import { and, asc, count, eq, inArray, ne, sql } from "drizzle-orm";

type Executor = typeof db | Transaction;

/** Types worth finding a customer by: an identifier, a number, a phone, an e-mail. */
const SEARCHABLE_TYPES: readonly CustomerFieldType[] = ["text", "number", "phone", "email"];

const definitionColumns = {
  id: customerFieldDefinitions.id,
  key: customerFieldDefinitions.key,
  label: customerFieldDefinitions.label,
  type: customerFieldDefinitions.type,
  format: customerFieldDefinitions.format,
  options: customerFieldDefinitions.options,
  unit: customerFieldDefinitions.unit,
  helpText: customerFieldDefinitions.helpText,
  section: customerFieldDefinitions.section,
  position: customerFieldDefinitions.position,
  width: customerFieldDefinitions.width,
  appliesTo: customerFieldDefinitions.appliesTo,
  isRequired: customerFieldDefinitions.isRequired,
  isSensitive: customerFieldDefinitions.isSensitive,
  showOnContract: customerFieldDefinitions.showOnContract,
  isSearchable: customerFieldDefinitions.isSearchable,
  showInList: customerFieldDefinitions.showInList,
  templateKey: customerFieldDefinitions.templateKey,
  isActive: customerFieldDefinitions.isActive,
  scope: customerFieldDefinitions.scope,
  collectMode: customerFieldDefinitions.collectMode,
  targetMode: customerFieldDefinitions.targetMode,
  customerEditable: customerFieldDefinitions.customerEditable,
};

const isKnownFormat = (value: string | null): value is CustomerFieldFormat =>
  CUSTOMER_FIELD_FORMATS.some((format) => format === value);

/** Targets of the given definitions, keyed by definition id. */
async function listTargetsByDefinition(
  storeId: string,
  definitionIds: readonly string[],
  executor: Executor,
): Promise<Map<string, CustomerFieldTarget[]>> {
  const byDefinition = new Map<string, CustomerFieldTarget[]>();
  if (definitionIds.length === 0) return byDefinition;

  const rows = await executor
    .select({
      definitionId: customerFieldTargets.definitionId,
      type: customerFieldTargets.targetType,
      id: customerFieldTargets.targetId,
    })
    .from(customerFieldTargets)
    .where(
      and(
        eq(customerFieldTargets.storeId, storeId),
        inArray(customerFieldTargets.definitionId, [...definitionIds]),
      ),
    )
    .orderBy(asc(customerFieldTargets.createdAt), asc(customerFieldTargets.id));
  for (const row of rows) {
    byDefinition.set(row.definitionId, [
      ...(byDefinition.get(row.definitionId) ?? []),
      { type: row.type, id: row.id },
    ]);
  }
  return byDefinition;
}

/**
 * The store's field definitions with their targets, by position: the
 * layout's order among custom fields (`resolveCustomerFormLayout` places the
 * Louez fields among them). `scope` is explicit on purpose: the customer
 * record, its search, exports, AI and MCP read `customer` only; item-scope
 * fields belong to the units of a reservation.
 */
export async function listCustomerFieldDefinitions(
  storeId: string,
  options: { activeOnly?: boolean; scope: CustomerFieldScope | "all" },
  executor: Executor = db,
): Promise<CustomerFieldDefinition[]> {
  const rows = await executor
    .select(definitionColumns)
    .from(customerFieldDefinitions)
    .where(
      and(
        eq(customerFieldDefinitions.storeId, storeId),
        ...(options.activeOnly ? [eq(customerFieldDefinitions.isActive, true)] : []),
        ...(options.scope === "all" ? [] : [eq(customerFieldDefinitions.scope, options.scope)]),
      ),
    )
    .orderBy(asc(customerFieldDefinitions.position), asc(customerFieldDefinitions.label));

  const targets = await listTargetsByDefinition(
    storeId,
    rows.map((row) => row.id),
    executor,
  );

  // The column is a plain varchar so a format can be retired in code without a migration.
  return rows.map((row) => ({
    ...row,
    format: isKnownFormat(row.format) ? row.format : null,
    targets: targets.get(row.id) ?? [],
  }));
}

/** How many customers hold a value, per definition. Drives "archive rather than delete". */
export async function countCustomerFieldValues(storeId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ definitionId: customerFieldValues.definitionId, total: count() })
    .from(customerFieldValues)
    .where(eq(customerFieldValues.storeId, storeId))
    .groupBy(customerFieldValues.definitionId);
  return new Map(rows.map((row) => [row.definitionId, row.total]));
}

export async function getCustomerFieldValues(
  storeId: string,
  customerId: string,
  executor: Executor = db,
): Promise<CustomerFieldValues> {
  const rows = await executor
    .select({ definitionId: customerFieldValues.definitionId, value: customerFieldValues.value })
    .from(customerFieldValues)
    .where(
      and(eq(customerFieldValues.storeId, storeId), eq(customerFieldValues.customerId, customerId)),
    );
  return Object.fromEntries(rows.map((row) => [row.definitionId, row.value]));
}

/** Values of several customers at once, for list columns. */
export async function getCustomerFieldValuesByCustomer(
  storeId: string,
  customerIds: readonly string[],
  definitionIds: readonly string[],
): Promise<Map<string, CustomerFieldValues>> {
  const byCustomer = new Map<string, CustomerFieldValues>();
  if (customerIds.length === 0 || definitionIds.length === 0) return byCustomer;

  const rows = await db
    .select({
      customerId: customerFieldValues.customerId,
      definitionId: customerFieldValues.definitionId,
      value: customerFieldValues.value,
    })
    .from(customerFieldValues)
    .where(
      and(
        eq(customerFieldValues.storeId, storeId),
        inArray(customerFieldValues.customerId, [...customerIds]),
        inArray(customerFieldValues.definitionId, [...definitionIds]),
      ),
    );
  for (const row of rows) {
    byCustomer.set(row.customerId, {
      ...byCustomer.get(row.customerId),
      [row.definitionId]: row.value,
    });
  }
  return byCustomer;
}

type SaveMode = "overwrite" | "fillEmpty";

export interface CustomerFieldValuesSavePlan {
  /** Definitions whose stored value is deleted. */
  cleared: string[];
  upserts: { definitionId: string; value: string; searchValue: string | null }[];
  /** False: an upsert landing on a value already on file keeps that value. */
  replaceExisting: boolean;
}

/**
 * What a save writes, decided before any SQL. Definitions outside
 * `definitions` are ignored, so a caller can never write into another
 * store's field.
 *
 * - `overwrite` (default): an empty string clears the value, anything else
 *   replaces what is on file.
 * - `fillEmpty`: only values the customer does not hold yet are written;
 *   nothing is cleared or replaced. A checkout by someone who is not signed in
 *   must never overwrite what another person typed under that e-mail.
 */
export function planCustomerFieldValuesSave(params: {
  values: CustomerFieldValues;
  definitions: readonly Pick<CustomerFieldDefinition, "id" | "type">[];
  mode?: SaveMode;
}): CustomerFieldValuesSavePlan {
  const fillEmpty = params.mode === "fillEmpty";
  const typeById = new Map(
    params.definitions.map((definition) => [definition.id, definition.type]),
  );
  const entries = Object.entries(params.values).filter(([definitionId]) =>
    typeById.has(definitionId),
  );

  return {
    cleared: fillEmpty
      ? []
      : entries.filter(([, value]) => value === "").map(([definitionId]) => definitionId),
    upserts: entries.flatMap(([definitionId, value]) => {
      if (value === "") return [];
      const type = typeById.get(definitionId);
      const searchValue =
        type && SEARCHABLE_TYPES.includes(type) ? toCustomerFieldSearchValue(value) || null : null;
      return [{ definitionId, value, searchValue }];
    }),
    replaceExisting: !fillEmpty,
  };
}

/** Writes already-validated values following `planCustomerFieldValuesSave`. */
export async function saveCustomerFieldValues(
  tx: Transaction,
  params: {
    storeId: string;
    customerId: string;
    values: CustomerFieldValues;
    definitions: readonly Pick<CustomerFieldDefinition, "id" | "type">[];
    mode?: SaveMode;
  },
): Promise<void> {
  const plan = planCustomerFieldValuesSave(params);

  if (plan.cleared.length > 0) {
    await tx
      .delete(customerFieldValues)
      .where(
        and(
          eq(customerFieldValues.storeId, params.storeId),
          eq(customerFieldValues.customerId, params.customerId),
          inArray(customerFieldValues.definitionId, plan.cleared),
        ),
      );
  }

  // One upsert per value: a record carries a few dozen fields at most, and the
  // explicit `set` avoids MySQL's deprecated VALUES() in a multi-row upsert.
  for (const { definitionId, value, searchValue } of plan.upserts) {
    await tx
      .insert(customerFieldValues)
      .values({
        storeId: params.storeId,
        customerId: params.customerId,
        definitionId,
        value,
        searchValue,
      })
      .onDuplicateKeyUpdate({
        // A row only exists for a non-empty value, so without `replaceExisting`
        // the duplicate key means "already on file" and the value stays.
        set: plan.replaceExisting
          ? { value, searchValue, updatedAt: new Date() }
          : { value: sql`${customerFieldValues.value}` },
      });
  }
}

export interface CustomerFieldDuplicate {
  customerId: string;
  firstName: string;
  lastName: string;
  companyName: string | null;
}

/** Other customers of the store already holding this exact value for this field. */
export async function findCustomerFieldDuplicates(params: {
  storeId: string;
  definitionId: string;
  value: string;
  excludeCustomerId?: string;
}): Promise<CustomerFieldDuplicate[]> {
  const searchValue = toCustomerFieldSearchValue(params.value);
  if (!searchValue) return [];

  return db
    .select({
      customerId: customers.id,
      firstName: customers.firstName,
      lastName: customers.lastName,
      companyName: customers.companyName,
    })
    .from(customerFieldValues)
    .innerJoin(
      customers,
      and(eq(customers.id, customerFieldValues.customerId), eq(customers.storeId, params.storeId)),
    )
    .where(
      and(
        eq(customerFieldValues.storeId, params.storeId),
        eq(customerFieldValues.searchValue, searchValue),
        eq(customerFieldValues.definitionId, params.definitionId),
        ...(params.excludeCustomerId
          ? [ne(customerFieldValues.customerId, params.excludeCustomerId)]
          : []),
      ),
    )
    .limit(3);
}

/**
 * Customers whose searchable custom fields start with the query, as a
 * correlated EXISTS to plug into the customer list filter.
 */
export function customerFieldSearchCondition(storeId: string, query: string) {
  const searchValue = toCustomerFieldSearchValue(query);
  if (searchValue.length < 3) return null;

  return sql`EXISTS (
    SELECT 1 FROM ${customerFieldValues}
    INNER JOIN ${customerFieldDefinitions}
      ON ${customerFieldDefinitions.id} = ${customerFieldValues.definitionId}
    WHERE ${customerFieldValues.storeId} = ${storeId}
      AND ${customerFieldValues.customerId} = ${customers.id}
      AND ${customerFieldValues.searchValue} LIKE ${`${searchValue}%`}
      AND ${customerFieldDefinitions.isSearchable} = true
      AND ${customerFieldDefinitions.isActive} = true
      AND ${customerFieldDefinitions.scope} = 'customer'
  )`;
}
