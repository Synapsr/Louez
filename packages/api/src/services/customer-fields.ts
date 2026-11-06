import { customerFieldDefinitions, customerFieldValues, customers, db } from "@louez/db";
import type { Transaction } from "@louez/db";
import {
  CUSTOMER_FIELD_FORMATS,
  type CustomerFieldDefinition,
  type CustomerFieldFormat,
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
  appliesTo: customerFieldDefinitions.appliesTo,
  isRequired: customerFieldDefinitions.isRequired,
  isSensitive: customerFieldDefinitions.isSensitive,
  showOnContract: customerFieldDefinitions.showOnContract,
  isSearchable: customerFieldDefinitions.isSearchable,
  showInList: customerFieldDefinitions.showInList,
  templateKey: customerFieldDefinitions.templateKey,
  isActive: customerFieldDefinitions.isActive,
};

const isKnownFormat = (value: string | null): value is CustomerFieldFormat =>
  CUSTOMER_FIELD_FORMATS.some((format) => format === value);

export async function listCustomerFieldDefinitions(
  storeId: string,
  options: { activeOnly?: boolean } = {},
  executor: Executor = db,
): Promise<CustomerFieldDefinition[]> {
  const rows = await executor
    .select(definitionColumns)
    .from(customerFieldDefinitions)
    .where(
      and(
        eq(customerFieldDefinitions.storeId, storeId),
        ...(options.activeOnly ? [eq(customerFieldDefinitions.isActive, true)] : []),
      ),
    )
    .orderBy(asc(customerFieldDefinitions.position), asc(customerFieldDefinitions.label));

  // The column is a plain varchar so a format can be retired in code without a migration.
  return rows.map((row) => ({ ...row, format: isKnownFormat(row.format) ? row.format : null }));
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

/**
 * Writes already-validated values: an empty string clears the value, anything
 * else is upserted. Definitions outside `definitions` are ignored, so a caller
 * can never write into another store's field.
 */
export async function saveCustomerFieldValues(
  tx: Transaction,
  params: {
    storeId: string;
    customerId: string;
    values: CustomerFieldValues;
    definitions: readonly Pick<CustomerFieldDefinition, "id" | "type">[];
  },
): Promise<void> {
  const typeById = new Map(
    params.definitions.map((definition) => [definition.id, definition.type]),
  );
  const entries = Object.entries(params.values).filter(([definitionId]) =>
    typeById.has(definitionId),
  );

  const cleared = entries.filter(([, value]) => value === "").map(([definitionId]) => definitionId);
  if (cleared.length > 0) {
    await tx
      .delete(customerFieldValues)
      .where(
        and(
          eq(customerFieldValues.storeId, params.storeId),
          eq(customerFieldValues.customerId, params.customerId),
          inArray(customerFieldValues.definitionId, cleared),
        ),
      );
  }

  // One upsert per value: a record carries a few dozen fields at most, and the
  // explicit `set` avoids MySQL's deprecated VALUES() in a multi-row upsert.
  for (const [definitionId, value] of entries) {
    if (value === "") continue;
    const type = typeById.get(definitionId);
    const searchValue =
      type && SEARCHABLE_TYPES.includes(type) ? toCustomerFieldSearchValue(value) || null : null;
    await tx
      .insert(customerFieldValues)
      .values({
        storeId: params.storeId,
        customerId: params.customerId,
        definitionId,
        value,
        searchValue,
      })
      .onDuplicateKeyUpdate({ set: { value, searchValue, updatedAt: new Date() } });
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
  )`;
}
