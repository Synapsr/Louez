import { sql } from "drizzle-orm";
import { z } from "zod";

import { type BillingMark, type Transaction, isBillingSyncEnabled, markBillingDirty } from "@louez/db";

import { type BillingAlerts, type BillingLog, createBillingAlerts } from "@/lib/billing-sync/alerts";
import { MAX_EVENT_BYTES } from "@/lib/billing-sync/relay";
import { buildReservationSnapshot } from "@/lib/billing-sync/snapshots/reservation-snapshot";
import { SnapshotDataError } from "@/lib/billing-sync/snapshots/snapshot-checks";
import type { ReservationSnapshotData } from "@/lib/billing-sync/snapshots/snapshot-data";
import { buildStoreSnapshot } from "@/lib/billing-sync/snapshots/store-snapshot";
import {
  databaseNow,
  periodBounds,
  previousPeriod,
  selectRows,
  sqlNumber,
  utcPeriod,
  utcSqlTime,
} from "@/lib/billing-sync/state";
import { log as evlog } from "@/lib/evlog";

// Final snapshots at account deletion (louez-billing docs/api, README §5.5). Inside the
// purge transaction, before the rows go, Louez writes the closing snapshot of each
// reservation the service may still bill, then the store's, and stores each body on its
// queue row with a forced mark. The relay sends those bodies as stored (relay.ts), never
// rebuilt, since the rows are gone. Queue rows are never deleted.

const MARK_CHUNK = 1000;
/**
 * The final store event's size, from which an account deletion alerts: its
 * `finalReservations` list grows with the store's billable set, and above
 * MAX_EVENT_BYTES the relay marks the row dead, so the service never closes the store.
 */
export const FINAL_STORE_ALERT_BYTES = Math.floor(MAX_EVENT_BYTES * 0.8);
/** Room for the envelope the relay wraps the body in (ids, version, observedAt). */
const ENVELOPE_ALLOWANCE_BYTES = 512;

/** What `billing_sync_queue.final_payload` holds; relay.ts reads it back. */
export type FinalPayload = {
  readonly observedAt: string;
  readonly data: unknown;
};

/** Billing facts an account deletion purges anyway, and that someone must know of. */
export type FinalSnapshotProblem =
  | {
      /** A reservation whose snapshot cannot be expressed: the service never bills it. */
      readonly kind: "reservation_skipped";
      readonly storeId: string;
      readonly reservationId: string;
      readonly reason: string;
    }
  | {
      /** A final store body near or above the relay's event limit. */
      readonly kind: "store_too_large";
      readonly storeId: string;
      readonly bytes: number;
      readonly finalReservations: number;
    };

export type FinalSnapshotsResult = {
  readonly stores: number;
  readonly reservations: number;
  /** Raise them with `alertFinalSnapshotProblems` once the purge has committed. */
  readonly problems: readonly FinalSnapshotProblem[];
};

export type FinalSnapshotOptions = {
  readonly log?: BillingLog;
  /** The purge's clock, the database's by default. */
  readonly observedAt?: Date;
  /** The reservation builder, replaceable in tests. */
  readonly buildReservation?: typeof buildReservationSnapshot;
};

const idRow = z.object({ id: z.string() });
const versionRow = z.object({ aggregateId: z.string(), version: sqlNumber });

/**
 * The reservations of a store the service may still bill after it is deleted: every
 * one in the billable set, every one with a pending queue row, and every one whose
 * billable, withdrawal or end date, or one of whose payments, refunds or disputes,
 * falls on or after `since`, the first day of the previous month.
 */
async function selectFinalReservationIds(
  tx: Transaction,
  storeId: string,
  since: Date,
): Promise<string[]> {
  const from = utcSqlTime(since);
  const rows = await selectRows(
    tx,
    sql`SELECT r.id FROM reservations r
        WHERE r.store_id = ${storeId} AND (
          r.reservation_status IN ('confirmed', 'ongoing', 'completed')
          OR r.billable_at >= ${from} OR r.withdrawn_at >= ${from} OR r.end_date >= ${from}
          OR EXISTS (SELECT 1 FROM billing_sync_queue q
                     WHERE q.aggregate_type = 'reservation' AND q.aggregate_id = r.id
                       AND q.status = 'pending')
          OR EXISTS (SELECT 1 FROM payments p
                     WHERE p.reservation_id = r.id
                       AND (p.created_at >= ${from} OR p.paid_at >= ${from}
                            OR p.updated_at >= ${from}))
          OR EXISTS (SELECT 1 FROM payment_disputes d
                     WHERE d.reservation_id = r.id
                       AND (d.created_at >= ${from} OR d.updated_at >= ${from}))
        )
        ORDER BY r.id`,
    idRow,
  );
  return rows.map((row) => row.id);
}

const byAggregateId = (a: { aggregateId: string }, b: { aggregateId: string }) =>
  a.aggregateId < b.aggregateId ? -1 : a.aggregateId > b.aggregateId ? 1 : 0;

/** Stores the closing body on an aggregate's queue row, which a forced mark made pending. */
async function storeFinalPayload(
  tx: Transaction,
  type: "store" | "reservation",
  aggregateId: string,
  payload: FinalPayload,
): Promise<void> {
  await tx.execute(
    sql`UPDATE billing_sync_queue SET final_payload = ${JSON.stringify(payload)}
        WHERE aggregate_type = ${type} AND aggregate_id = ${aggregateId}`,
  );
}

/** The queue version of each reservation, after the marks. */
async function readReservationVersions(
  tx: Transaction,
  aggregateIds: readonly string[],
): Promise<Map<string, number>> {
  const versions = new Map<string, number>();
  for (let index = 0; index < aggregateIds.length; index += MARK_CHUNK) {
    const ids = aggregateIds.slice(index, index + MARK_CHUNK).map((id) => sql`${id}`);
    const rows = await selectRows(
      tx,
      sql`SELECT aggregate_id AS aggregateId, version FROM billing_sync_queue
          WHERE aggregate_type = 'reservation' AND aggregate_id IN (${sql.join(ids, sql`, `)})`,
      versionRow,
    );
    for (const row of rows) versions.set(row.aggregateId, row.version);
  }
  return versions;
}

/**
 * The problem to raise for a final store body, or null. The size counts the envelope
 * the relay adds, so it errs on the large side.
 */
export function finalStoreSizeProblem(
  storeId: string,
  data: { readonly finalReservations: readonly unknown[] },
): FinalSnapshotProblem | null {
  const bytes = Buffer.byteLength(JSON.stringify(data), "utf8") + ENVELOPE_ALLOWANCE_BYTES;
  if (bytes < FINAL_STORE_ALERT_BYTES) return null;
  return { kind: "store_too_large", storeId, bytes, finalReservations: data.finalReservations.length };
}

async function writeStoreFinalSnapshots(
  tx: Transaction,
  storeId: string,
  observedAt: Date,
  options: Required<Pick<FinalSnapshotOptions, "log" | "buildReservation">>,
): Promise<{ reservations: number; store: boolean; problems: FinalSnapshotProblem[] }> {
  const since = periodBounds(previousPeriod(utcPeriod(observedAt))).start;
  const ids = await selectFinalReservationIds(tx, storeId, since);
  const at = observedAt.toISOString();

  const reservations: Array<{ aggregateId: string; payload: FinalPayload }> = [];
  const problems: FinalSnapshotProblem[] = [];
  for (const id of ids) {
    let data: ReservationSnapshotData | null = null;
    try {
      const built = await options.buildReservation(tx, {
        type: "reservation",
        aggregateId: id,
        storeId,
      });
      if (built.kind === "snapshot") data = { ...built.data, deleted: true };
    } catch (error) {
      // A data error never heals, and the relay would mark such a row dead anyway: the
      // deletion goes on without it, and the caller alerts once the purge has committed.
      // Anything else, such as a lost connection, may heal: the deletion fails and can
      // be retried, rather than purge a reservation the service still bills.
      if (!(error instanceof SnapshotDataError)) throw error;
      options.log.error(
        "billing",
        `final snapshot of reservation ${id} of deleted store ${storeId} skipped: ${error.message}`,
      );
      problems.push({ kind: "reservation_skipped", storeId, reservationId: id, reason: error.message });
    }
    if (data) reservations.push({ aggregateId: id, payload: { observedAt: at, data } });
  }
  reservations.sort(byAggregateId);

  const built = await buildStoreSnapshot(tx, { type: "store", aggregateId: storeId, storeId });

  // Forced marks: every row pending, its sent hash cleared, a dead row revived. The
  // store's row first, in the order every mark locks queue rows (billing-queue.ts).
  const marks: BillingMark[] = [
    ...(built.kind === "snapshot" ? [{ type: "store" as const, aggregateId: storeId, storeId }] : []),
    ...reservations.map(({ aggregateId }) => ({
      type: "reservation" as const,
      aggregateId,
      storeId,
    })),
  ];
  for (let index = 0; index < marks.length; index += MARK_CHUNK) {
    await markBillingDirty(tx, marks.slice(index, index + MARK_CHUNK), { force: true });
  }
  for (const { aggregateId, payload } of reservations) {
    await storeFinalPayload(tx, "reservation", aggregateId, payload);
  }
  if (built.kind !== "snapshot") return { reservations: reservations.length, store: false, problems };

  const versions = await readReservationVersions(
    tx,
    reservations.map(({ aggregateId }) => aggregateId),
  );
  const finalReservations = reservations.flatMap(({ aggregateId }) => {
    const version = versions.get(aggregateId);
    return version === undefined ? [] : [{ aggregateId, version }];
  });
  // The service already holds the slug and the owners from earlier snapshots.
  const data = { ...built.data, deleted: true, slug: null, ownerUserIds: [], finalReservations };
  await storeFinalPayload(tx, "store", storeId, { observedAt: at, data });
  const sizeProblem = finalStoreSizeProblem(storeId, data);
  if (sizeProblem) problems.push(sizeProblem);
  return { reservations: reservations.length, store: true, problems };
}

/** What the reservation builder reads, by reservation; the store builder's, by store. */
const RESERVATION_FACTS = [
  "reservation_items",
  "payments",
  "payment_disputes",
  "payment_requests",
  "reservation_activity",
  "platform_fee",
] as const;
const STORE_FACTS = ["store_legal_profiles", "store_marketplace_channels", "subscriptions"] as const;

/**
 * Locks the rows the final snapshots read: the stores' reservations, then each of
 * their tables, then the stores' own. The locks also block inserts, which no foreign
 * key fences. Call it before the purge transaction's first plain read: under
 * REPEATABLE READ that read fixes the snapshot the final bodies are built from, so a
 * payment or status written after it would be missing from them. The deletes take
 * these locks anyway; they only start earlier. Without the billing service it locks
 * nothing, like every mark.
 */
export async function lockFinalSnapshotFacts(
  tx: Transaction,
  storeIds: readonly string[],
): Promise<void> {
  if (!isBillingSyncEnabled() || storeIds.length === 0) return;
  const stores = sql.join(
    storeIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const reservations = await selectRows(
    tx,
    sql`SELECT id FROM reservations WHERE store_id IN (${stores}) ORDER BY id FOR UPDATE`,
    idRow,
  );
  for (const table of RESERVATION_FACTS) {
    for (let index = 0; index < reservations.length; index += MARK_CHUNK) {
      const ids = reservations.slice(index, index + MARK_CHUNK).map(({ id }) => sql`${id}`);
      await tx.execute(
        sql`SELECT id FROM ${sql.identifier(table)}
            WHERE reservation_id IN (${sql.join(ids, sql`, `)}) FOR UPDATE`,
      );
    }
  }
  for (const table of STORE_FACTS) {
    await tx.execute(
      sql`SELECT id FROM ${sql.identifier(table)} WHERE store_id IN (${stores}) FOR UPDATE`,
    );
  }
}

/**
 * Writes the final snapshots of the stores an account deletion is about to purge.
 * Call it inside the purge transaction, after `lockFinalSnapshotFacts` and before any
 * row is deleted, and pass the problems it returns to `alertFinalSnapshotProblems`
 * once the transaction commits.
 * Without the billing service it writes nothing, like every mark.
 */
export async function writeFinalSnapshots(
  tx: Transaction,
  storeIds: readonly string[],
  options: FinalSnapshotOptions = {},
): Promise<FinalSnapshotsResult> {
  let stores = 0;
  let reservations = 0;
  const problems: FinalSnapshotProblem[] = [];
  if (!isBillingSyncEnabled() || storeIds.length === 0) return { stores, reservations, problems };
  const observedAt = options.observedAt ?? (await databaseNow(tx));
  const resolved = {
    log: options.log ?? evlog,
    buildReservation: options.buildReservation ?? buildReservationSnapshot,
  };
  for (const storeId of [...storeIds].sort()) {
    const written = await writeStoreFinalSnapshots(tx, storeId, observedAt, resolved);
    reservations += written.reservations;
    problems.push(...written.problems);
    if (written.store) stores += 1;
  }
  return { stores, reservations, problems };
}

/**
 * Alerts on what a committed account deletion purged without a final snapshot, and on
 * final store bodies the relay may refuse. Never throws, like every alert.
 */
export async function alertFinalSnapshotProblems(
  problems: readonly FinalSnapshotProblem[],
  alerts: BillingAlerts = createBillingAlerts(),
): Promise<void> {
  const skipped = problems.filter((problem) => problem.kind === "reservation_skipped");
  if (skipped.length > 0) {
    const list = skipped
      .map((problem) => `reservation ${problem.reservationId} of store ${problem.storeId} (${problem.reason})`)
      .join("; ");
    await alerts.alert(
      "final_snapshot_skipped",
      `an account deletion purged ${skipped.length} reservation(s) without a final snapshot, so the billing service will never bill them: ${list}`,
    );
  }
  for (const problem of problems) {
    if (problem.kind !== "store_too_large") continue;
    const verdict =
      problem.bytes > MAX_EVENT_BYTES
        ? "above the limit: the relay will mark the row dead and the service will never close the store"
        : "close to the limit";
    await alerts.alert(
      "final_snapshot_large",
      `the final snapshot of deleted store ${problem.storeId} lists ${problem.finalReservations} reservations, about ${problem.bytes} bytes against the relay's ${MAX_EVENT_BYTES}: ${verdict}`,
    );
  }
}
