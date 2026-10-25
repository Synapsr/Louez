import { and, asc, eq, exists, gte, isNotNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import {
  type BillingMark,
  billingSyncHandledRequests,
  billingSyncManifests,
  billingSyncQueue,
  db,
  markBillingDirty,
  paymentDisputes,
  payments,
  reservations,
  stores,
} from "@louez/db";

import { type BillingAlerts, createBillingAlerts } from "@/lib/billing-sync/alerts";
import {
  type BillingClientOptions,
  callBillingService,
  classifyFailure,
  readSignedJson,
} from "@/lib/billing-sync/client";
import { billingSyncConfig } from "@/lib/billing-sync/config";
import { newStoresCutoff } from "@/lib/billing-sync/policies";
import {
  type SyncExecutor,
  databaseNow,
  errorText,
  isWaitingForRetryAfter,
  periodBounds,
  previousPeriod,
  readSyncState,
  updateSyncState,
  utcPeriod,
  utcSqlTime,
} from "@/lib/billing-sync/state";

// Monthly manifests (louez-billing docs/api, README §7.3): per store and period,
// every aggregate the service should hold, with the version it last acknowledged.
// Each manifest is tracked in billing_sync_manifests until a 200 carries its result.

const MAX_MANIFESTS_PER_REQUEST = 50;
const MAX_AGGREGATES = 10_000;
const MAX_BODY_BYTES = 1_048_576;
const PENDING_PER_RUN = 500;

// ---------------------------------------------------------------- resync entries

const aggregateType = z.enum(["store", "reservation", "legacy_store", "legacy_month"]);
const requestId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

export const resyncEntrySchema = z.object({
  type: aggregateType,
  aggregateId: z.string().regex(/^[A-Za-z0-9_-]{1,32}(:[0-9]{4}-(0[1-9]|1[0-2]))?$/),
  requestId,
});
export type ResyncEntry = z.infer<typeof resyncEntrySchema>;

/** Records a handled request id; false when it was handled before (README §7.2). */
export async function claimRequestId(executor: SyncExecutor, id: string): Promise<boolean> {
  const [header] = await executor
    .insert(billingSyncHandledRequests)
    .ignore()
    .values({ requestId: id });
  return header.affectedRows === 1;
}

async function storeExists(executor: SyncExecutor, storeId: string): Promise<boolean> {
  const rows = await executor
    .select({ id: stores.id })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);
  return rows.length > 0;
}

/** The mark for a resync entry, or null when the aggregate no longer exists in Louez. */
async function resyncMark(executor: SyncExecutor, entry: ResyncEntry): Promise<BillingMark | null> {
  if (entry.type === "reservation") {
    const [row] = await executor
      .select({ storeId: reservations.storeId })
      .from(reservations)
      .where(eq(reservations.id, entry.aggregateId))
      .limit(1);
    return row
      ? { type: "reservation", aggregateId: entry.aggregateId, storeId: row.storeId }
      : null;
  }
  const storeId =
    entry.type === "legacy_month" ? entry.aggregateId.split(":")[0] : entry.aggregateId;
  if (!storeId || (entry.type === "legacy_month") !== entry.aggregateId.includes(":")) return null;
  if (!(await storeExists(executor, storeId))) return null;
  return { type: entry.type, aggregateId: entry.aggregateId, storeId };
}

/**
 * Force-marks the aggregates of resync entries not handled yet, each with its
 * request id in one transaction. An aggregate that no longer exists is logged and
 * still counts as handled: the service raises a reconciliation diff (README §7.1).
 */
export async function applyResyncEntries(
  entries: readonly ResyncEntry[],
  alerts: BillingAlerts,
): Promise<{ marked: number; missing: number; repeated: number }> {
  const counts = { marked: 0, missing: 0, repeated: 0 };
  for (const entry of entries) {
    const outcome = await db.transaction(async (tx): Promise<keyof typeof counts> => {
      if (!(await claimRequestId(tx, entry.requestId))) return "repeated";
      const mark = await resyncMark(tx, entry);
      if (!mark) return "missing";
      await markBillingDirty(tx, [mark], { force: true });
      return "marked";
    });
    counts[outcome] += 1;
    if (outcome === "missing") {
      alerts.log.error(
        "billing",
        `resync ${entry.requestId}: ${entry.type} ${entry.aggregateId} no longer exists in Louez; counted as handled`,
      );
    }
  }
  return counts;
}

// ---------------------------------------------------------------- schedule

/** The 1st and the 2nd of each month, from 06:00 UTC (README §7.3). */
export function isManifestWindow(now: Date): boolean {
  return (now.getUTCDate() === 1 || now.getUTCDate() === 2) && now.getUTCHours() >= 6;
}

/**
 * On the 1st and the 2nd, requests once a day a manifest of the month that just
 * ended for every store created before its end.
 */
export async function scheduleMonthlyManifests(now: Date): Promise<number> {
  if (!isManifestWindow(now)) return 0;
  const period = previousPeriod(utcPeriod(now));
  const { end } = periodBounds(period);
  const today = utcSqlTime(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
  );
  const at = utcSqlTime(now);
  const [header] = await db.execute(
    sql`INSERT INTO billing_sync_manifests (store_id, period, requested_at, status)
        SELECT id, ${period}, ${at}, 'pending' FROM stores WHERE created_at < ${utcSqlTime(end)}
        ON DUPLICATE KEY UPDATE
          status = IF(requested_at < ${today}, 'pending', status),
          last_error = IF(requested_at < ${today}, NULL, last_error),
          requested_at = IF(requested_at < ${today}, ${at}, requested_at)`,
  );
  return header.affectedRows;
}

/** Pairs the heartbeat asked for (`manifestsWanted`), sent at the next chance. */
export async function requestManifests(
  pairs: ReadonlyArray<{ readonly storeId: string; readonly period: string }>,
  now: Date = new Date(),
): Promise<void> {
  if (pairs.length === 0) return;
  const at = utcSqlTime(now);
  await db.execute(
    sql`INSERT INTO billing_sync_manifests (store_id, period, requested_at, status)
        VALUES ${sql.join(
          pairs.map((pair) => sql`(${pair.storeId}, ${pair.period}, ${at}, 'pending')`),
          sql`, `,
        )}
        ON DUPLICATE KEY UPDATE status = 'pending', last_error = NULL, requested_at = ${at}`,
  );
}

// ---------------------------------------------------------------- build

type AggregateKey = {
  readonly type: "store" | "reservation" | "legacy_store" | "legacy_month";
  readonly aggregateId: string;
};

type ManifestAggregate = AggregateKey & { readonly version: number };

export type Manifest = {
  readonly storeId: string;
  readonly period: string;
  readonly generatedAt: string;
  readonly aggregates: readonly ManifestAggregate[];
};

type BuiltManifest =
  | { readonly kind: "manifest"; readonly manifest: Manifest }
  | { readonly kind: "refused"; readonly error: string };

/** Reservations of the store with a date or a money event in the period. */
async function reservationsInPeriod(storeId: string, start: Date, end: Date): Promise<string[]> {
  const inPeriod = (column: Parameters<typeof gte>[0]) => and(gte(column, start), lt(column, end));
  const isRefundRow = or(isNotNull(payments.stripeRefundId), isNotNull(payments.refundOfPaymentId));
  const rows = await db
    .select({ id: reservations.id })
    .from(reservations)
    .where(
      and(
        eq(reservations.storeId, storeId),
        or(
          inPeriod(reservations.billableAt),
          inPeriod(reservations.withdrawnAt),
          inPeriod(reservations.endDate),
          exists(
            db
              .select({ id: payments.id })
              .from(payments)
              .where(
                and(
                  eq(payments.reservationId, reservations.id),
                  or(
                    inPeriod(payments.paidAt),
                    // Refunds have no date of their own in older rows: their row times.
                    and(
                      isRefundRow,
                      or(inPeriod(payments.createdAt), inPeriod(payments.updatedAt)),
                    ),
                  ),
                ),
              ),
          ),
          exists(
            db
              .select({ id: paymentDisputes.id })
              .from(paymentDisputes)
              .where(
                and(
                  eq(paymentDisputes.reservationId, reservations.id),
                  or(inPeriod(paymentDisputes.openedAt), inPeriod(paymentDisputes.closedAt)),
                ),
              ),
          ),
        ),
      ),
    )
    .orderBy(asc(reservations.id))
    .limit(MAX_AGGREGATES + 1);
  return rows.map((row) => row.id);
}

export async function buildManifest(
  storeId: string,
  period: string,
  newStoresFrom: Date,
): Promise<BuiltManifest> {
  const [store] = await db
    .select({ createdAt: stores.createdAt })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);
  if (!store)
    return { kind: "refused", error: "store_missing: the store no longer exists in Louez" };

  const { start, end } = periodBounds(period);
  const generatedAt = await databaseNow();
  const reservationIds = await reservationsInPeriod(storeId, start, end);
  const legacy = store.createdAt.getTime() < newStoresFrom.getTime();
  const keys: AggregateKey[] = [{ type: "store", aggregateId: storeId }];
  for (const id of reservationIds) keys.push({ type: "reservation", aggregateId: id });
  // While legacy aggregates exist; a new store has none (README §8.3).
  if (legacy) {
    keys.push({ type: "legacy_store", aggregateId: storeId });
    keys.push({ type: "legacy_month", aggregateId: `${storeId}:${period}` });
  }
  if (keys.length > MAX_AGGREGATES) {
    return {
      kind: "refused",
      error: `too_many_aggregates: more than ${MAX_AGGREGATES} aggregates in ${period}`,
    };
  }

  // The version the service acknowledged, 0 when never delivered (Q23).
  const delivered = await db
    .select({
      type: billingSyncQueue.aggregateType,
      aggregateId: billingSyncQueue.aggregateId,
      deliveredVersion: billingSyncQueue.deliveredVersion,
    })
    .from(billingSyncQueue)
    .where(eq(billingSyncQueue.storeId, storeId));
  const versions = new Map(
    delivered.map((row) => [`${row.type}\u0000${row.aggregateId}`, row.deliveredVersion]),
  );
  return {
    kind: "manifest",
    manifest: {
      storeId,
      period,
      generatedAt: generatedAt.toISOString(),
      aggregates: keys.map((key) => ({
        ...key,
        version: versions.get(`${key.type}\u0000${key.aggregateId}`) ?? 0,
      })),
    },
  };
}

// ---------------------------------------------------------------- send

const manifestResultSchema = z.object({
  storeId: z.string(),
  period: z.string(),
  status: z.enum(["matched", "mismatched", "rejected"]),
  resync: z.array(resyncEntrySchema),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
});
const manifestsResponseSchema = z.object({ results: z.array(manifestResultSchema) });

export type ManifestRunResult = {
  readonly sent: number;
  readonly matched: number;
  readonly mismatched: number;
  readonly rejected: number;
  readonly retry: number;
  readonly outcome: "ok" | "waiting" | "failed";
  readonly detail: string | null;
};

export type ManifestOptions = {
  readonly alerts?: BillingAlerts;
  readonly client?: BillingClientOptions;
};

async function closeManifest(
  storeId: string,
  period: string,
  status: "matched" | "mismatched" | "rejected" | "pending",
  error: string | null,
): Promise<void> {
  await db
    .update(billingSyncManifests)
    .set({ status, lastError: error === null ? null : errorText(error), answeredAt: new Date() })
    .where(and(eq(billingSyncManifests.storeId, storeId), eq(billingSyncManifests.period, period)));
}

function packManifests(manifests: readonly Manifest[]): Manifest[][] {
  const requests: Manifest[][] = [];
  let current: Manifest[] = [];
  let size = Buffer.byteLength('{"manifests":[]}');
  for (const manifest of manifests) {
    const bytes = Buffer.byteLength(JSON.stringify(manifest)) + 1;
    if (
      current.length > 0 &&
      (current.length >= MAX_MANIFESTS_PER_REQUEST || size + bytes > MAX_BODY_BYTES)
    ) {
      requests.push(current);
      current = [];
      size = Buffer.byteLength('{"manifests":[]}');
    }
    size += bytes;
    current.push(manifest);
  }
  if (current.length > 0) requests.push(current);
  return requests;
}

/** Sends every pending manifest; retried on each run until a 200 carries its result. */
export async function sendPendingManifests(
  options: ManifestOptions = {},
): Promise<ManifestRunResult> {
  const alerts = options.alerts ?? createBillingAlerts();
  const config = options.client?.config ?? billingSyncConfig();
  const client: BillingClientOptions = { ...options.client, config };
  const counts = { sent: 0, matched: 0, mismatched: 0, rejected: 0, retry: 0 };

  if (isWaitingForRetryAfter(await readSyncState())) {
    return { ...counts, outcome: "waiting", detail: null };
  }

  const pending = await db
    .select({ storeId: billingSyncManifests.storeId, period: billingSyncManifests.period })
    .from(billingSyncManifests)
    .where(eq(billingSyncManifests.status, "pending"))
    .orderBy(asc(billingSyncManifests.requestedAt))
    .limit(PENDING_PER_RUN);
  if (pending.length === 0) return { ...counts, outcome: "ok", detail: null };

  const newStoresFrom = await newStoresCutoff(config.newStoresFrom);
  const manifests: Manifest[] = [];
  for (const { storeId, period } of pending) {
    const built = await buildManifest(storeId, period, newStoresFrom);
    if (built.kind === "manifest") {
      manifests.push(built.manifest);
      continue;
    }
    counts.rejected += 1;
    await closeManifest(storeId, period, "rejected", built.error);
    await alerts.alert(
      "manifest_rejected",
      `manifest ${storeId} ${period} not sent: ${built.error}`,
    );
  }

  for (const request of packManifests(manifests)) {
    await db
      .update(billingSyncManifests)
      .set({ sentAt: new Date() })
      .where(
        or(
          ...request.map((manifest) =>
            and(
              eq(billingSyncManifests.storeId, manifest.storeId),
              eq(billingSyncManifests.period, manifest.period),
            ),
          ),
        ),
      );
    const call = await callBillingService(
      {
        endpoint: "manifests",
        method: "POST",
        path: "/manifests",
        json: JSON.stringify({ manifests: request }),
      },
      client,
    );

    const body =
      call.kind === "response" && call.status === 200
        ? readSignedJson(call, manifestsResponseSchema)
        : null;
    const results = body?.ok ? body.value.results : null;
    const aligned =
      results !== null &&
      results.length === request.length &&
      results.every(
        (result, index) =>
          result.storeId === request[index]?.storeId && result.period === request[index]?.period,
      );

    if (!aligned || results === null) {
      // Nothing changes: the manifests stay pending for the next run.
      const failure = classifyFailure(call);
      const detail = body && !body.ok ? body.reason : failure.detail;
      if (failure.kind === "retry_after") {
        await updateSyncState({ retryAfterUntil: new Date(Date.now() + failure.seconds * 1000) });
        return { ...counts, outcome: "waiting", detail };
      }
      if (failure.kind === "auth") await alerts.alert("relay_auth", `POST /manifests: ${detail}`);
      else if (failure.kind === "contract") {
        await alerts.alert("relay_contract", `POST /manifests: ${detail}`);
      } else if (body && body.ok) {
        await alerts.alert(
          "response_invalid",
          "POST /manifests: the results do not match the manifests sent",
        );
      } else alerts.log.error("billing", `POST /manifests failed: ${detail}`);
      return { ...counts, outcome: "failed", detail };
    }

    counts.sent += request.length;
    for (const result of results) {
      if (result.status === "matched") {
        counts.matched += 1;
        await closeManifest(result.storeId, result.period, "matched", null);
      } else if (result.status === "mismatched") {
        counts.mismatched += 1;
        // Force-marked at once; the service asks for the manifest again afterwards.
        await applyResyncEntries(result.resync, alerts);
        await closeManifest(result.storeId, result.period, "mismatched", null);
      } else if (result.error?.code === "processing_failed") {
        counts.retry += 1;
        await closeManifest(result.storeId, result.period, "pending", "processing_failed");
      } else {
        counts.rejected += 1;
        const error = `${result.error?.code ?? "unknown"}: ${result.error?.message ?? ""}`;
        await closeManifest(result.storeId, result.period, "rejected", error);
        await alerts.alert(
          "manifest_rejected",
          `manifest ${result.storeId} ${result.period} rejected: ${error}`,
        );
      }
    }
  }
  return { ...counts, outcome: "ok", detail: null };
}

/** The cron task: schedules the monthly manifests, then sends what is pending. */
export async function runManifests(
  now: Date = new Date(),
  options: ManifestOptions = {},
): Promise<ManifestRunResult & { readonly scheduled: number }> {
  const scheduled = await scheduleMonthlyManifests(now);
  return { scheduled, ...(await sendPendingManifests(options)) };
}
