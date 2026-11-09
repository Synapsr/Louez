import {
  apiOperations,
  db,
  isTransactionInterrupted,
  retryTransactionOnDeadlock,
  runInApiOperation,
  type ApiOperationScope,
  type Transaction,
} from "@louez/db";
import { and, asc, eq, lt, min, sql } from "drizzle-orm";

import type { ScopedActor } from "./actor";
import { enqueueEffects, type ApiEffect } from "./effects";
import { isApiError, platformErrors } from "./errors";
import { sha256, stableStringify } from "./hash";

/** Header of an idempotency key. The MCP bridge maps its `idempotencyKey` argument onto it. */
export const IDEMPOTENCY_HEADER = "idempotency-key";
const MAX_IDEMPOTENCY_KEY_LENGTH = 100;

/**
 * How long a call may stay `running`. Past it, a retry is not told to wait:
 * the call is taken as lost, its outcome unknown, and it is never run again.
 */
export const OPERATION_LEASE_SECONDS = 300;

/**
 * How long a write's record is kept, from its last change: the log of what an
 * agent did that the privacy policy promises. Its result may hold personal
 * data.
 */
export const OPERATION_RETENTION_MONTHS = 12;
/**
 * The purge deletes this many days before the promised retention runs out,
 * so a backlog or a cron outage of up to a week still keeps the promise.
 */
const OPERATION_PURGE_MARGIN_DAYS = 7;
const PURGE_BATCH = 500;
const PURGE_BUDGET_MS = 5_000;

/** Filled by the operations middleware; a transport reads it after the call to hand out a receipt. */
export interface OperationReceipt {
  operationId?: string;
  replayed?: boolean;
}

// Dates and bigints survive the round trip through the JSON column, so a
// replayed result matches the procedure's output schema like the first one did.
function encodeResult(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, function replacer(this: Record<string, unknown>, key, entry) {
      const raw = this[key];
      if (raw instanceof Date) return { $date: raw.toISOString() };
      if (typeof raw === "bigint") return { $bigint: raw.toString() };
      return entry;
    }),
  );
}

function decodeResult(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value), (_key, entry) => {
    if (!entry || typeof entry !== "object" || Object.keys(entry).length !== 1) return entry;
    if (typeof entry.$date === "string") return new Date(entry.$date);
    if (typeof entry.$bigint === "string") return BigInt(entry.$bigint);
    return entry;
  });
}

/**
 * Runs one write through the API and records it.
 *
 * Every write gets a row: who (user, connection, client), how (transport),
 * what (procedure, target) and how it ended. That row is the audit trail.
 *
 * With an idempotency key, the row also makes the call safe to retry: the same
 * key with the same input returns the stored result without running again; the
 * same key with another input is refused; a call that arrives while the first
 * still runs is told to retry; a key whose call failed may run again; a key
 * whose outcome was lost (unknown, or running past its lease) never runs again.
 */
export async function runOperation<T>(
  params: {
    actor: ScopedActor;
    procedure: string;
    input: unknown;
    idempotencyKey: string | null;
    receipt?: OperationReceipt;
    /**
     * What is kept to replay: the result as the caller receives it, after the
     * output schema dropped what the contract does not show.
     */
    toStored?: (result: T) => Promise<unknown>;
    /**
     * The write sets a store up (platform/setup-analytics.ts): its handler
     * runs with a scope that marks the offline store whose row it locks.
     */
    marksSetup?: boolean;
    /**
     * Outbox rows that belong to the write's record rather than to its
     * business (the setup analytics), from the result as stored and what the
     * handler's scope saw. They are added with the record, inside a
     * savepoint: a failure of their own loses them, never the write. Not
     * added on a replay.
     */
    recordedEffects?: RecordedEffects;
    /** Hands the rows' ids to the app once committed (`ApiPorts.dispatchEffects`). */
    dispatchEffects?: (ids: readonly string[]) => void;
  },
  execute: () => Promise<T>,
): Promise<T> {
  const { actor, idempotencyKey } = params;
  if (
    idempotencyKey !== null &&
    (idempotencyKey.length === 0 || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH)
  ) {
    throw platformErrors.idempotencyConflict();
  }

  const inputHash = sha256(stableStringify(params.input ?? null));
  const actorKey = actor.credential.id ?? actor.credential.userId;
  const row = {
    storeId: actor.storeId,
    userId: actor.credential.userId,
    credentialKind: actor.credential.kind,
    credentialId: actor.credential.id,
    clientName: actor.credential.clientName,
    transport: actor.transport,
    procedure: params.procedure,
    actorKey,
    idempotencyKey,
    inputHash,
    status: "running" as const,
  };

  let operationId: string;
  if (idempotencyKey === null) {
    const [inserted] = await db.insert(apiOperations).values(row).$returningId();
    operationId = inserted.id;
  } else {
    const claimed = await claimIdempotencyKey({ ...row, idempotencyKey });
    if (claimed.kind === "replay") {
      if (params.receipt)
        Object.assign(params.receipt, { operationId: claimed.id, replayed: true });
      return decodeResult(claimed.result) as T;
    }
    operationId = claimed.id;
  }
  if (params.receipt) params.receipt.operationId = operationId;

  // What the handler's own transactions record about the write (setup marks,
  // a spent confirmation), through @louez/db.
  const scope: ApiOperationScope = {
    operationId,
    marksSetup: params.marksSetup ?? false,
    confirmed: false,
    active: true,
  };
  let result: T;
  try {
    result = await runInApiOperation(scope, execute);
  } catch (error) {
    await db
      .update(apiOperations)
      .set({
        status: "failed",
        // A refused preview commits its own transaction, the setup mark of
        // the store it locked with it: the write set nothing up.
        setupStoreId: null,
        error: isApiError(error)
          ? { code: error.data.code, message: error.message }
          : { code: "INTERNAL", message: error instanceof Error ? error.name : "Error" },
      })
      .where(eq(apiOperations.id, operationId));
    throw error;
  } finally {
    // A task the handler left running (an `after()` effect) marks nothing.
    scope.active = false;
  }

  let effectIds: string[] = [];
  try {
    const stored = params.toStored ? await params.toStored(result) : result;
    // Only the record runs again, never the handler: a deadlock or a lock
    // wait rolls the whole transaction back, the mark of success included.
    effectIds = await retryTransactionOnDeadlock(
      () =>
        db.transaction(async (tx) => {
          await tx
            .update(apiOperations)
            .set({
              status: "succeeded",
              // Results are kept only to replay them; without a key nothing will.
              result: idempotencyKey === null ? null : encodeResult(stored),
              targetId: targetIdOf(stored),
            })
            .where(eq(apiOperations.id, operationId));
          return enqueueRecordedEffects(tx, params.recordedEffects, stored, scope);
        }),
      { retryOn: isTransactionInterrupted },
    );
  } catch {
    // The handler went through, but the record did not. Marking it failed
    // would let a retry run it a second time: mark it unknown instead, which
    // refuses retries, and say so.
    await db
      .update(apiOperations)
      .set({ status: "unknown" })
      .where(eq(apiOperations.id, operationId))
      .catch(() => undefined);
    throw platformErrors.operationOutcomeUnknown(operationId);
  }
  if (effectIds.length > 0) {
    try {
      params.dispatchEffects?.(effectIds);
    } catch (error) {
      // The cron sends them.
      console.error("Dispatching a write's recorded effects failed:", error);
    }
  }
  return result;
}

/** Builds a write's recorded effects, in the record's transaction. */
export type RecordedEffects = (
  tx: Transaction,
  stored: unknown,
  scope: ApiOperationScope,
) => Promise<{ storeId: string; effects: ApiEffect[] } | null>;

/**
 * `recordedEffects`, in a savepoint of the record's transaction. A failure of
 * their own (a row that cannot be written) is logged and loses them; one that
 * ended the transaction (a deadlock, a lock wait, the savepoint gone with it)
 * is thrown, so the whole record runs again.
 */
async function enqueueRecordedEffects(
  tx: Transaction,
  build: RecordedEffects | undefined,
  stored: unknown,
  scope: ApiOperationScope,
): Promise<string[]> {
  if (!build) return [];
  try {
    return await tx.transaction(async (savepoint) => {
      const built = await build(savepoint, stored, scope);
      if (!built || built.effects.length === 0) return [];
      return enqueueEffects(savepoint, built.storeId, built.effects);
    });
  } catch (error) {
    if (isTransactionInterrupted(error)) throw error;
    console.error("A write's recorded effects could not be added:", error);
    return [];
  }
}

type ClaimResult = { kind: "run"; id: string } | { kind: "replay"; id: string; result: unknown };

async function claimIdempotencyKey(
  row: typeof apiOperations.$inferInsert & { idempotencyKey: string },
): Promise<ClaimResult> {
  // The unique index (store, actor, key) lets only one insert win, even when
  // two retries arrive together.
  const [inserted] = await db
    .insert(apiOperations)
    .values(row)
    .onDuplicateKeyUpdate({ set: { storeId: row.storeId } })
    .$returningId();

  const [existing] = await db
    .select({
      id: apiOperations.id,
      inputHash: apiOperations.inputHash,
      procedure: apiOperations.procedure,
      status: apiOperations.status,
      result: apiOperations.result,
      // Read on the database clock, which also wrote `updated_at`.
      leaseExpired: sql<number>`${apiOperations.updatedAt} < NOW() - INTERVAL ${OPERATION_LEASE_SECONDS} SECOND`,
    })
    .from(apiOperations)
    .where(
      and(
        eq(apiOperations.storeId, row.storeId),
        eq(apiOperations.actorKey, row.actorKey),
        eq(apiOperations.idempotencyKey, row.idempotencyKey),
      ),
    )
    .limit(1);

  if (!existing) throw platformErrors.operationInProgress();
  if (inserted && existing.id === inserted.id) return { kind: "run", id: existing.id };
  if (existing.inputHash !== row.inputHash || existing.procedure !== row.procedure) {
    throw platformErrors.idempotencyConflict();
  }
  if (existing.status === "succeeded")
    return { kind: "replay", id: existing.id, result: existing.result };
  if (existing.status === "running") {
    if (!Number(existing.leaseExpired)) throw platformErrors.operationInProgress();
    await db
      .update(apiOperations)
      .set({ status: "unknown" })
      .where(and(eq(apiOperations.id, existing.id), eq(apiOperations.status, "running")));
    throw platformErrors.operationOutcomeUnknown(existing.id);
  }
  if (existing.status === "unknown") throw platformErrors.operationOutcomeUnknown(existing.id);

  // It failed. A procedure writes in one transaction, so it committed nothing
  // and the same key may run again (procedures that call a provider before
  // their transaction pass the key on to it). Only one retry can move it back
  // to running.
  const [retry] = await db
    .update(apiOperations)
    .set({ status: "running", error: null })
    .where(and(eq(apiOperations.id, existing.id), eq(apiOperations.status, "failed")));
  if (retry.affectedRows !== 1) throw platformErrors.operationInProgress();
  return { kind: "run", id: existing.id };
}

function targetIdOf(result: unknown): string | null {
  if (result && typeof result === "object" && "id" in result) {
    const id = (result as { id: unknown }).id;
    if (typeof id === "string" && id.length <= 64) return id;
  }
  return null;
}

/**
 * Deletes the records added and last changed more than
 * `OPERATION_RETENTION_MONTHS` ago, less `OPERATION_PURGE_MARGIN_DAYS`, on the
 * database's clock, for the cron.
 * It finds the scopes (stores, and the account scope) holding one, reading
 * only the records old enough on `api_operations_store_created_idx`, the
 * scope with the oldest first, then deletes oldest first, in batches, until
 * none is left or the time budget is spent;
 * the next run goes on. A key whose record is gone runs again; what the
 * other readers lose is in docs/architecture/api-and-agents.md, "Retention".
 */
export async function purgeOperations(
  options: { batch?: number; budgetMs?: number } = {},
): Promise<number> {
  const batch = options.batch ?? PURGE_BATCH;
  const deadline = Date.now() + (options.budgetMs ?? PURGE_BUDGET_MS);
  const cutoff = sql`NOW() - INTERVAL ${sql.raw(String(OPERATION_RETENTION_MONTHS))} MONTH + INTERVAL ${sql.raw(String(OPERATION_PURGE_MARGIN_DAYS))} DAY`;
  // The scopes holding a record due on both dates, the one with the oldest
  // due record first: a scope whose old records all changed since holds no
  // turn, and the oldest backlog goes first.
  const scopes = await db
    .select({ storeId: apiOperations.storeId })
    .from(apiOperations)
    .where(and(lt(apiOperations.createdAt, cutoff), lt(apiOperations.updatedAt, cutoff)))
    .groupBy(apiOperations.storeId)
    .orderBy(asc(min(apiOperations.createdAt)));
  let deleted = 0;
  for (const { storeId } of scopes) {
    for (;;) {
      // A record changed since (a failed key run again) stays: its call may still run.
      const [result] = await db
        .delete(apiOperations)
        .where(
          and(
            eq(apiOperations.storeId, storeId),
            lt(apiOperations.createdAt, cutoff),
            lt(apiOperations.updatedAt, cutoff),
          ),
        )
        .orderBy(asc(apiOperations.createdAt))
        .limit(batch);
      deleted += result.affectedRows;
      if (Date.now() >= deadline) return deleted;
      if (result.affectedRows < batch) break;
    }
  }
  return deleted;
}
