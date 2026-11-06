import {
  customerFieldValues,
  customers,
  db,
  importRecords,
  importRows,
  importRuns,
  reservations,
} from "@louez/db";
import type { Transaction } from "@louez/db";
import type {
  CustomerFieldDefinition,
  CustomerFieldValues,
  ImportColumnMapping,
  ImportDuplicateStrategy,
  ImportRunCounts,
  ImportRunStatus,
} from "@louez/types";
import {
  IMPORT_LIMITS,
  type CustomerImportRowInput,
  type CustomerImportRowResult,
  detectDateOrder,
  getCustomerImportIdentityKey,
  suggestCustomerImportMapping,
  transformCustomerImportRow,
} from "@louez/validations";
import { and, asc, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { ApiServiceError } from "./errors";
import {
  getCustomerFieldValues,
  getCustomerFieldValuesByCustomer,
  listCustomerFieldDefinitions,
  saveCustomerFieldValues,
} from "./customer-fields";

const CHUNK_SIZE = 100;
const PREVIEW_SAMPLE = 50;
/** A record edited after the import is no longer the import's to undo. */
const UNTOUCHED_TOLERANCE_MS = 5000;

export const EMPTY_IMPORT_COUNTS: ImportRunCounts = {
  total: 0,
  created: 0,
  updated: 0,
  skipped: 0,
  errors: 0,
};

export type ImportPlannedAction = "create" | "update" | "skip" | "error";

export interface ImportPreviewRow {
  rowIndex: number;
  payload: Record<string, string>;
  action: ImportPlannedAction;
  /** Why a row is skipped or refused, as codes the client translates. */
  reasons: string[];
  warnings: string[];
}

export async function getOwnedRun(storeId: string, runId: string) {
  const run = await db.query.importRuns.findFirst({
    where: and(eq(importRuns.id, runId), eq(importRuns.storeId, storeId)),
  });
  if (!run) throw new ApiServiceError("NOT_FOUND", "errors.import.runNotFound");
  return run;
}

export async function createCustomerImportRun(params: {
  storeId: string;
  userId: string | null;
  source: string;
  fileName: string | null;
  columns: string[];
}) {
  const definitions = await listCustomerFieldDefinitions(params.storeId, { activeOnly: true });
  const mapping = suggestCustomerImportMapping(params.columns, definitions);
  const [run] = await db
    .insert(importRuns)
    .values({
      storeId: params.storeId,
      entityType: "customers",
      source: params.source,
      fileName: params.fileName,
      mapping,
      counts: EMPTY_IMPORT_COUNTS,
      createdByUserId: params.userId,
    })
    .$returningId();
  return { id: run.id, mapping };
}

export async function stageImportRows(params: {
  storeId: string;
  runId: string;
  offset: number;
  rows: Record<string, string>[];
}) {
  const run = await getOwnedRun(params.storeId, params.runId);
  if (run.status !== "draft") throw new ApiServiceError("BAD_REQUEST", "errors.import.notEditable");
  if (params.offset + params.rows.length > IMPORT_LIMITS.rows) {
    throw new ApiServiceError("BAD_REQUEST", "errors.import.tooManyRows");
  }

  await db.transaction(async (tx) => {
    for (const [index, payload] of params.rows.entries()) {
      await tx
        .insert(importRows)
        .values({
          runId: run.id,
          storeId: params.storeId,
          rowIndex: params.offset + index,
          payload,
        })
        .onDuplicateKeyUpdate({ set: { payload, updatedAt: new Date() } });
    }
  });

  const [{ total }] = await db
    .select({ total: count() })
    .from(importRows)
    .where(eq(importRows.runId, run.id));
  return { staged: total };
}

export async function updateImportRun(params: {
  storeId: string;
  runId: string;
  mapping?: ImportColumnMapping;
  duplicateStrategy?: ImportDuplicateStrategy;
}) {
  const run = await getOwnedRun(params.storeId, params.runId);
  if (run.status !== "draft") throw new ApiServiceError("BAD_REQUEST", "errors.import.notEditable");
  await db
    .update(importRuns)
    .set({
      ...(params.mapping ? { mapping: params.mapping } : {}),
      ...(params.duplicateStrategy ? { duplicateStrategy: params.duplicateStrategy } : {}),
      updatedAt: new Date(),
    })
    .where(eq(importRuns.id, run.id));
}

export async function updateImportRow(params: {
  storeId: string;
  runId: string;
  rowIndex: number;
  payload: Record<string, string>;
}) {
  const run = await getOwnedRun(params.storeId, params.runId);
  if (run.status !== "draft") throw new ApiServiceError("BAD_REQUEST", "errors.import.notEditable");
  await db
    .update(importRows)
    .set({ payload: params.payload, updatedAt: new Date() })
    .where(and(eq(importRows.runId, run.id), eq(importRows.rowIndex, params.rowIndex)));
}

interface ImportEvaluationContext {
  definitions: CustomerFieldDefinition[];
  mapping: ImportColumnMapping;
  defaultCountry: string;
  dateOrder: "dmy" | "mdy";
}

/** Everything a row needs to be read, worked out once per run from its mapping and its rows. */
async function buildEvaluationContext(
  storeId: string,
  run: { id: string; mapping: ImportColumnMapping | null },
  defaultCountry: string,
): Promise<ImportEvaluationContext> {
  const mapping = run.mapping ?? {};
  const definitions = await listCustomerFieldDefinitions(storeId, { activeOnly: true });
  const birthDateColumn = Object.entries(mapping).find(
    ([, target]) => target === "field:birthDate",
  )?.[0];

  let dateOrder: "dmy" | "mdy" = "dmy";
  if (birthDateColumn) {
    const sample = await db
      .select({ payload: importRows.payload })
      .from(importRows)
      .where(eq(importRows.runId, run.id))
      .orderBy(asc(importRows.rowIndex))
      .limit(200);
    dateOrder = detectDateOrder(sample.map((row) => row.payload[birthDateColumn] ?? ""));
  }
  return { definitions, mapping, defaultCountry, dateOrder };
}

const evaluate = (payload: Record<string, string>, context: ImportEvaluationContext) =>
  transformCustomerImportRow(payload, context);

/**
 * What the import would do, without writing anything: each row is read, then
 * matched against the store's customers by e-mail and against earlier imports
 * of the same source by its external id.
 */
export async function previewCustomerImport(params: {
  storeId: string;
  runId: string;
  defaultCountry: string;
  remainingQuota: number | null;
}) {
  const run = await getOwnedRun(params.storeId, params.runId);
  const context = await buildEvaluationContext(params.storeId, run, params.defaultCountry);

  const rows = await db
    .select({ rowIndex: importRows.rowIndex, payload: importRows.payload })
    .from(importRows)
    .where(eq(importRows.runId, run.id))
    .orderBy(asc(importRows.rowIndex));

  const evaluated = rows.map((row) => ({ ...row, result: evaluate(row.payload, context) }));
  const inputs = evaluated.flatMap((row) => (row.result.input ? [row.result.input] : []));
  const emails = [...new Set(inputs.flatMap((input) => (input.email ? [input.email] : [])))];
  const phones = [
    ...new Set(inputs.flatMap((input) => (!input.email && input.phone ? [input.phone] : []))),
  ];

  // Existing customers by the same identity key the import writes with.
  const existing = new Map<string, ExistingCustomer>();
  const lookups = [
    ...chunk(emails).map((batch) => inArray(customers.email, batch)),
    ...chunk(phones).map((batch) => inArray(customers.phone, batch)),
  ];
  for (const condition of lookups) {
    const found = await db
      .select({ email: customers.email, ...existingCustomerColumns })
      .from(customers)
      .where(and(eq(customers.storeId, params.storeId), condition));
    for (const { email, ...customer } of found) {
      if (email) existing.set(`email:${email.toLowerCase()}`, customer);
      const byPhone = getCustomerImportIdentityKey({
        email: null,
        phone: customer.phone,
        lastName: customer.lastName,
      });
      if (byPhone) existing.set(byPhone, customer);
    }
  }
  const existingValues = await getCustomerFieldValuesByCustomer(
    params.storeId,
    [...existing.values()].map((customer) => customer.id),
    context.definitions.map((definition) => definition.id),
  );

  const seen = new Set<string>();
  let quota = params.remainingQuota;
  const counts = { create: 0, update: 0, skip: 0, error: 0 };
  const samples: Record<ImportPlannedAction, ImportPreviewRow[]> = {
    create: [],
    update: [],
    skip: [],
    error: [],
  };

  for (const row of evaluated) {
    const { input, errors, warnings } = row.result;
    let action: ImportPlannedAction;
    let reasons: string[] = [];

    const identity = input ? getCustomerImportIdentityKey(input) : null;

    if (!input || !identity) {
      action = "error";
      reasons = errors.map((error) => error.code);
    } else if (seen.has(identity)) {
      action = "skip";
      reasons = ["duplicateInFile"];
    } else if (existing.has(identity)) {
      const current = existing.get(identity);
      const hasChanges =
        current !== undefined &&
        run.duplicateStrategy !== "skip" &&
        (Object.keys(resolveNativeChanges(current, input, run.duplicateStrategy)).length > 0 ||
          Object.keys(
            resolveCustomChanges(
              existingValues.get(current.id) ?? {},
              input.customFields,
              run.duplicateStrategy,
            ),
          ).length > 0);
      action = hasChanges ? "update" : "skip";
      if (action === "skip") {
        reasons = [run.duplicateStrategy === "skip" ? "alreadyExists" : "nothingToUpdate"];
      }
    } else if (quota !== null && quota <= 0) {
      action = "skip";
      reasons = ["planLimit"];
    } else {
      action = "create";
      if (quota !== null) quota -= 1;
    }
    if (identity) seen.add(identity);

    counts[action] += 1;
    if (samples[action].length < PREVIEW_SAMPLE) {
      samples[action].push({
        rowIndex: row.rowIndex,
        payload: row.payload,
        action,
        reasons,
        warnings: warnings.map((warning) => warning.code),
      });
    }
  }

  return { total: rows.length, counts, samples, dateOrder: context.dateOrder };
}

export async function startCustomerImport(storeId: string, runId: string) {
  const run = await getOwnedRun(storeId, runId);
  if (run.status !== "draft") throw new ApiServiceError("BAD_REQUEST", "errors.import.notEditable");
  const [{ total }] = await db
    .select({ total: count() })
    .from(importRows)
    .where(eq(importRows.runId, run.id));
  if (total === 0) throw new ApiServiceError("BAD_REQUEST", "errors.import.empty");

  await db
    .update(importRuns)
    .set({
      status: "running",
      startedAt: new Date(),
      counts: { ...EMPTY_IMPORT_COUNTS, total },
      updatedAt: new Date(),
    })
    .where(eq(importRuns.id, run.id));
}

// An import never changes whether an existing customer is a person or a company.
const NATIVE_COLUMNS = [
  "firstName",
  "lastName",
  "phone",
  "companyName",
  "companyNumber",
  "vatNumber",
  "address",
  "postalCode",
  "city",
  "country",
  "birthDate",
  "notes",
] as const;

type NativeColumn = (typeof NATIVE_COLUMNS)[number];

/** What is read of an existing customer to decide what an import may write on it. */
const existingCustomerColumns = {
  id: customers.id,
  firstName: customers.firstName,
  lastName: customers.lastName,
  phone: customers.phone,
  companyName: customers.companyName,
  companyNumber: customers.companyNumber,
  vatNumber: customers.vatNumber,
  address: customers.address,
  postalCode: customers.postalCode,
  city: customers.city,
  country: customers.country,
  birthDate: customers.birthDate,
  notes: customers.notes,
};

const NULLABLE_NATIVE_COLUMNS = [
  "phone",
  "companyName",
  "companyNumber",
  "vatNumber",
  "address",
  "postalCode",
  "city",
  "country",
  "birthDate",
  "notes",
] as const;

type NullableNativeColumn = (typeof NULLABLE_NATIVE_COLUMNS)[number];
type ExistingCustomer = Record<NativeColumn, string | null> & { id: string };

const chunk = <T>(items: readonly T[], size = 500): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );

const isBlank = (value: string | null | undefined) =>
  value === null || value === undefined || value === "";

/** The single row MySQL answers GET_LOCK with: 1 acquired, 0 held elsewhere, NULL on error. */
const lockRowsSchema = z.array(z.object({ acquired: z.coerce.number().nullable() }));

/** What an update overwrote, as stored on the staged row, so it can be put back. */
const previousValuesSchema = z.object({
  native: z.record(z.string(), z.string().nullable()).default({}),
  custom: z.record(z.string(), z.string()).default({}),
});

/**
 * The columns an import may write on an existing customer. "Fill empty" never
 * touches a value someone already entered; "overwrite" replaces only what the
 * file actually provides, so a column absent from the file blanks nothing.
 */
/** Custom values an import may write on an existing customer, under the same rule as the native columns. */
function resolveCustomChanges(
  current: CustomerFieldValues,
  incoming: CustomerFieldValues,
  strategy: ImportDuplicateStrategy,
): CustomerFieldValues {
  return Object.fromEntries(
    Object.entries(incoming).filter(
      ([definitionId, value]) =>
        value !== current[definitionId] &&
        (strategy === "overwrite" || isBlank(current[definitionId])),
    ),
  );
}

function resolveNativeChanges(
  existing: ExistingCustomer,
  input: CustomerImportRowInput,
  strategy: ImportDuplicateStrategy,
) {
  const changes: Partial<Record<NativeColumn, string>> = {};
  for (const column of NATIVE_COLUMNS) {
    const incoming = input[column];
    if (isBlank(incoming) || incoming === existing[column]) continue;
    if (strategy === "overwrite" || isBlank(existing[column])) changes[column] = incoming ?? "";
  }
  return changes;
}

async function writeRow(
  tx: Transaction,
  params: {
    storeId: string;
    run: { id: string; source: string; duplicateStrategy: ImportDuplicateStrategy };
    input: CustomerImportRowInput;
    definitions: CustomerFieldDefinition[];
    canCreate: boolean;
  },
): Promise<{
  status: "created" | "updated" | "skipped";
  entityId: string | null;
  reason?: string;
  previousValues?: Record<string, unknown>;
}> {
  const { storeId, run, input, definitions } = params;

  const provenance = input.externalId
    ? await tx.query.importRecords.findFirst({
        columns: { entityId: true },
        where: and(
          eq(importRecords.storeId, storeId),
          eq(importRecords.source, run.source),
          eq(importRecords.entityType, "customers"),
          eq(importRecords.externalId, input.externalId),
        ),
      })
    : undefined;

  // Same identity as the preview: the source's id, else the e-mail, else phone and last name.
  const identity = provenance
    ? eq(customers.id, provenance.entityId)
    : input.email
      ? eq(customers.email, input.email)
      : input.phone
        ? and(
            eq(customers.phone, input.phone),
            sql`LOWER(${customers.lastName}) = ${input.lastName.trim().toLowerCase()}`,
          )
        : null;
  if (!identity) return { status: "skipped", entityId: null, reason: "contactRequired" };

  const [existing] = await tx
    .select(existingCustomerColumns)
    .from(customers)
    .where(and(eq(customers.storeId, storeId), identity))
    .limit(1)
    .for("update");

  const recordProvenance = async (entityId: string) => {
    if (!input.externalId) return;
    await tx
      .insert(importRecords)
      .values({
        storeId,
        source: run.source,
        entityType: "customers",
        externalId: input.externalId,
        entityId,
        runId: run.id,
      })
      .onDuplicateKeyUpdate({ set: { entityId, runId: run.id } });
  };

  if (!existing) {
    if (!params.canCreate) return { status: "skipped", entityId: null, reason: "planLimit" };
    const { externalId: _externalId, customFields, ...columns } = input;
    // Stamped by the application clock, like the staged row: undoing the import compares the
    // two, and a database default would bring the database's timezone into that comparison.
    const now = new Date();
    const [created] = await tx
      .insert(customers)
      .values({ storeId, ...columns, createdVia: "import", createdAt: now, updatedAt: now })
      .$returningId();
    await saveCustomerFieldValues(tx, {
      storeId,
      customerId: created.id,
      values: customFields,
      definitions,
    });
    await recordProvenance(created.id);
    return { status: "created", entityId: created.id };
  }

  if (run.duplicateStrategy === "skip") {
    return { status: "skipped", entityId: existing.id, reason: "alreadyExists" };
  }

  const nativeChanges = resolveNativeChanges(existing, input, run.duplicateStrategy);
  const currentCustom = await getCustomerFieldValues(storeId, existing.id, tx);
  const customChanges = resolveCustomChanges(
    currentCustom,
    input.customFields,
    run.duplicateStrategy,
  );

  if (Object.keys(nativeChanges).length === 0 && Object.keys(customChanges).length === 0) {
    await recordProvenance(existing.id);
    return { status: "skipped", entityId: existing.id, reason: "nothingToUpdate" };
  }

  if (Object.keys(nativeChanges).length > 0) {
    await tx
      .update(customers)
      .set({ ...nativeChanges, updatedAt: new Date() })
      .where(and(eq(customers.id, existing.id), eq(customers.storeId, storeId)));
  }
  await saveCustomerFieldValues(tx, {
    storeId,
    customerId: existing.id,
    values: customChanges,
    definitions,
  });
  await recordProvenance(existing.id);

  return {
    status: "updated",
    entityId: existing.id,
    previousValues: {
      native: Object.fromEntries(
        NATIVE_COLUMNS.filter((column) => column in nativeChanges).map((column) => [
          column,
          existing[column],
        ]),
      ),
      custom: Object.fromEntries(
        Object.keys(customChanges).map((definitionId) => [
          definitionId,
          currentCustom[definitionId] ?? "",
        ]),
      ),
    },
  };
}

/**
 * Processes the next pending rows of a running import and reports progress.
 * Each row is its own transaction: one bad row never rolls back its neighbours,
 * and a call interrupted half-way resumes where it stopped.
 */
/**
 * Runs `work` as the only worker of a run. A second tab, a double click or the
 * cron picking the run up must not read the same pending rows: the named lock
 * lives on its own pinned connection for the duration of the chunk.
 */
export async function withImportRunLock<T>(
  params: { storeId: string; runId: string },
  work: () => Promise<T>,
): Promise<T | { status: ImportRunStatus; counts: ImportRunCounts }> {
  return db.transaction(async (lockConnection) => {
    const lockName = `louez:import:${params.runId}`;
    const [rows] = await lockConnection.execute(sql`SELECT GET_LOCK(${lockName}, 0) AS acquired`);
    const lock = lockRowsSchema.safeParse(rows);
    if (!lock.success || lock.data[0]?.acquired !== 1) {
      const busy = await getOwnedRun(params.storeId, params.runId);
      return { status: busy.status, counts: busy.counts ?? EMPTY_IMPORT_COUNTS };
    }
    try {
      return await work();
    } finally {
      await lockConnection.execute(sql`SELECT RELEASE_LOCK(${lockName})`);
    }
  });
}

export async function processCustomerImportChunk(params: {
  storeId: string;
  runId: string;
  defaultCountry: string;
  remainingQuota: number | null;
}) {
  return withImportRunLock(params, () => processLockedChunk(params));
}

async function processLockedChunk(params: {
  storeId: string;
  runId: string;
  defaultCountry: string;
  remainingQuota: number | null;
}) {
  const run = await getOwnedRun(params.storeId, params.runId);
  if (run.status !== "running")
    return { status: run.status, counts: run.counts ?? EMPTY_IMPORT_COUNTS };

  const context = await buildEvaluationContext(params.storeId, run, params.defaultCountry);
  const pending = await db
    .select({ id: importRows.id, payload: importRows.payload })
    .from(importRows)
    .where(and(eq(importRows.runId, run.id), eq(importRows.status, "pending")))
    .orderBy(asc(importRows.rowIndex))
    .limit(CHUNK_SIZE);

  const counts = { ...(run.counts ?? EMPTY_IMPORT_COUNTS) };
  let quota = params.remainingQuota;

  for (const row of pending) {
    const result: CustomerImportRowResult = evaluate(row.payload, context);
    if (!result.input) {
      counts.errors += 1;
      await db
        .update(importRows)
        .set({ status: "error", errors: result.errors, updatedAt: new Date() })
        .where(eq(importRows.id, row.id));
      continue;
    }

    const input = result.input;
    try {
      const outcome = await db.transaction((tx) =>
        writeRow(tx, {
          storeId: params.storeId,
          run,
          input,
          definitions: context.definitions,
          canCreate: quota === null || quota > 0,
        }),
      );
      if (outcome.status === "created" && quota !== null) quota -= 1;
      counts[outcome.status] += 1;
      await db
        .update(importRows)
        .set({
          status: outcome.status,
          entityId: outcome.entityId,
          errors: outcome.reason ? [{ field: null, code: outcome.reason }] : null,
          previousValues: outcome.previousValues ?? null,
          updatedAt: new Date(),
        })
        .where(eq(importRows.id, row.id));
    } catch {
      counts.errors += 1;
      await db
        .update(importRows)
        .set({
          status: "error",
          errors: [{ field: null, code: "writeFailed" }],
          updatedAt: new Date(),
        })
        .where(eq(importRows.id, row.id));
    }
  }

  const [{ remaining }] = await db
    .select({ remaining: count() })
    .from(importRows)
    .where(and(eq(importRows.runId, run.id), eq(importRows.status, "pending")));
  const done = remaining === 0;

  await db
    .update(importRuns)
    .set({
      counts,
      status: done ? "completed" : "running",
      completedAt: done ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(importRuns.id, run.id));

  return { status: done ? ("completed" as const) : ("running" as const), counts };
}

/**
 * Undoes an import: customers it created are removed unless they have since
 * been given a reservation or edited, customers it updated get their previous
 * values back. What cannot be undone is left alone and counted.
 */
export async function revertCustomerImport(storeId: string, runId: string) {
  const run = await getOwnedRun(storeId, runId);
  if (run.status !== "completed")
    throw new ApiServiceError("BAD_REQUEST", "errors.import.notRevertible");

  const rows = await db
    .select({
      status: importRows.status,
      entityId: importRows.entityId,
      previousValues: importRows.previousValues,
      processedAt: importRows.updatedAt,
    })
    .from(importRows)
    .where(and(eq(importRows.runId, run.id), inArray(importRows.status, ["created", "updated"])));

  let reverted = 0;
  let kept = 0;

  for (const row of rows) {
    if (!row.entityId) continue;
    const entityId = row.entityId;
    const done = await db.transaction(async (tx) => {
      const [customer] = await tx
        .select({ id: customers.id, updatedAt: customers.updatedAt })
        .from(customers)
        .where(and(eq(customers.id, entityId), eq(customers.storeId, storeId)))
        .for("update");
      if (!customer) return false;

      if (row.status === "created") {
        const [{ total }] = await tx
          .select({ total: count() })
          .from(reservations)
          .where(eq(reservations.customerId, entityId));
        const touched =
          customer.updatedAt.getTime() > row.processedAt.getTime() + UNTOUCHED_TOLERANCE_MS;
        if (total > 0 || touched) return false;
        await tx
          .delete(customerFieldValues)
          .where(
            and(
              eq(customerFieldValues.storeId, storeId),
              eq(customerFieldValues.customerId, entityId),
            ),
          );
        await tx.delete(importRecords).where(eq(importRecords.entityId, entityId));
        await tx
          .delete(customers)
          .where(and(eq(customers.id, entityId), eq(customers.storeId, storeId)));
        return true;
      }

      const previous = previousValuesSchema.safeParse(row.previousValues ?? {});
      if (!previous.success) return false;
      const { custom } = previous.data;
      // Only columns an import may write are ever put back, whatever the stored JSON holds.
      const restored = previous.data.native;
      const native: Partial<Record<NullableNativeColumn, string | null>> = {};
      for (const column of NULLABLE_NATIVE_COLUMNS) {
        if (column in restored) native[column] = restored[column] ?? null;
      }
      // A name is never blank on a record, so it only comes back as a real value.
      const names = {
        ...(restored.firstName ? { firstName: restored.firstName } : {}),
        ...(restored.lastName ? { lastName: restored.lastName } : {}),
      };
      if (Object.keys(native).length > 0 || Object.keys(names).length > 0) {
        await tx
          .update(customers)
          .set({ ...native, ...names, updatedAt: new Date() })
          .where(and(eq(customers.id, entityId), eq(customers.storeId, storeId)));
      }
      const definitions = await listCustomerFieldDefinitions(storeId, {}, tx);
      await saveCustomerFieldValues(tx, {
        storeId,
        customerId: entityId,
        values: custom,
        definitions,
      });
      return true;
    });
    if (done) reverted += 1;
    else kept += 1;
  }

  await db
    .update(importRuns)
    .set({ status: "reverted", revertedAt: new Date(), updatedAt: new Date() })
    .where(eq(importRuns.id, run.id));

  return { reverted, kept };
}

export async function listImportRuns(storeId: string) {
  return db
    .select({
      id: importRuns.id,
      entityType: importRuns.entityType,
      source: importRuns.source,
      fileName: importRuns.fileName,
      status: importRuns.status,
      counts: importRuns.counts,
      createdAt: importRuns.createdAt,
      completedAt: importRuns.completedAt,
    })
    .from(importRuns)
    .where(and(eq(importRuns.storeId, storeId), ne(importRuns.status, "draft")))
    .orderBy(desc(importRuns.createdAt))
    .limit(50);
}

export async function getImportRun(storeId: string, runId: string) {
  const run = await getOwnedRun(storeId, runId);
  const [{ staged }] = await db
    .select({ staged: count() })
    .from(importRows)
    .where(eq(importRows.runId, run.id));
  return { ...run, staged };
}

/** Rows the import refused, with their original cells, for the merchant to fix and import again. */
export async function getImportErrorRows(storeId: string, runId: string) {
  const run = await getOwnedRun(storeId, runId);
  return db
    .select({
      rowIndex: importRows.rowIndex,
      payload: importRows.payload,
      errors: importRows.errors,
    })
    .from(importRows)
    .where(and(eq(importRows.runId, run.id), eq(importRows.status, "error")))
    .orderBy(asc(importRows.rowIndex));
}
