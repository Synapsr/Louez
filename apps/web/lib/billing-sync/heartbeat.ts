import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import {
  BILLABLE_RESERVATION_STATUSES,
  type BillingMark,
  billingSyncHandledRequests,
  countBillableReservationsWithoutBillableAt,
  db,
  isPaymentReceiptSql,
  markBillingDirty,
  markReservationIds,
  payments,
  reservations,
  stores,
} from "@louez/db";

import { env } from "@/env";

import { type BillingAlerts, createBillingAlerts } from "@/lib/billing-sync/alerts";
import {
  type BillingClientOptions,
  callBillingService,
  classifyFailure,
  readSignedJson,
} from "@/lib/billing-sync/client";
import { billingSyncConfig } from "@/lib/billing-sync/config";
import { withBillingLock } from "@/lib/billing-sync/locks";
import {
  type ManifestRunResult,
  applyResyncEntries,
  claimRequestId,
  requestManifests,
  resyncEntrySchema,
  sendPendingManifests,
} from "@/lib/billing-sync/manifests";
import {
  type PolicyPullResult,
  contractTimestamp,
  isPolicyCacheEmpty,
  pullPolicies,
} from "@/lib/billing-sync/policies";
import {
  type SyncState,
  databaseNow,
  isWaitingForRetryAfter,
  readSyncState,
  selectRows,
  sqlNumber,
  unixSeconds,
  updateSyncState,
} from "@/lib/billing-sync/state";

// The heartbeat (louez-billing docs/api, README §7.1 and §7.2): every minute after
// the relay, Louez reports its queue and invariants, then does what the answer asks,
// in order: pull policies, resync aggregates, resync stores, send manifests.

const LIST_LIMIT = 1000;
const STALE_PENDING_MINUTES = 10;
const CLOCK_SKEW_MS = 60_000;
const POLICY_REVALIDATE_MS = 10 * 60 * 1000;
const POLICY_STALE_MS = 15 * 60 * 1000;
const HANDLED_KEEP_DAYS = 7;
const MARK_CHUNK = 1000;

export type HeartbeatRequest = {
  readonly at: string;
  readonly louezVersion: string;
  readonly queue: {
    readonly pending: number;
    readonly oldestPendingMarkedAt: string | null;
    readonly dead: number;
    readonly deadByStore: ReadonlyArray<{ storeId: string; dead: number }>;
    readonly stalePendingByStore: ReadonlyArray<{
      storeId: string;
      pending: number;
      oldestMarkedAt: string;
    }>;
    readonly truncated: boolean;
  };
  readonly invariants: {
    readonly billableWithoutBillableAt: number;
    readonly completedPaymentsWithoutGross: number | null;
    readonly byStore: ReadonlyArray<{
      storeId: string;
      billableWithoutBillableAt: number;
      completedPaymentsWithoutGross: number | null;
    }>;
  };
  readonly policies: { readonly etag: string | null; readonly lastPullAt: string | null };
  readonly lastSweepAt: string | null;
  readonly handledRequestIds: readonly string[];
};

const iso = (date: Date | null) => date?.toISOString() ?? null;

/** Per-store lists hold at most 1,000 entries; a longer one sets `truncated`. */
function capped<T>(rows: readonly T[]): { list: T[]; truncated: boolean } {
  return { list: rows.slice(0, LIST_LIMIT), truncated: rows.length > LIST_LIMIT };
}

async function queueReport(): Promise<{ queue: HeartbeatRequest["queue"]; truncated: boolean }> {
  const [totals] = await selectRows(
    db,
    sql`SELECT SUM(status = 'pending') AS pending, SUM(status = 'dead') AS dead,
               UNIX_TIMESTAMP(MIN(IF(status = 'pending', marked_at, NULL))) AS oldest
        FROM billing_sync_queue`,
    z.object({ pending: sqlNumber, dead: sqlNumber, oldest: unixSeconds }),
  );
  const dead = capped(
    await selectRows(
      db,
      sql`SELECT store_id AS storeId, COUNT(*) AS dead FROM billing_sync_queue
          WHERE status = 'dead' GROUP BY store_id ORDER BY store_id LIMIT ${LIST_LIMIT + 1}`,
      z.object({ storeId: z.string(), dead: sqlNumber }),
    ),
  );
  const stale = capped(
    await selectRows(
      db,
      sql`SELECT store_id AS storeId, COUNT(*) AS pending,
                 UNIX_TIMESTAMP(MIN(marked_at)) AS oldestMarkedAt
          FROM billing_sync_queue
          WHERE status = 'pending' AND marked_at < NOW(3) - INTERVAL ${STALE_PENDING_MINUTES} MINUTE
          GROUP BY store_id ORDER BY store_id LIMIT ${LIST_LIMIT + 1}`,
      z.object({ storeId: z.string(), pending: sqlNumber, oldestMarkedAt: unixSeconds }),
    ),
  );
  return {
    queue: {
      pending: totals?.pending ?? 0,
      oldestPendingMarkedAt: iso(totals?.oldest ?? null),
      dead: totals?.dead ?? 0,
      deadByStore: dead.list,
      stalePendingByStore: stale.list.map((row) => ({
        storeId: row.storeId,
        pending: row.pending,
        oldestMarkedAt: iso(row.oldestMarkedAt) ?? new Date(0).toISOString(),
      })),
      truncated: dead.truncated || stale.truncated,
    },
    truncated: dead.truncated || stale.truncated,
  };
}

async function invariantsReport(state: SyncState): Promise<{
  invariants: HeartbeatRequest["invariants"];
  truncated: boolean;
}> {
  const billableWithoutBillableAt = await countBillableReservationsWithoutBillableAt(db);
  const billableByStore = await db
    .select({ storeId: reservations.storeId, missing: count() })
    .from(reservations)
    .where(
      and(
        inArray(reservations.status, [...BILLABLE_RESERVATION_STATUSES]),
        isNull(reservations.billableAt),
      ),
    )
    .groupBy(reservations.storeId);
  // Completed payments that are not refunds and have no stored gross amount. Payments
  // from before gross_minor have none until the gross backfill has run, so until then
  // the count is null, in total and per store (README Q7).
  const countsGross = state.grossBackfilledAt !== null;
  const grossByStore = countsGross
    ? await db
        .select({ storeId: reservations.storeId, missing: count() })
        .from(payments)
        .innerJoin(reservations, eq(reservations.id, payments.reservationId))
        .where(
          and(eq(payments.status, "completed"), isNull(payments.grossMinor), isPaymentReceiptSql()),
        )
        .groupBy(reservations.storeId)
    : [];

  const byStore = new Map<
    string,
    {
      storeId: string;
      billableWithoutBillableAt: number;
      completedPaymentsWithoutGross: number | null;
    }
  >();
  const entry = (storeId: string) => {
    const known = byStore.get(storeId);
    if (known) return known;
    const created = {
      storeId,
      billableWithoutBillableAt: 0,
      completedPaymentsWithoutGross: countsGross ? 0 : null,
    };
    byStore.set(storeId, created);
    return created;
  };
  for (const row of billableByStore) entry(row.storeId).billableWithoutBillableAt = row.missing;
  for (const row of grossByStore) entry(row.storeId).completedPaymentsWithoutGross = row.missing;
  const list = capped([...byStore.values()].sort((a, b) => a.storeId.localeCompare(b.storeId)));
  return {
    invariants: {
      billableWithoutBillableAt,
      completedPaymentsWithoutGross: countsGross
        ? grossByStore.reduce((sum, row) => sum + row.missing, 0)
        : null,
      byStore: list.list,
    },
    truncated: list.truncated,
  };
}

const requestIds = z.array(z.string()).catch([]);

/** The ids of the previous response's entries that Louez handled, now or before (§7.2). */
async function handledRequestIds(state: SyncState): Promise<string[]> {
  const previous = [...new Set(requestIds.parse(state.pendingRequestIds ?? []))];
  if (previous.length === 0) return [];
  const rows = await db
    .select({ requestId: billingSyncHandledRequests.requestId })
    .from(billingSyncHandledRequests)
    .where(inArray(billingSyncHandledRequests.requestId, previous));
  const handled = new Set(rows.map((row) => row.requestId));
  return previous.filter((id) => handled.has(id)).slice(0, LIST_LIMIT);
}

export async function buildHeartbeatRequest(state: SyncState): Promise<HeartbeatRequest> {
  const { queue, truncated: queueTruncated } = await queueReport();
  const { invariants, truncated: invariantsTruncated } = await invariantsReport(state);
  return {
    at: (await databaseNow()).toISOString(),
    louezVersion: (env.NEXT_PUBLIC_APP_VERSION ?? "unknown").slice(0, 64),
    queue: { ...queue, truncated: queueTruncated || invariantsTruncated },
    invariants,
    policies: { etag: state.policiesEtag, lastPullAt: iso(state.lastPolicyPullAt) },
    lastSweepAt: iso(state.lastSweepAt),
    handledRequestIds: await handledRequestIds(state),
  };
}

const heartbeatResponseSchema = z.object({
  serverTime: contractTimestamp,
  policiesEtag: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  resync: z.array(resyncEntrySchema),
  resyncStores: z.array(
    z.object({
      storeId: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
      requestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    }),
  ),
  manifestsWanted: z.array(
    z.object({
      storeId: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
      period: z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/),
    }),
  ),
});
type HeartbeatResponse = z.infer<typeof heartbeatResponseSchema>;

/**
 * Every aggregate of a store, force-marked: the store, its reservations, its
 * legacy_store and every legacy_month Louez has rows or a queue row for. A new
 * store's legacy aggregates are marked too; the relay skips them.
 */
async function forceMarkStore(
  storeId: string,
  requestId: string,
): Promise<"marked" | "missing" | "repeated"> {
  return db.transaction(async (tx) => {
    if (!(await claimRequestId(tx, requestId))) return "repeated";
    const [store] = await tx.select({ id: stores.id }).from(stores).where(eq(stores.id, storeId));
    if (!store) return "missing";
    const months = await selectRows(
      tx,
      sql`SELECT billing_month AS period FROM platform_fee WHERE store_id = ${storeId}
          UNION SELECT billing_month FROM pay_as_you_go_invoices WHERE store_id = ${storeId}
          UNION SELECT SUBSTRING_INDEX(aggregate_id, ':', -1) FROM billing_sync_queue
                WHERE store_id = ${storeId} AND aggregate_type = 'legacy_month'`,
      z.object({ period: z.string() }),
    );
    const marks: BillingMark[] = [
      { type: "store", aggregateId: storeId, storeId },
      { type: "legacy_store", aggregateId: storeId, storeId },
      ...months.map(
        ({ period }): BillingMark => ({
          type: "legacy_month",
          aggregateId: `${storeId}:${period}`,
          storeId,
        }),
      ),
    ];
    await markBillingDirty(tx, marks, { force: true });
    const ids = await tx
      .select({ id: reservations.id })
      .from(reservations)
      .where(eq(reservations.storeId, storeId));
    for (let index = 0; index < ids.length; index += MARK_CHUNK) {
      await markReservationIds(
        tx,
        ids.slice(index, index + MARK_CHUNK).map((row) => row.id),
        { force: true },
      );
    }
    return "marked";
  });
}

export type HeartbeatResult =
  | {
      readonly outcome: "ok";
      readonly policies: PolicyPullResult | null;
      readonly resync: { marked: number; missing: number; repeated: number };
      readonly resyncStores: { marked: number; missing: number; repeated: number };
      readonly manifests: ManifestRunResult | "locked" | null;
    }
  | { readonly outcome: "waiting" | "failed"; readonly detail: string | null };

export type HeartbeatOptions = {
  readonly alerts?: BillingAlerts;
  readonly client?: BillingClientOptions;
};

export async function runHeartbeat(options: HeartbeatOptions = {}): Promise<HeartbeatResult> {
  const alerts = options.alerts ?? createBillingAlerts();
  const config = options.client?.config ?? billingSyncConfig();
  const client: BillingClientOptions = { ...options.client, config };
  const state = await readSyncState();
  if (isWaitingForRetryAfter(state)) return { outcome: "waiting", detail: null };

  const request = await buildHeartbeatRequest(state);
  const call = await callBillingService(
    { endpoint: "heartbeat", method: "POST", path: "/heartbeat", json: JSON.stringify(request) },
    client,
  );
  const body =
    call.kind === "response" && call.status === 200
      ? readSignedJson(call, heartbeatResponseSchema)
      : null;
  if (!body?.ok) {
    const failure = classifyFailure(call);
    const detail = body ? body.reason : failure.detail;
    if (failure.kind === "retry_after") {
      await updateSyncState({ retryAfterUntil: new Date(Date.now() + failure.seconds * 1000) });
      return { outcome: "waiting", detail };
    }
    if (failure.kind === "auth") await alerts.alert("relay_auth", `POST /heartbeat: ${detail}`);
    else if (failure.kind === "contract") {
      await alerts.alert("relay_contract", `POST /heartbeat: ${detail}`);
    } else if (body) await alerts.alert("response_invalid", `POST /heartbeat: ${detail}`);
    else alerts.log.error("billing", `POST /heartbeat failed: ${detail}`);
    await purgeHandledRequests();
    return { outcome: "failed", detail };
  }

  const result = await handleHeartbeatResponse(body.value, state, alerts, client);
  await purgeHandledRequests();
  return result;
}

async function handleHeartbeatResponse(
  response: HeartbeatResponse,
  state: SyncState,
  alerts: BillingAlerts,
  client: BillingClientOptions,
): Promise<HeartbeatResult> {
  await updateSyncState({ lastHeartbeatOkAt: new Date() });

  const skew = Date.now() - Date.parse(response.serverTime);
  if (Math.abs(skew) > CLOCK_SKEW_MS) {
    await alerts.alert(
      "clock_skew",
      `Louez's clock is ${Math.round(skew / 1000)} s away from the billing service (serverTime ${response.serverTime})`,
    );
  }

  // 1. Policies: a new ETag or an empty cache; also revalidated every 10 minutes,
  // so the last pull stays fresh while nothing changes (README §8.5).
  const lastPull = state.lastPolicyPullAt?.getTime() ?? 0;
  const policies =
    response.policiesEtag !== state.policiesEtag ||
    Date.now() - lastPull > POLICY_REVALIDATE_MS ||
    (await isPolicyCacheEmpty())
      ? await pullPolicies({ alerts, client })
      : null;
  const pulledAt = (await readSyncState()).lastPolicyPullAt;
  if (Date.now() - (pulledAt?.getTime() ?? 0) > POLICY_STALE_MS) {
    await alerts.alert(
      "policies_stale",
      `the last successful policy pull is older than 15 minutes (${pulledAt?.toISOString() ?? "never"})`,
    );
  }

  // 2. Aggregates to resync.
  const resync = await applyResyncEntries(response.resync, alerts);

  // 3. Stores to resync in full.
  const resyncStores = { marked: 0, missing: 0, repeated: 0 };
  for (const entry of response.resyncStores) {
    const outcome = await forceMarkStore(entry.storeId, entry.requestId);
    resyncStores[outcome] += 1;
    if (outcome === "missing") {
      alerts.log.error(
        "billing",
        `resync ${entry.requestId}: store ${entry.storeId} no longer exists in Louez; counted as handled`,
      );
    }
  }

  // Listed as handled in the next heartbeat, once handled.
  await updateSyncState({
    pendingRequestIds: [
      ...new Set([
        ...response.resync.map((entry) => entry.requestId),
        ...response.resyncStores.map((entry) => entry.requestId),
      ]),
    ],
  });

  // 4. Manifests the service asks for. When the manifests task holds its lock, it
  // sends them itself.
  let manifests: ManifestRunResult | "locked" | null = null;
  if (response.manifestsWanted.length > 0) {
    await requestManifests(response.manifestsWanted);
    const run = await withBillingLock("manifests", () => sendPendingManifests({ alerts, client }));
    manifests = run.ran ? run.value : "locked";
  }

  return { outcome: "ok", policies, resync, resyncStores, manifests };
}

async function purgeHandledRequests(): Promise<void> {
  await db.execute(
    sql`DELETE FROM billing_sync_handled_requests
        WHERE handled_at < NOW(3) - INTERVAL ${HANDLED_KEEP_DAYS} DAY`,
  );
}
