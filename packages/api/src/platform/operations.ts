import { apiOperations, db } from "@louez/db";
import { and, eq, sql } from "drizzle-orm";

import type { StoreActor } from "./actor";
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
    actor: StoreActor;
    procedure: string;
    input: unknown;
    idempotencyKey: string | null;
    receipt?: OperationReceipt;
    /**
     * What is kept to replay: the result as the caller receives it, after the
     * output schema dropped what the contract does not show.
     */
    toStored?: (result: T) => Promise<unknown>;
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

  let result: T;
  try {
    result = await execute();
  } catch (error) {
    await db
      .update(apiOperations)
      .set({
        status: "failed",
        error: isApiError(error)
          ? { code: error.data.code, message: error.message }
          : { code: "INTERNAL", message: error instanceof Error ? error.name : "Error" },
      })
      .where(eq(apiOperations.id, operationId));
    throw error;
  }

  try {
    const stored = params.toStored ? await params.toStored(result) : result;
    await db
      .update(apiOperations)
      .set({
        status: "succeeded",
        // Results are kept only to replay them; without a key nothing will.
        result: idempotencyKey === null ? null : encodeResult(stored),
        targetId: targetIdOf(stored),
      })
      .where(eq(apiOperations.id, operationId));
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
  return result;
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
