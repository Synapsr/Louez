/**
 * Force-marks billing aggregates, so the relay sends their snapshots again
 * (louez-billing docs/api, README §5.2, §5.7, §6 and §12).
 *
 * Exactly one of:
 *   --all [--version-bump=N]     every store, reservation and legacy aggregate. After a
 *                                restore of Louez's database, before the relay runs again:
 *                                --all --version-bump=10000000 (README §5.7).
 *   --store=<id>                 one store, its reservations and its legacy aggregates.
 *   --reservations-since=<date>  reservations created or updated since an ISO date.
 *   --legacy                     every legacy_store and legacy_month.
 *   --dead                       requeues the dead rows and resets their attempt count.
 *
 * Every mark is forced: it bumps the version, clears the sent hash and revives a dead
 * row. Dry run by default: it prints what it would mark and writes nothing. It writes
 * whatever LOUEZ_BILLING says, which is how the queue is backfilled when
 * BILLING_SERVICE_URL is set later (README §12). Safe to run again, and safe while the
 * app runs.
 *
 * Targets MIGRATE_DATABASE_URL only; no .env file is read.
 *
 * Usage:
 *   MIGRATE_DATABASE_URL="mysql://user:pass@host:port/db" \
 *     pnpm billing:mark -- --all [--version-bump=10000000] [--apply]
 */
import { parseArgs } from "node:util";

import type { Connection, RowDataPacket } from "mysql2/promise";

import { type BillingMark, billingMarkStatement } from "@louez/db/billing-queue";

import { connectTarget, fail, scriptArgs } from "./payg-pricing-cli";

const { values } = parseArgs({
  args: scriptArgs(),
  options: {
    all: { type: "boolean", default: false },
    "version-bump": { type: "string" },
    store: { type: "string" },
    "reservations-since": { type: "string" },
    legacy: { type: "boolean", default: false },
    dead: { type: "boolean", default: false },
    apply: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(`Usage: run-billing-mark.ts <mode> [--apply]
  --all [--version-bump=N]     Every store, reservation and legacy aggregate; N is added
                               to every version first (after a database restore).
  --store=<id>                 One store, its reservations and its legacy aggregates.
  --reservations-since=<date>  Reservations created or updated since an ISO date.
  --legacy                     Every legacy_store and legacy_month.
  --dead                       Requeue the dead rows and reset their attempt count.
  --apply                      Write the marks (default: dry run).`);
  process.exit(0);
}

const CHUNK = 1000;
const MAX_VERSION = 4_294_967_295;

type Mode =
  | { readonly kind: "all"; readonly versionBump: number }
  | { readonly kind: "store"; readonly storeId: string }
  | { readonly kind: "reservations"; readonly since: Date }
  | { readonly kind: "legacy" }
  | { readonly kind: "dead" };

function readMode(): Mode {
  const chosen = [
    values.all,
    values.store !== undefined,
    values["reservations-since"] !== undefined,
    values.legacy,
    values.dead,
  ].filter(Boolean).length;
  if (chosen !== 1) {
    fail("Pass exactly one of --all, --store, --reservations-since, --legacy, --dead.");
  }
  if (values["version-bump"] !== undefined && !values.all) fail("--version-bump goes with --all.");
  if (values.all) {
    const raw = values["version-bump"] ?? "0";
    if (!/^\d+$/.test(raw) || Number(raw) > 1_000_000_000) {
      fail(`--version-bump must be a whole number up to 1000000000, got "${raw}".`);
    }
    return { kind: "all", versionBump: Number(raw) };
  }
  if (values.store !== undefined) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(values.store)) fail(`Not a store id: "${values.store}".`);
    return { kind: "store", storeId: values.store };
  }
  if (values["reservations-since"] !== undefined) {
    const since = new Date(values["reservations-since"]);
    if (Number.isNaN(since.getTime())) {
      fail(`--reservations-since must be an ISO date, got "${values["reservations-since"]}".`);
    }
    return { kind: "reservations", since };
  }
  return values.legacy ? { kind: "legacy" } : { kind: "dead" };
}

/** `YYYY-MM` of now and of the month before, in UTC, like the nightly sweep. */
function recentPeriods(): string[] {
  const now = new Date();
  const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return [now.toISOString().slice(0, 7), previous.toISOString().slice(0, 7)];
}

function utcText(date: Date): string {
  return date.toISOString().slice(0, 23).replace("T", " ");
}

async function select<T extends RowDataPacket>(
  connection: Connection,
  statement: string,
  params: unknown[],
): Promise<T[]> {
  const [rows] = await connection.query<T[]>(statement, params);
  return rows;
}

type StoreRow = RowDataPacket & { id: string };
type ReservationRow = RowDataPacket & { id: string; storeId: string };
type MonthRow = RowDataPacket & { storeId: string; period: string };
type QueueRow = RowDataPacket & { type: BillingMark["type"]; aggregateId: string; storeId: string };

async function* storeMarks(
  connection: Connection,
  storeId?: string,
): AsyncGenerator<BillingMark[]> {
  let cursor = "";
  for (;;) {
    const rows = await select<StoreRow>(
      connection,
      `SELECT id FROM stores WHERE id > ? ${storeId ? "AND id = ?" : ""} ORDER BY id LIMIT ${CHUNK}`,
      storeId ? [cursor, storeId] : [cursor],
    );
    if (rows.length === 0) return;
    cursor = rows[rows.length - 1]?.id ?? cursor;
    yield rows.map((row) => ({ type: "store", aggregateId: row.id, storeId: row.id }));
  }
}

async function* reservationMarks(
  connection: Connection,
  filter: { storeId?: string; since?: Date },
): AsyncGenerator<BillingMark[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.storeId) {
    where.push("AND store_id = ?");
    params.push(filter.storeId);
  }
  if (filter.since) {
    where.push("AND (created_at >= ? OR updated_at >= ?)");
    params.push(utcText(filter.since), utcText(filter.since));
  }
  let cursor = "";
  for (;;) {
    const rows = await select<ReservationRow>(
      connection,
      `SELECT id, store_id AS storeId FROM reservations
       WHERE id > ? ${where.join(" ")} ORDER BY id LIMIT ${CHUNK}`,
      [cursor, ...params],
    );
    if (rows.length === 0) return;
    cursor = rows[rows.length - 1]?.id ?? cursor;
    yield rows.map((row) => ({ type: "reservation", aggregateId: row.id, storeId: row.storeId }));
  }
}

/**
 * Every legacy_store, and the legacy_month of every month a store has fee or invoice
 * rows or a queue row for, plus this month and the previous one. A new store's legacy
 * aggregates are marked too; the relay skips them (plan decision 4).
 */
async function* legacyMarks(
  connection: Connection,
  storeId?: string,
): AsyncGenerator<BillingMark[]> {
  const periods = recentPeriods();
  for await (const stores of storeMarks(connection, storeId)) {
    yield stores.flatMap((store) => [
      { type: "legacy_store", aggregateId: store.storeId, storeId: store.storeId },
      ...periods.map(
        (period): BillingMark => ({
          type: "legacy_month",
          aggregateId: `${store.storeId}:${period}`,
          storeId: store.storeId,
        }),
      ),
    ]);
  }
  let cursor = { storeId: "", period: "" };
  for (;;) {
    const rows = await select<MonthRow>(
      connection,
      `SELECT m.store_id AS storeId, m.period FROM (
         SELECT store_id, billing_month AS period FROM platform_fee
         UNION SELECT store_id, billing_month FROM pay_as_you_go_invoices
         UNION SELECT store_id, SUBSTRING_INDEX(aggregate_id, ':', -1) FROM billing_sync_queue
               WHERE aggregate_type = 'legacy_month'
       ) m JOIN stores s ON s.id = m.store_id
       WHERE (m.store_id, m.period) > (?, ?) ${storeId ? "AND m.store_id = ?" : ""}
       ORDER BY m.store_id, m.period LIMIT ${CHUNK}`,
      storeId ? [cursor.storeId, cursor.period, storeId] : [cursor.storeId, cursor.period],
    );
    if (rows.length === 0) return;
    const last = rows[rows.length - 1];
    if (last) cursor = { storeId: last.storeId, period: last.period };
    yield rows
      .filter((row) => !periods.includes(row.period))
      .map((row) => ({
        type: "legacy_month",
        aggregateId: `${row.storeId}:${row.period}`,
        storeId: row.storeId,
      }));
  }
}

async function* deadMarks(connection: Connection): AsyncGenerator<BillingMark[]> {
  let cursor = { type: "", aggregateId: "" };
  for (;;) {
    const rows = await select<QueueRow>(
      connection,
      `SELECT aggregate_type AS type, aggregate_id AS aggregateId, store_id AS storeId
       FROM billing_sync_queue
       WHERE status = 'dead' AND (CAST(aggregate_type AS CHAR), aggregate_id) > (?, ?)
       ORDER BY CAST(aggregate_type AS CHAR), aggregate_id LIMIT ${CHUNK}`,
      [cursor.type, cursor.aggregateId],
    );
    if (rows.length === 0) return;
    const last = rows[rows.length - 1];
    if (last) cursor = { type: last.type, aggregateId: last.aggregateId };
    yield rows.map((row) => ({
      type: row.type,
      aggregateId: row.aggregateId,
      storeId: row.storeId,
    }));
  }
}

function sources(connection: Connection, mode: Mode): Array<AsyncGenerator<BillingMark[]>> {
  switch (mode.kind) {
    case "all":
      return [storeMarks(connection), reservationMarks(connection, {}), legacyMarks(connection)];
    case "store":
      return [
        storeMarks(connection, mode.storeId),
        reservationMarks(connection, { storeId: mode.storeId }),
        legacyMarks(connection, mode.storeId),
      ];
    case "reservations":
      return [reservationMarks(connection, { since: mode.since })];
    case "legacy":
      return [legacyMarks(connection)];
    case "dead":
      return [deadMarks(connection)];
  }
}

/** One chunk of forced marks, in one transaction. */
async function writeChunk(connection: Connection, marks: BillingMark[], mode: Mode): Promise<void> {
  const statement = billingMarkStatement(marks, { force: true });
  if (!statement) return;
  await connection.beginTransaction();
  try {
    if (mode.kind === "all" && mode.versionBump > 0) {
      // Aggregates without a row start above every id the service may hold.
      await connection.query(
        `INSERT IGNORE INTO billing_sync_queue (aggregate_type, aggregate_id, store_id, version)
         VALUES ${marks.map(() => "(?, ?, ?, ?)").join(", ")}`,
        marks.flatMap((mark) => [mark.type, mark.aggregateId, mark.storeId, mode.versionBump]),
      );
    }
    await connection.query(statement.sql, statement.params);
    if (mode.kind === "dead") {
      await connection.query(
        `UPDATE billing_sync_queue SET attempt_count = 0, failing_since = NULL, last_error = NULL
         WHERE (aggregate_type, aggregate_id) IN (${marks.map(() => "(?, ?)").join(", ")})`,
        marks.flatMap((mark) => [mark.type, mark.aggregateId]),
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

async function main() {
  const mode = readMode();
  const connection = await connectTarget();
  try {
    const [queue] = await select<RowDataPacket & { n: number }>(
      connection,
      `SELECT COUNT(*) AS n FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_sync_queue'`,
      [],
    );
    if (Number(queue?.n) !== 1) fail("No billing_sync_queue table: run migration 0085 first.");
    if (mode.kind === "store") {
      const [store] = await select<StoreRow>(connection, "SELECT id FROM stores WHERE id = ?", [
        mode.storeId,
      ]);
      if (!store) fail(`No store ${mode.storeId}.`);
    }

    if (values.apply && mode.kind === "all" && mode.versionBump > 0) {
      const [top] = await select<RowDataPacket & { version: number | null }>(
        connection,
        "SELECT MAX(version) AS version FROM billing_sync_queue",
        [],
      );
      if (Number(top?.version ?? 0) + mode.versionBump + 1 > MAX_VERSION) {
        fail("--version-bump would push a version past 4294967295.");
      }
      await connection.query("UPDATE billing_sync_queue SET version = version + ?", [
        mode.versionBump,
      ]);
      console.log(`\n── Added ${mode.versionBump} to every version in billing_sync_queue ──`);
    }

    const counts = new Map<BillingMark["type"], number>();
    for (const source of sources(connection, mode)) {
      for await (const marks of source) {
        for (const mark of marks) counts.set(mark.type, (counts.get(mark.type) ?? 0) + 1);
        if (values.apply) await writeChunk(connection, marks, mode);
      }
    }

    console.log(`\n── ${values.apply ? "Force-marked" : "Would force-mark"} ──`);
    for (const type of ["store", "reservation", "legacy_store", "legacy_month"] as const) {
      console.log(`   ${type.padEnd(14)} ${counts.get(type) ?? 0}`);
    }
    if (mode.kind === "dead") console.log("   (dead rows requeued with their attempt count reset)");
    if (!values.apply) {
      console.log("\n🔍 Dry run: nothing was written. Re-run with --apply to write.");
      return;
    }
    console.log("✅ Done. The relay sends them on its next runs.");
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error("❌ billing:mark failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
