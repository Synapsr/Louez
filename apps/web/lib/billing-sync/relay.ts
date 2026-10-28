import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { z } from "zod";

import {
  type BillingAggregateType,
  type Database,
  billingSyncState,
  db,
  newStoresCutoff,
} from "@louez/db";
import { env as dbEnv } from "@louez/db/env";
import * as schema from "@louez/db/schema";

import { type BillingAlerts, createBillingAlerts } from "@/lib/billing-sync/alerts";
import { canonicalHash } from "@/lib/billing-sync/canonical-json";
import {
  type BillingCallResult,
  type BillingClientOptions,
  type CallFailure,
  callBillingService,
  checkBillingHealth,
  classifyFailure,
  readSignedJson,
} from "@/lib/billing-sync/client";
import { billingSyncConfig } from "@/lib/billing-sync/config";
import {
  type BuiltSnapshot,
  type SnapshotKey,
  buildSnapshot,
} from "@/lib/billing-sync/snapshots/build-snapshot";
import { SnapshotDataError } from "@/lib/billing-sync/snapshots/snapshot-checks";
import {
  errorText,
  executeWrite,
  isWaitingForRetryAfter,
  readSyncState,
  selectRows,
  sqlNumber,
  unixSeconds,
  updateSyncState,
} from "@/lib/billing-sync/state";

// The relay (louez-billing docs/api, README §5 and §6): sends the snapshot of every
// due queue row to POST /events and applies each result to its row. One run per
// cron minute, under the relay lock.

export const MAX_EVENT_BYTES = 262_144;
export const MAX_BATCH_EVENTS = 100;
export const MAX_BODY_BYTES = 1_048_576;
const BODY_OVERHEAD_BYTES = Buffer.byteLength('{"events":[]}');
const RUN_LIMIT_MS = 50_000;
/**
 * The relay's share of the 600 requests a minute that events, heartbeats and
 * manifests share (README §4.4). The rest is left to the heartbeat and manifests.
 */
export const RELAY_REQUESTS_PER_MINUTE = 450;
const DUE_PAGE = 100;
const DEAD_AFTER_ATTEMPTS = 5;
const PROCESSING_FAILED_MAX_MINUTES = 60;
const SERVER_ERRORS_BEFORE_DEAD = 3;
const SERVER_ERROR_RUNS_BEFORE_SINGLE_MODE = 3;
const RELAY_STALE_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------- pure rules

export type EventResult = z.infer<typeof eventResultSchema>;

const eventResultSchema = z.object({
  id: z.string().nullable(),
  status: z.enum(["accepted", "duplicate", "stale", "rejected"]),
  heldVersion: z.number().int().min(1).nullable(),
  error: z
    .object({ code: z.string(), message: z.string(), path: z.string().nullable() })
    .nullable(),
});

const eventsResponseSchema = z.object({ results: z.array(eventResultSchema) });

/** What one result means for its queue row (README §5.3 and §6). */
export type ResultAction =
  | { readonly kind: "delivered"; readonly heldVersion: number | null }
  | { readonly kind: "id_reused"; readonly heldVersion: number | null }
  | { readonly kind: "processing_failed"; readonly error: string }
  | { readonly kind: "rejected"; readonly error: string };

export function resultAction(result: EventResult): ResultAction {
  if (result.status !== "rejected") return { kind: "delivered", heldVersion: result.heldVersion };
  const code = result.error?.code ?? "unknown";
  const error = errorText(
    `${code}${result.error?.path ? ` at ${result.error.path}` : ""}: ${result.error?.message ?? ""}`,
  );
  if (code === "id_reused") return { kind: "id_reused", heldVersion: result.heldVersion };
  if (code === "processing_failed") return { kind: "processing_failed", error };
  return { kind: "rejected", error };
}

/**
 * The next attempt after a rejection: `processing_failed` waits min(60, 2^attempts)
 * minutes and never dies; any other code waits 2^attempts minutes and dies at 5.
 */
export function planRejection(
  kind: "processing_failed" | "rejected",
  attemptCount: number,
): { readonly attemptCount: number; readonly delayMinutes: number; readonly dead: boolean } {
  const attempts = attemptCount + 1;
  if (kind === "processing_failed") {
    return {
      attemptCount: attempts,
      delayMinutes: Math.min(PROCESSING_FAILED_MAX_MINUTES, 2 ** Math.min(attempts, 6)),
      dead: false,
    };
  }
  return {
    attemptCount: attempts,
    delayMinutes: 2 ** Math.min(attempts, 20),
    dead: attempts >= DEAD_AFTER_ATTEMPTS,
  };
}

const SERVER_ERROR_PREFIX = /^server_error (\d+)\//;

/**
 * In single-event mode, the 5xx answers or timeouts an event got alone in a row,
 * counted in its `last_error`. The third makes the row dead.
 */
export function planServerErrorAlone(lastError: string | null): {
  readonly count: number;
  readonly dead: boolean;
} {
  const previous = Number(SERVER_ERROR_PREFIX.exec(lastError ?? "")?.[1] ?? 0);
  const count = previous + 1;
  return { count, dead: count >= SERVER_ERRORS_BEFORE_DEAD };
}

/** Packs events in order into requests of at most 100 events and 1,048,576 bytes. */
export function packEventBatches<T extends { readonly bytes: number }>(
  events: readonly T[],
): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let size = BODY_OVERHEAD_BYTES;
  for (const event of events) {
    const added = event.bytes + (current.length > 0 ? 1 : 0);
    if (
      current.length > 0 &&
      (current.length >= MAX_BATCH_EVENTS || size + added > MAX_BODY_BYTES)
    ) {
      batches.push(current);
      current = [];
      size = BODY_OVERHEAD_BYTES;
    }
    size += event.bytes + (current.length > 0 ? 1 : 0);
    current.push(event);
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export type EventsOutcome =
  | { readonly kind: "results"; readonly results: EventResult[] }
  /** A verified 400 or any 413: the request broke a limit (README §6). */
  | { readonly kind: "limit"; readonly status: 400 | 413; readonly detail: string }
  | CallFailure;

/** Classifies the answer to a `POST /events` of `eventCount` events. */
export function classifyEventsResponse(call: BillingCallResult, eventCount: number): EventsOutcome {
  if (call.kind === "response" && call.status === 200) {
    const body = readSignedJson(call, eventsResponseSchema);
    if (!body.ok) return { kind: "transport", serverError: false, detail: body.reason };
    if (body.value.results.length !== eventCount) {
      return {
        kind: "transport",
        serverError: false,
        detail: `${body.value.results.length} results for ${eventCount} events`,
      };
    }
    return { kind: "results", results: body.value.results };
  }
  // A 413 cannot be signed; only a verified 400 may switch the mode.
  if (call.kind === "response" && call.status === 413) {
    return { kind: "limit", status: 413, detail: "HTTP 413" };
  }
  if (call.kind === "response" && call.status === 400 && call.signature.ok) {
    return { kind: "limit", status: 400, detail: "HTTP 400" };
  }
  return classifyFailure(call);
}

/** The time limit and the request pace of one run (README §6 and §4.4). */
export type RunClock = {
  /**
   * Whether the run may build more events. False a reserve before the limit, so
   * what was built still gets a request slot, and once a request no longer fit.
   */
  canPrepare(): boolean;
  /**
   * Waits for the next request slot, so the run never sends more than its share of
   * the budget in a minute. False, without waiting, when the slot falls after the
   * limit: the run sends nothing more.
   */
  nextRequest(): Promise<boolean>;
};

export function createRunClock(input: {
  readonly limitMs: number;
  readonly requestsPerMinute: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}): RunClock {
  const now = input.now ?? Date.now;
  const sleep =
    input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + input.limitMs;
  const reserveMs = Math.min(10_000, input.limitMs / 5);
  const spacingMs = 60_000 / input.requestsPerMinute;
  let nextSlot = Number.NEGATIVE_INFINITY;
  let stopped = false;
  return {
    canPrepare: () => !stopped && now() < deadline - reserveMs,
    async nextRequest() {
      // A slow request leaves no credit behind: the next slot counts from now.
      const at = Math.max(now(), nextSlot);
      if (stopped || at >= deadline) {
        stopped = true;
        return false;
      }
      nextSlot = at + spacingMs;
      const wait = at - now();
      if (wait > 0) await sleep(wait);
      return true;
    },
  };
}

// ---------------------------------------------------------------- queue rows

type QueueKey = { readonly type: BillingAggregateType; readonly aggregateId: string };

const aggregateType = z.enum(["store", "reservation", "legacy_store", "legacy_month"]);

const dueRowSchema = z.object({
  type: aggregateType,
  aggregateId: z.string(),
  storeId: z.string(),
  rank: sqlNumber,
  markedAt: z.string(),
});
type DueRow = z.infer<typeof dueRowSchema>;

/** Due pending rows, stores first, then by mark time, after `cursor` (keyset). */
async function selectDueRows(cursor: DueRow | null, limit: number): Promise<DueRow[]> {
  const rank = sql`IF(aggregate_type = 'store', 0, 1)`;
  const after = cursor
    ? sql`AND (${rank}, marked_at, CAST(aggregate_type AS CHAR), aggregate_id) >
             (${cursor.rank}, ${cursor.markedAt}, ${cursor.type}, ${cursor.aggregateId})`
    : sql``;
  return selectRows(
    db,
    sql`SELECT aggregate_type AS type, aggregate_id AS aggregateId, store_id AS storeId,
               ${rank} AS \`rank\`, DATE_FORMAT(marked_at, '%Y-%m-%d %H:%i:%s.%f') AS markedAt
        FROM billing_sync_queue
        WHERE status = 'pending' AND next_attempt_at <= NOW(3) ${after}
        ORDER BY \`rank\`, marked_at, CAST(aggregate_type AS CHAR), aggregate_id
        LIMIT ${limit}`,
    dueRowSchema,
  );
}

const whereKey = (key: QueueKey) =>
  sql`aggregate_type = ${key.type} AND aggregate_id = ${key.aggregateId}`;

/** Synced without sending: unchanged content, a new store's legacy aggregate, or gone. */
async function markSyncedUnsent(key: QueueKey, version: number): Promise<void> {
  await executeWrite(
    db,
    sql`UPDATE billing_sync_queue
        SET status = 'synced', attempt_count = 0, failing_since = NULL, last_error = NULL
        WHERE ${whereKey(key)} AND version = ${version} AND status = 'pending'`,
  );
}

/**
 * Delivered (`accepted`, `duplicate`, `stale`). The row is synced only if no mark
 * moved its version since the build; the service holds the sent version either way.
 *
 * The sent hash becomes this content's even when plain marks moved the version, so
 * a change undone during the send is compared with what the service now holds and
 * sent again (README §5.2 and §6). Plain marks leave the hash read at build time in
 * place; a forced mark clears it, and then it stays cleared. A hash that was already
 * empty at build time stays empty once the version moved, since a forced mark would
 * leave no trace: the next build sends whatever it finds.
 */
async function markDelivered(event: PreparedEvent, heldVersion: number | null): Promise<void> {
  const { key, version, hash, baseHash } = event;
  await executeWrite(
    db,
    sql`UPDATE billing_sync_queue
        SET delivered_version = GREATEST(delivered_version, ${version}),
            sent_hash = IF(version = ${version} OR sent_hash = ${baseHash}, ${hash}, sent_hash),
            status = IF(version = ${version}, 'synced', status),
            attempt_count = 0, failing_since = NULL, last_error = NULL
        WHERE ${whereKey(key)}`,
  );
  // After a Louez restore the service can hold a higher version: catch up past it.
  if (heldVersion !== null) {
    await executeWrite(
      db,
      sql`UPDATE billing_sync_queue
          SET version = ${heldVersion} + 1, status = 'pending', sent_hash = NULL,
              next_attempt_at = NOW(3), marked_at = NOW(3)
          WHERE ${whereKey(key)} AND version < ${heldVersion}`,
    );
  }
}

/**
 * The answer to a batch was lost or unusable (a timeout, a 5xx), but the service may
 * have applied it: it holds this content or the one sent before, and Louez cannot
 * tell which. Without a sent hash, the next build sends whatever it finds (README
 * §5.2). Status, attempts and backoff stay as they were (§6).
 */
async function forgetSentHashes(batch: readonly PreparedEvent[]): Promise<void> {
  const known = batch.filter((event) => event.baseHash !== null);
  if (known.length === 0) return;
  await executeWrite(
    db,
    sql`UPDATE billing_sync_queue SET sent_hash = NULL
        WHERE ${sql.join(
          known.map((event) => sql`(${whereKey(event.key)} AND sent_hash = ${event.baseHash})`),
          sql` OR `,
        )}`,
  );
}

/** `id_reused`: not an attempt. Version at least heldVersion, then a forced mark. */
async function markIdReused(event: PreparedEvent, heldVersion: number | null): Promise<void> {
  await executeWrite(
    db,
    sql`UPDATE billing_sync_queue
        SET version = GREATEST(version, ${heldVersion ?? 0}) + 1, status = 'pending',
            sent_hash = NULL, next_attempt_at = NOW(3), marked_at = NOW(3),
            last_error = ${`id_reused at version ${event.version}`}
        WHERE ${whereKey(event.key)}`,
  );
}

async function markRetry(
  key: QueueKey,
  plan: { attemptCount: number; delayMinutes: number; dead: boolean },
  error: string,
): Promise<void> {
  await executeWrite(
    db,
    sql`UPDATE billing_sync_queue
        SET attempt_count = ${plan.attemptCount},
            status = ${plan.dead ? sql`'dead'` : sql`status`},
            next_attempt_at = NOW(3) + INTERVAL ${plan.delayMinutes} MINUTE,
            failing_since = COALESCE(failing_since, NOW(3)),
            last_error = ${errorText(error)}
        WHERE ${whereKey(key)}`,
  );
}

async function markDead(key: QueueKey, error: string): Promise<void> {
  await executeWrite(
    db,
    sql`UPDATE billing_sync_queue
        SET status = 'dead', failing_since = COALESCE(failing_since, NOW(3)),
            last_error = ${errorText(error)}
        WHERE ${whereKey(key)}`,
  );
}

/** A 5xx or a timeout for an event sent alone: no backoff, counted in last_error. */
async function markServerErrorAlone(event: PreparedEvent, detail: string): Promise<boolean> {
  const plan = planServerErrorAlone(event.lastError);
  await executeWrite(
    db,
    sql`UPDATE billing_sync_queue
        SET status = ${plan.dead ? sql`'dead'` : sql`status`},
            failing_since = COALESCE(failing_since, NOW(3)),
            last_error = ${errorText(`server_error ${plan.count}/${SERVER_ERRORS_BEFORE_DEAD}: ${detail}`)}
        WHERE ${whereKey(event.key)}`,
  );
  return plan.dead;
}

// ---------------------------------------------------------------- snapshots

export type SnapshotBuilder = typeof buildSnapshot;

export type PreparedEvent = {
  readonly key: QueueKey;
  readonly version: number;
  readonly hash: string;
  /** The row's sent hash when the snapshot was built. */
  readonly baseHash: string | null;
  readonly json: string;
  readonly bytes: number;
  readonly lastError: string | null;
};

type Prepared =
  | { readonly kind: "send"; readonly event: PreparedEvent }
  | { readonly kind: "done"; readonly counted: "unchanged" | "skipped" | "missing" | "gone" }
  | { readonly kind: "too_large"; readonly version: number; readonly bytes: number };

const currentRowSchema = z.object({
  version: sqlNumber,
  sentHash: z.string().nullable(),
  status: z.enum(["pending", "synced", "dead"]),
  lastError: z.string().nullable(),
  observedAt: unixSeconds,
  finalPayload: z.unknown(),
});
type CurrentRow = z.infer<typeof currentRowSchema>;

/**
 * What an account deletion stored on the row (final-snapshots.ts): the closing snapshot
 * and when it was built. The relay sends it as stored, never rebuilt, since the rows
 * are gone (README §5.5). mysql2 hands a JSON column back parsed; a string is parsed.
 */
const finalPayloadSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  },
  z.object({ observedAt: z.string(), data: z.record(z.string(), z.unknown()) }),
);
type FinalPayload = z.infer<typeof finalPayloadSchema>;

/** What the relay sends for a row: a fresh build, or the stored final snapshot. */
type RowSnapshot =
  | { readonly kind: "built"; readonly built: BuiltSnapshot }
  | { readonly kind: "final"; readonly payload: FinalPayload };

/**
 * A Drizzle instance on a one-connection pool, so the version read and the snapshot
 * share one `START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY` (README §5.2).
 * (Drizzle's own transaction option writes that statement without its comma.)
 */
function openSnapshotDatabase(): { readonly db: Database; close(): Promise<void> } {
  const pool = mysql.createPool({
    uri: dbEnv.DATABASE_URL,
    connectionLimit: 1,
    waitForConnections: true,
    enableKeepAlive: true,
  });
  return { db: drizzle(pool, { schema, mode: "default" }), close: () => pool.end() };
}

/**
 * Reads the row's version and builds its snapshot from one consistent state, or takes
 * the final snapshot an account deletion stored on it.
 */
async function readAndBuild(
  snapshotDb: Database,
  key: SnapshotKey,
  newStoresFrom: Date,
  build: SnapshotBuilder,
): Promise<{ current: CurrentRow; snapshot: RowSnapshot } | null> {
  await snapshotDb.execute(sql`START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY`);
  try {
    const [current] = await selectRows(
      snapshotDb,
      sql`SELECT version, sent_hash AS sentHash, status, last_error AS lastError,
                 UNIX_TIMESTAMP(NOW(3)) AS observedAt, final_payload AS finalPayload
          FROM billing_sync_queue WHERE ${whereKey(key)}`,
      currentRowSchema,
    );
    let snapshot: RowSnapshot | null = null;
    if (current && current.status === "pending") {
      snapshot =
        current.finalPayload === null || current.finalPayload === undefined
          ? { kind: "built", built: await build(snapshotDb, key, { newStoresFrom }) }
          : { kind: "final", payload: parseFinalPayload(key, current.finalPayload) };
    }
    await snapshotDb.execute(sql`COMMIT`);
    return current && snapshot ? { current, snapshot } : null;
  } catch (error) {
    await snapshotDb.execute(sql`ROLLBACK`).catch(() => undefined);
    throw error;
  }
}

/** A stored final snapshot that does not parse will not heal: the row dies and alerts. */
function parseFinalPayload(key: SnapshotKey, value: unknown): FinalPayload {
  const parsed = finalPayloadSchema.safeParse(value);
  if (!parsed.success) {
    throw new SnapshotDataError(
      `${key.type} ${key.aggregateId}`,
      `the stored final snapshot is malformed (${parsed.error.issues[0]?.message ?? "unknown"})`,
    );
  }
  return parsed.data;
}

async function prepareRow(
  snapshotDb: Database,
  row: DueRow,
  newStoresFrom: Date,
  build: SnapshotBuilder,
): Promise<Prepared> {
  const key = { type: row.type, aggregateId: row.aggregateId, storeId: row.storeId };
  const read = await readAndBuild(snapshotDb, key, newStoresFrom, build);
  // Synced or dead since the due query: nothing to send.
  if (!read) return { kind: "done", counted: "gone" };
  const { current, snapshot } = read;

  const { version } = current;
  let content: { readonly data: unknown; readonly observedAt: string; readonly final: boolean };
  if (snapshot.kind === "final") {
    content = { data: snapshot.payload.data, observedAt: snapshot.payload.observedAt, final: true };
  } else if (snapshot.built.kind === "missing") {
    await markSyncedUnsent(key, version);
    return { kind: "done", counted: "missing" };
  } else if (snapshot.built.kind !== "snapshot") {
    // `skip`: a legacy aggregate of a new store, never sent (README §8.3).
    await markSyncedUnsent(key, version);
    return { kind: "done", counted: "skipped" };
  } else {
    content = {
      data: snapshot.built.data,
      observedAt: (current.observedAt ?? new Date()).toISOString(),
      final: false,
    };
  }

  const hash = canonicalHash(content.data);
  if (current.sentHash === hash) {
    await markSyncedUnsent(key, version);
    return { kind: "done", counted: "unchanged" };
  }

  const type = `${row.type}.snapshot`;
  const json = JSON.stringify({
    schema: "louez.billing.event/1",
    id: `${type}:${row.aggregateId}:${version}`,
    type,
    schemaVersion: 1,
    aggregateId: row.aggregateId,
    storeId: row.storeId,
    version,
    observedAt: content.observedAt,
    final: content.final,
    data: content.data,
  });
  const bytes = Buffer.byteLength(json, "utf8");
  if (bytes > MAX_EVENT_BYTES) return { kind: "too_large", version, bytes };
  return {
    kind: "send",
    event: {
      key,
      version,
      hash,
      baseHash: current.sentHash,
      json,
      bytes,
      lastError: current.lastError,
    },
  };
}

// ---------------------------------------------------------------- run

export type RelayOptions = {
  readonly alerts?: BillingAlerts;
  readonly client?: BillingClientOptions;
  /** The snapshot builder; tests pass their own. */
  readonly build?: SnapshotBuilder;
  readonly timeLimitMs?: number;
};

export type RelayCounts = {
  sent: number;
  delivered: number;
  unchanged: number;
  skipped: number;
  missing: number;
  retried: number;
  dead: number;
  buildFailed: number;
};

export type RelayRunResult = {
  readonly outcome: "ok" | "waiting" | "transport_failure" | "stopped";
  readonly singleEventMode: boolean;
  readonly counts: RelayCounts;
  readonly detail: string | null;
};

type RunFailure = CallFailure & { readonly alert?: string };

type RunMode = {
  /** From billing_sync_state: three server-error runs switched it on. */
  readonly persistentSingle: boolean;
  /** A 400 or 413 on a batch: one event per request for the rest of this run. */
  forcedSingle: boolean;
  serverErrorsAlone: number;
};

export async function runRelay(options: RelayOptions = {}): Promise<RelayRunResult> {
  const alerts = options.alerts ?? createBillingAlerts();
  const config = options.client?.config ?? billingSyncConfig();
  const client: BillingClientOptions = { ...options.client, config };
  const build = options.build ?? buildSnapshot;
  const clock = createRunClock({
    limitMs: options.timeLimitMs ?? RUN_LIMIT_MS,
    requestsPerMinute: RELAY_REQUESTS_PER_MINUTE,
  });
  const counts: RelayCounts = {
    sent: 0,
    delivered: 0,
    unchanged: 0,
    skipped: 0,
    missing: 0,
    retried: 0,
    dead: 0,
    buildFailed: 0,
  };

  const state = await readSyncState();
  if (isWaitingForRetryAfter(state)) {
    await alertWhenStale(alerts);
    return { outcome: "waiting", singleEventMode: state.singleEventMode, counts, detail: null };
  }

  const newStoresFrom = await newStoresCutoff(db, config.newStoresFrom);
  const mode: RunMode = {
    persistentSingle: state.singleEventMode,
    forcedSingle: false,
    serverErrorsAlone: 0,
  };
  const snapshots = openSnapshotDatabase();
  let failure: RunFailure | null = null;

  try {
    let cursor: DueRow | null = null;
    while (failure === null && clock.canPrepare()) {
      const due = await selectDueRows(cursor, DUE_PAGE);
      if (due.length === 0) break;
      cursor = due[due.length - 1] ?? null;

      const events: PreparedEvent[] = [];
      for (const row of due) {
        if (!clock.canPrepare()) break;
        let prepared: Prepared;
        try {
          prepared = await prepareRow(snapshots.db, row, newStoresFrom, build);
        } catch (error) {
          await recordBuildFailure(row, error, counts, alerts);
          continue;
        }
        if (prepared.kind === "send") {
          events.push(prepared.event);
        } else if (prepared.kind === "too_large") {
          counts.dead += 1;
          await markDead(row, `event_too_large: ${prepared.bytes} bytes`);
          await alerts.alert(
            "event_too_large",
            `${row.type} ${row.aggregateId} v${prepared.version} is ${prepared.bytes} bytes, above ${MAX_EVENT_BYTES}; the row is dead`,
          );
        } else if (prepared.counted === "missing") {
          counts.missing += 1;
          alerts.log.error(
            "billing",
            `relay: ${row.type} ${row.aggregateId} of store ${row.storeId} no longer exists in Louez; marked synced without sending`,
          );
        } else if (prepared.counted !== "gone") {
          counts[prepared.counted] += 1;
        }
      }

      failure = await deliver(events, { mode, clock, counts, alerts, client });
    }
  } finally {
    await snapshots.close();
  }

  return finishRun({ failure, mode, counts, alerts, client });
}

/**
 * A snapshot that cannot be built. A `SnapshotDataError` will not go away on its
 * own: the row is dead and alerts. Anything else is retried with backoff, never dead.
 */
async function recordBuildFailure(
  row: DueRow,
  error: unknown,
  counts: RelayCounts,
  alerts: BillingAlerts,
): Promise<void> {
  const reason = error instanceof Error ? error.message : String(error);
  if (error instanceof SnapshotDataError) {
    counts.dead += 1;
    await markDead(row, `invalid_snapshot: ${reason}`);
    await alerts.alert(
      "event_dead",
      `${row.type} ${row.aggregateId} cannot be expressed in the contract (${reason}); the row is dead`,
    );
    return;
  }
  counts.buildFailed += 1;
  alerts.log.error("billing", `relay: building ${row.type} ${row.aggregateId} failed: ${reason}`);
  const [attempts] = await selectRows(
    db,
    sql`SELECT attempt_count AS attemptCount FROM billing_sync_queue WHERE ${whereKey(row)}`,
    z.object({ attemptCount: sqlNumber }),
  );
  await markRetry(
    row,
    planRejection("processing_failed", attempts?.attemptCount ?? 0),
    `build_failed: ${reason}`,
  );
}

async function postEvents(
  batch: readonly PreparedEvent[],
  client: BillingClientOptions,
): Promise<EventsOutcome> {
  const json = `{"events":[${batch.map((event) => event.json).join(",")}]}`;
  const call = await callBillingService(
    { endpoint: "events", method: "POST", path: "/events", json },
    client,
  );
  return classifyEventsResponse(call, batch.length);
}

/**
 * A failure that may come after the service applied the batch: a timeout, a 5xx,
 * an answer that failed its checks, or a 503 from a proxy. A 400 or 413, a 401 and
 * a 406 refuse the whole request before any event is handled.
 */
function mayHaveApplied(failure: CallFailure): boolean {
  return failure.kind === "transport" || failure.kind === "retry_after";
}

/**
 * Sends the prepared events; returns the failure that stops the run, if any. Each
 * request waits for its slot in the run's pace. Once the run is out of time, the
 * events not sent stay pending at their version and are built again next run.
 */
async function deliver(
  events: readonly PreparedEvent[],
  run: {
    readonly mode: RunMode;
    readonly clock: RunClock;
    readonly counts: RelayCounts;
    readonly alerts: BillingAlerts;
    readonly client: BillingClientOptions;
  },
): Promise<RunFailure | null> {
  const { mode, clock, counts, alerts, client } = run;
  const queue =
    mode.persistentSingle || mode.forcedSingle
      ? events.map((event) => [event])
      : packEventBatches(events);

  while (queue.length > 0) {
    if (!(await clock.nextRequest())) break;
    const batch = queue.shift();
    if (!batch) break;
    const outcome = await postEvents(batch, client);

    if (outcome.kind === "results") {
      counts.sent += batch.length;
      for (const [index, event] of batch.entries()) {
        const result = outcome.results[index];
        if (result) await applyResult(event, result, counts, alerts);
      }
      continue;
    }

    if (outcome.kind === "limit") {
      if (batch.length > 1) {
        mode.forcedSingle = true;
        const rest = queue.splice(0).flat();
        queue.push(...[...batch, ...rest].map((event) => [event]));
        continue;
      }
      const [event] = batch;
      if (!event) continue;
      if (outcome.status === 400) {
        counts.dead += 1;
        await markDead(event.key, "rejected alone with HTTP 400 invalid_request");
        await alerts.alert(
          "event_dead",
          `${event.key.type} ${event.key.aggregateId} v${event.version} got HTTP 400 when sent alone; the row is dead`,
        );
        continue;
      }
      return {
        kind: "transport",
        serverError: false,
        detail: `HTTP 413 for one event of ${event.bytes} bytes`,
        alert: `HTTP 413 for ${event.key.type} ${event.key.aggregateId} sent alone (${event.bytes} bytes, under ${MAX_EVENT_BYTES}): a size limit is misconfigured`,
      };
    }

    if (mayHaveApplied(outcome)) await forgetSentHashes(batch);
    const [alone] = batch;
    if (
      outcome.kind === "transport" &&
      outcome.serverError &&
      mode.persistentSingle &&
      alone &&
      batch.length === 1 &&
      (await checkBillingHealth(client))
    ) {
      // The service is up, so this event is the problem; the other stores keep flowing.
      mode.serverErrorsAlone += 1;
      if (await markServerErrorAlone(alone, outcome.detail)) {
        counts.dead += 1;
        await alerts.alert(
          "event_dead",
          `${alone.key.type} ${alone.key.aggregateId} v${alone.version} got ${SERVER_ERRORS_BEFORE_DEAD} server errors in a row when sent alone; the row is dead`,
        );
      }
      continue;
    }
    return outcome;
  }
  return null;
}

async function applyResult(
  event: PreparedEvent,
  result: EventResult,
  counts: RelayCounts,
  alerts: BillingAlerts,
): Promise<void> {
  const action = resultAction(result);
  if (action.kind === "delivered") {
    counts.delivered += 1;
    await markDelivered(event, action.heldVersion);
    return;
  }
  if (action.kind === "id_reused") {
    counts.retried += 1;
    await markIdReused(event, action.heldVersion);
    return;
  }
  const [row] = await selectRows(
    db,
    sql`SELECT attempt_count AS attemptCount FROM billing_sync_queue WHERE ${whereKey(event.key)}`,
    z.object({ attemptCount: sqlNumber }),
  );
  const plan = planRejection(action.kind, row?.attemptCount ?? 0);
  await markRetry(event.key, plan, action.error);
  if (plan.dead) {
    counts.dead += 1;
    await alerts.alert(
      "event_dead",
      `${event.key.type} ${event.key.aggregateId} v${event.version} was rejected ${plan.attemptCount} times (${action.error}); the row is dead`,
    );
  } else {
    counts.retried += 1;
  }
}

async function finishRun(input: {
  failure: RunFailure | null;
  mode: RunMode;
  counts: RelayCounts;
  alerts: BillingAlerts;
  client: BillingClientOptions;
}): Promise<RelayRunResult> {
  const { failure, mode, counts, alerts, client } = input;
  let singleEventMode = mode.persistentSingle;

  if (failure === null) {
    const clean = mode.serverErrorsAlone === 0;
    // One clean run brings the relay back to batches.
    if (clean) singleEventMode = false;
    await updateSyncState({
      lastRelayOkAt: new Date(),
      consecutiveFailures: 0,
      ...(clean ? { serverErrorRuns: 0 } : {}),
      singleEventMode,
      lastError: null,
    });
  } else if (failure.kind === "retry_after") {
    await updateSyncState({
      retryAfterUntil: new Date(Date.now() + failure.seconds * 1000),
      lastError: errorText(`relay waits ${failure.seconds} s: ${failure.detail}`),
    });
  } else {
    let serverErrorRuns: number | null = null;
    if (failure.kind === "transport" && failure.serverError && !mode.persistentSingle) {
      // Three such runs in a row while /health answers mean the batches are the problem.
      const [state] = await selectRows(
        db,
        sql`SELECT server_error_runs AS runs FROM billing_sync_state WHERE id = 1`,
        z.object({ runs: sqlNumber }),
      );
      serverErrorRuns = (await checkBillingHealth(client)) ? (state?.runs ?? 0) + 1 : 0;
      if (serverErrorRuns >= SERVER_ERROR_RUNS_BEFORE_SINGLE_MODE) singleEventMode = true;
    }
    await updateSyncState({
      consecutiveFailures: sql`${billingSyncState.consecutiveFailures} + 1`,
      ...(serverErrorRuns === null ? {} : { serverErrorRuns }),
      singleEventMode,
      lastError: errorText(`relay: ${failure.detail}`),
    });
    if (singleEventMode && !mode.persistentSingle) {
      await alerts.alert(
        "relay_single_event_mode",
        `${SERVER_ERROR_RUNS_BEFORE_SINGLE_MODE} relay runs in a row failed with server errors while /health answered; sending one event per request`,
      );
    }
    if (failure.kind === "auth") {
      await alerts.alert(
        "relay_auth",
        `POST /events refused: ${failure.detail}. Check the keys and the clock.`,
      );
    } else if (failure.kind === "contract") {
      await alerts.alert(
        "relay_contract",
        `POST /events refused the contract version: ${failure.detail}`,
      );
    } else if (failure.alert) {
      await alerts.alert("event_limit", failure.alert);
    } else {
      alerts.log.error("billing", `relay stopped on a transport failure: ${failure.detail}`);
    }
  }

  await alertWhenStale(alerts);
  await alertOnLongFailures(alerts);

  const outcome =
    failure === null
      ? "ok"
      : failure.kind === "retry_after"
        ? "waiting"
        : failure.kind === "transport"
          ? "transport_failure"
          : "stopped";
  return { outcome, singleEventMode, counts, detail: failure?.detail ?? null };
}

/** README §6: alert when the last successful relay run is older than 15 minutes. */
async function alertWhenStale(alerts: BillingAlerts): Promise<void> {
  const state = await readSyncState();
  const last = state.lastRelayOkAt?.getTime();
  const stale =
    last === undefined ? state.consecutiveFailures >= 15 : Date.now() - last > RELAY_STALE_MS;
  if (stale) {
    await alerts.alert(
      "relay_stale",
      `no successful relay run since ${state.lastRelayOkAt?.toISOString() ?? "start-up"} (${state.consecutiveFailures} failed runs; last error: ${state.lastError ?? "none"})`,
    );
  }
}

/** Rows that keep failing for over an hour, such as `processing_failed` ones. */
async function alertOnLongFailures(alerts: BillingAlerts): Promise<void> {
  const [row] = await selectRows(
    db,
    sql`SELECT COUNT(*) AS failing FROM billing_sync_queue
        WHERE status = 'pending' AND failing_since < NOW(3) - INTERVAL 1 HOUR`,
    z.object({ failing: sqlNumber }),
  );
  if (row && row.failing > 0) {
    await alerts.alert(
      "rows_failing",
      `${row.failing} queue row(s) have been failing for over an hour (see last_error in billing_sync_queue)`,
    );
  }
}
