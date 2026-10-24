import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import type { Connection, RowDataPacket } from "mysql2/promise";

import type { reservations } from "./schema";

import {
  createTestDatabase,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "./testing/test-database";

// The real upgrade: a database migrated up to 0081 holds one reservation per
// history, then the full migrations run 0082 (columns) and 0083 (backfill).

const MIGRATIONS = fileURLToPath(new URL("./migrations", import.meta.url));
const LAST_MIGRATION_BEFORE_BACKFILL = 81;

const STORE = "store_backfill";
const BASE = Date.parse("2026-01-12T09:00:00Z");
/** A whole-second instant, `minutes` after the base. */
const at = (minutes: number) => new Date(BASE + minutes * 60_000);
const iso = (minutes: number) => at(minutes).toISOString();

type Status = (typeof reservations.$inferSelect)["status"];

interface Fixture {
  status: Status;
  source?: string;
  createdAt: number;
  updatedAt?: number;
  activity?: Array<{ type: string; at: number; metadata?: Record<string, unknown> }>;
  fees?: Array<{ source: string; status: string; createdAt: number; updatedAt?: number }>;
  expected: { billableAt: string | null; withdrawnAt: string | null };
}

const confirmedBy = (previousStatus: Status) => ({ previousStatus, newStatus: "confirmed" });

const FIXTURES: Record<string, Fixture> = {
  // Dashboard confirm, then pickup and return: the first billable entry wins.
  dashboard_completed: {
    status: "completed",
    createdAt: 0,
    updatedAt: 300,
    activity: [
      { type: "created", at: 0, metadata: { source: "online", status: "pending" } },
      { type: "confirmed", at: 60, metadata: confirmedBy("pending") },
      { type: "picked_up", at: 120 },
      { type: "returned", at: 300 },
    ],
    fees: [{ source: "manual", status: "pending", createdAt: 61 }],
    expected: { billableAt: iso(60), withdrawnAt: null },
  },
  quote_accepted: {
    status: "confirmed",
    source: "manual",
    createdAt: 0,
    activity: [
      { type: "created", at: 0, metadata: { source: "manual", status: "quote" } },
      { type: "quote_accepted", at: 90, metadata: { source: "quote_acceptance" } },
    ],
    fees: [{ source: "manual", status: "pending", createdAt: 91 }],
    expected: { billableAt: iso(90), withdrawnAt: null },
  },
  // Manual creation as confirmed: the `created` row carries the status.
  manual_confirmed: {
    status: "confirmed",
    source: "manual",
    createdAt: 0,
    activity: [{ type: "created", at: 1, metadata: { source: "manual", status: "confirmed" } }],
    fees: [{ source: "manual", status: "pending", createdAt: 2 }],
    expected: { billableAt: iso(1), withdrawnAt: null },
  },
  // The AI tool confirms with no activity and no fee: created_at is all there is.
  ai_confirmed: {
    status: "confirmed",
    createdAt: 5,
    activity: [{ type: "created", at: 6, metadata: { source: "online", status: "pending" } }],
    expected: { billableAt: iso(5), withdrawnAt: null },
  },
  // The webhook records the online fee before it confirms: the activity wins.
  paid_checkout: {
    status: "confirmed",
    createdAt: 0,
    activity: [
      { type: "created", at: 0, metadata: { source: "online", status: "pending" } },
      { type: "confirmed", at: 32, metadata: { source: "online_payment" } },
    ],
    fees: [{ source: "online", status: "collected", createdAt: 30 }],
    expected: { billableAt: iso(32), withdrawnAt: null },
  },
  // Paid, but a stock conflict left it pending: never billable.
  paid_left_pending: {
    status: "pending",
    createdAt: 0,
    activity: [{ type: "created", at: 0, metadata: { source: "online", status: "pending" } }],
    fees: [{ source: "online", status: "collected", createdAt: 30 }],
    expected: { billableAt: null, withdrawnAt: null },
  },
  // Dashboard cancelReservation logs `cancelled` and voids the fee after it.
  cancel_reservation: {
    status: "cancelled",
    createdAt: 0,
    updatedAt: 200,
    activity: [
      { type: "confirmed", at: 60, metadata: confirmedBy("pending") },
      { type: "cancelled", at: 200, metadata: { previousStatus: "confirmed" } },
    ],
    fees: [{ source: "manual", status: "voided", createdAt: 61, updatedAt: 201 }],
    expected: { billableAt: iso(60), withdrawnAt: iso(200) },
  },
  // updateReservationStatus to cancelled logs nothing: the void time is next.
  cancel_status: {
    status: "cancelled",
    createdAt: 0,
    updatedAt: 240,
    activity: [{ type: "confirmed", at: 60, metadata: confirmedBy("pending") }],
    fees: [{ source: "manual", status: "voided", createdAt: 61, updatedAt: 241 }],
    expected: { billableAt: iso(60), withdrawnAt: iso(241) },
  },
  // Same on a store with a plan (no fee row): updated_at is next.
  cancel_status_no_fee: {
    status: "cancelled",
    createdAt: 0,
    updatedAt: 250,
    activity: [{ type: "confirmed", at: 60, metadata: confirmedBy("pending") }],
    expected: { billableAt: iso(60), withdrawnAt: iso(250) },
  },
  // AI confirm, then a dashboard cancel: only the cancellation shows it was billable.
  ai_then_cancelled: {
    status: "cancelled",
    createdAt: 10,
    updatedAt: 180,
    activity: [{ type: "cancelled", at: 180, metadata: { previousStatus: "confirmed" } }],
    expected: { billableAt: iso(10), withdrawnAt: iso(180) },
  },
  pending_cancelled: {
    status: "cancelled",
    createdAt: 0,
    updatedAt: 45,
    activity: [
      { type: "created", at: 0, metadata: { source: "online", status: "pending" } },
      {
        type: "cancelled",
        at: 45,
        metadata: { previousStatus: "pending", source: "customer_request_cancellation" },
      },
    ],
    expected: { billableAt: null, withdrawnAt: null },
  },
  // Paid and left pending, then rejected: a webhook fee alone is no evidence.
  paid_then_rejected: {
    status: "rejected",
    createdAt: 0,
    updatedAt: 50,
    activity: [{ type: "rejected", at: 50, metadata: { previousStatus: "pending" } }],
    fees: [{ source: "online", status: "collected", createdAt: 30 }],
    expected: { billableAt: null, withdrawnAt: null },
  },
};

/** A copy of the migrations folder whose journal stops at `lastIdx`. */
async function migrationsUpTo(lastIdx: number): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), "louez-migrations-"));
  await cp(MIGRATIONS, folder, { recursive: true });
  const journalPath = path.join(folder, "meta", "_journal.json");
  const journal: { entries: Array<{ idx: number; tag: string }> } = JSON.parse(
    await readFile(journalPath, "utf8"),
  );
  journal.entries = journal.entries.filter((entry) => entry.idx <= lastIdx);
  assert.equal(journal.entries.at(-1)?.tag, "0081_pricing_version");
  await writeFile(journalPath, JSON.stringify(journal, null, 2));
  return folder;
}

async function insertFixture(connection: Connection, id: string, fixture: Fixture) {
  await connection.query(
    `INSERT INTO reservations
       (id, store_id, customer_id, number, reservation_status, start_date, end_date,
        subtotal_amount, deposit_amount, total_amount, source, created_at, updated_at)
     VALUES (?, ?, 'customer', ?, ?, ?, ?, 0, 0, 0, ?, ?, ?)`,
    [
      id,
      STORE,
      id,
      fixture.status,
      at(24 * 60),
      at(48 * 60),
      fixture.source ?? "online",
      at(fixture.createdAt),
      at(fixture.updatedAt ?? fixture.createdAt),
    ],
  );
  for (const [index, activity] of (fixture.activity ?? []).entries()) {
    await connection.query(
      `INSERT INTO reservation_activity (id, reservation_id, activity_type, metadata, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        `${id.slice(0, 18)}_${index}`,
        id,
        activity.type,
        activity.metadata ? JSON.stringify(activity.metadata) : null,
        at(activity.at),
      ],
    );
  }
  for (const [index, fee] of (fixture.fees ?? []).entries()) {
    // Amounts play no part in the backfill.
    await connection.query(
      `INSERT INTO platform_fee
         (id, store_id, reservation_id, dedup_key, amount_cents, platform_fee_source,
          platform_fee_status, billing_month, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, '2026-01', ?, ?)`,
      [
        `${id.slice(0, 18)}_f${index}`,
        STORE,
        id,
        `res:${id}`,
        fee.source,
        fee.status,
        at(fee.createdAt),
        at(fee.updatedAt ?? fee.createdAt),
      ],
    );
  }
}

async function readDates(connection: Connection) {
  const [rows] = await connection.query<RowDataPacket[]>(
    "SELECT id, billable_at, withdrawn_at FROM reservations ORDER BY id",
  );
  return Object.fromEntries(
    rows.map((row) => [
      row.id,
      {
        billableAt: row.billable_at instanceof Date ? row.billable_at.toISOString() : null,
        withdrawnAt: row.withdrawn_at instanceof Date ? row.withdrawn_at.toISOString() : null,
      },
    ]),
  );
}

describe("reservation billable_at backfill (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let connection: Connection;
  let partialMigrations: string;
  let louezDb: typeof import("./index");
  let rerun: typeof import("./scripts/reservations-backfill-billable-at");

  before(async () => {
    partialMigrations = await migrationsUpTo(LAST_MIGRATION_BEFORE_BACKFILL);
    database = await createTestDatabase("reservation_backfill", {
      migrationsFolder: partialMigrations,
    });
    connection = await database.connect();
    // DATABASE_URL now points at the test database.
    louezDb = await import("./index");
    rerun = await import("./scripts/reservations-backfill-billable-at");
  });

  after(async () => {
    await connection?.end();
    await louezDb?.db.$client.end();
    await database?.drop();
    if (partialMigrations) await rm(partialMigrations, { recursive: true, force: true });
  });

  test("the upgrade from 0081 dates every history, and a rerun changes nothing", async () => {
    const [before0082] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservations' AND COLUMN_NAME = 'billable_at'`,
    );
    assert.equal(Number(before0082[0]?.n), 0, "the database starts before 0082");

    for (const [id, fixture] of Object.entries(FIXTURES)) {
      await insertFixture(connection, id, fixture);
    }

    await database.migrate();

    const [columns] = await connection.query<RowDataPacket[]>(
      `SELECT COLUMN_NAME AS name, DATA_TYPE AS type, IS_NULLABLE AS nullable,
              COLUMN_DEFAULT AS defaultValue
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservations'
         AND COLUMN_NAME IN ('billable_at', 'withdrawn_at')
       ORDER BY COLUMN_NAME`,
    );
    assert.deepEqual(
      columns.map((column) => ({ ...column })),
      [
        { name: "billable_at", type: "timestamp", nullable: "YES", defaultValue: null },
        { name: "withdrawn_at", type: "timestamp", nullable: "YES", defaultValue: null },
      ],
    );
    const [indexes] = await connection.query<RowDataPacket[]>(
      `SELECT COLUMN_NAME AS name FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservations'
         AND INDEX_NAME = 'reservations_billable_at_idx'`,
    );
    assert.deepEqual(
      indexes.map((index) => index.name),
      ["billable_at"],
    );

    const expected = Object.fromEntries(
      Object.entries(FIXTURES).map(([id, fixture]) => [id, fixture.expected]),
    );
    assert.deepEqual(await readDates(connection), expected);

    assert.deepEqual(await rerun.backfillReservationBillableAt(louezDb.db), {
      billableAt: 0,
      withdrawnAt: 0,
    });
    assert.deepEqual(await readDates(connection), expected);
    assert.equal(await louezDb.countBillableReservationsWithoutBillableAt(louezDb.db), 0);
  });

  test("the rerun dates a row an older version confirmed after the migration", async () => {
    await insertFixture(connection, "late_confirmation", {
      status: "confirmed",
      createdAt: 400,
      activity: [{ type: "confirmed", at: 420, metadata: confirmedBy("pending") }],
      expected: { billableAt: null, withdrawnAt: null },
    });
    assert.equal(await louezDb.countBillableReservationsWithoutBillableAt(louezDb.db), 1);

    assert.deepEqual(await rerun.backfillReservationBillableAt(louezDb.db), {
      billableAt: 1,
      withdrawnAt: 0,
    });
    assert.equal((await readDates(connection)).late_confirmation?.billableAt, iso(420));
    assert.equal(await louezDb.countBillableReservationsWithoutBillableAt(louezDb.db), 0);
  });

  // 2026-10-25 00:00-01:00 UTC is 02:00-03:00 CEST, and the next hour repeats those
  // local times in CET. Only a server in such a time zone can shift these instants:
  // on a UTC server (CI) this passes with or without the fix.
  test("an instant in the hour a DST change repeats keeps its value", async () => {
    const repeatedHour = (Date.parse("2026-10-25T00:30:00Z") - BASE) / 60_000;
    const fixture: Fixture = {
      status: "cancelled",
      createdAt: repeatedHour,
      updatedAt: repeatedHour + 10,
      activity: [
        { type: "cancelled", at: repeatedHour + 10, metadata: { previousStatus: "confirmed" } },
      ],
      expected: { billableAt: iso(repeatedHour), withdrawnAt: iso(repeatedHour + 10) },
    };
    // In a UTC session, so the fixture holds the first pass of the repeated hour.
    const utc = await database.connect();
    try {
      await utc.query("SET time_zone = '+00:00'");
      await insertFixture(utc, "dst_repeated_hour", fixture);

      assert.deepEqual(await rerun.backfillReservationBillableAt(louezDb.db), {
        billableAt: 1,
        withdrawnAt: 1,
      });
      assert.deepEqual((await readDates(utc)).dst_repeated_hour, fixture.expected);
    } finally {
      await utc.end();
    }
  });
});
