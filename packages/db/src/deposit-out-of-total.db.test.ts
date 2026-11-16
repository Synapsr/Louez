import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import type { Connection, RowDataPacket } from "mysql2/promise";

import { runMigrations } from "./migration-runner.mjs";
import {
  createTestDatabase,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "./testing/test-database";

// Migration 0108 takes the deposit out of exactly the totals that hold it:
// an online row created before 2026-04-01, priced by no writer since, whose
// total is its parts plus the deposit to the cent and cannot be read without
// it. Every other row is left as it is, and a second run changes nothing.

const MIGRATION = fileURLToPath(
  new URL("./migrations/0108_deposit_out_of_total.sql", import.meta.url),
);
const STORE = "store_deposit_total";

interface Row {
  id: string;
  source?: string;
  createdAt?: string;
  taxDisplayMode?: "inclusive" | "exclusive" | null;
  subtotal: string;
  discount?: string;
  deliveryFee?: string;
  tax?: string | null;
  insurance?: string | null;
  deposit: string;
  total: string;
}

const ROWS: Row[] = [
  // The legacy shape: 100 of rental and 30 of deposit, stored together.
  { id: "legacy", subtotal: "100.00", deposit: "30.00", total: "130.00" },
  // The same with a discount and a delivery fee: 100 - 10 + 15 + 30.
  {
    id: "legacy_disc_delivery",
    subtotal: "100.00",
    discount: "10.00",
    deliveryFee: "15.00",
    deposit: "30.00",
    total: "135.00",
  },
  // Its tax equals the deposit: the total reads as well without the deposit.
  { id: "ambiguous_tax", subtotal: "100.00", tax: "20.00", deposit: "20.00", total: "120.00" },
  // Its insurance equals the deposit: the same.
  {
    id: "ambiguous_insurance",
    subtotal: "100.00",
    insurance: "25.00",
    deposit: "25.00",
    total: "125.00",
  },
  // Made in the dashboard, which never put the deposit in the total.
  { id: "manual", source: "manual", subtotal: "100.00", deposit: "30.00", total: "130.00" },
  // Written after every writer left the deposit out.
  {
    id: "after_april",
    createdAt: "2026-04-01 00:00:00",
    subtotal: "100.00",
    deposit: "30.00",
    total: "130.00",
  },
  // Priced by a writer that records its facts.
  {
    id: "recorded_mode",
    taxDisplayMode: "exclusive",
    subtotal: "100.00",
    deposit: "30.00",
    total: "130.00",
  },
  // No deposit.
  { id: "no_deposit", subtotal: "100.00", deposit: "0.00", total: "100.00" },
  // A current row: its total is its parts, the deposit apart.
  { id: "current", subtotal: "100.00", deposit: "30.00", total: "100.00" },
  // Its parts plus the deposit, but the total would fall below zero without it.
  { id: "negative", subtotal: "10.00", discount: "50.00", deposit: "50.00", total: "10.00" },
];

describe(
  "migration 0108: the deposit out of the total (database)",
  {
    skip: skipWithoutTestDatabase(),
  },
  () => {
    let database: TestDatabase;
    let connection: Connection;

    async function insertRow(row: Row) {
      await connection.query(
        `INSERT INTO reservations
        (id, store_id, customer_id, number, reservation_status, start_date, end_date, subtotal_amount,
         discount_amount, delivery_fee, tax_amount, tulip_insurance_amount,
         deposit_amount, total_amount, source, tax_display_mode, created_at, updated_at)
       VALUES (?, ?, 'customer', ?, 'completed', '2026-02-10 09:00:00', '2026-02-12 09:00:00',
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-03-01 08:00:00')`,
        [
          row.id,
          STORE,
          row.id,
          row.subtotal,
          row.discount ?? "0.00",
          row.deliveryFee ?? "0.00",
          row.tax ?? null,
          row.insurance ?? null,
          row.deposit,
          row.total,
          row.source ?? "online",
          row.taxDisplayMode ?? null,
          row.createdAt ?? "2026-02-01 08:00:00",
        ],
      );
    }

    before(async () => {
      database = await createTestDatabase("deposit_out_of_total");
      connection = await database.connect();
      // The test database is migrated already: the rows are written after 0108
      // ran on an empty table, as the rows of an instance were written before.
      await connection.query("SET time_zone = '+00:00'");
      for (const row of ROWS) await insertRow(row);
    });

    after(async () => {
      await connection?.end();
      await database?.drop();
    });

    /** The migration's statements, as the migrator splits them. */
    async function runMigration() {
      const sql = await readFile(MIGRATION, "utf8");
      for (const statement of sql.split("--> statement-breakpoint")) {
        await connection.query(statement);
      }
    }

    async function totals() {
      const [rows] = await connection.query<RowDataPacket[]>(
        "SELECT id, total_amount AS total, updated_at AS updatedAt FROM reservations ORDER BY id",
      );
      return Object.fromEntries(rows.map((row) => [row.id, String(row.total)]));
    }

    async function history() {
      const [rows] = await connection.query<RowDataPacket[]>(
        "SELECT reservation_id AS id, activity_type AS type, metadata FROM reservation_activity ORDER BY reservation_id",
      );
      return rows.map((row) => ({
        id: row.id,
        type: row.type,
        metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
      }));
    }

    test("only the totals that hold the deposit lose it, once, each with its history line", async () => {
      const before = await totals();

      await runMigration();
      await runMigration();

      const after = await totals();
      assert.deepEqual(after, {
        ...before,
        legacy: "100.00",
        legacy_disc_delivery: "105.00",
      });
      assert.deepEqual(await history(), [
        {
          id: "legacy",
          type: "modified",
          metadata: {
            kind: "deposit_removed_from_total",
            migration: "0108",
            previousTotal: "130.00",
            depositRemoved: "30.00",
            total: "100.00",
          },
        },
        {
          id: "legacy_disc_delivery",
          type: "modified",
          metadata: {
            kind: "deposit_removed_from_total",
            migration: "0108",
            previousTotal: "135.00",
            depositRemoved: "30.00",
            total: "105.00",
          },
        },
      ]);
      const [stamps] = await connection.query<RowDataPacket[]>(
        "SELECT DISTINCT updated_at AS updatedAt FROM reservations",
      );
      assert.equal(stamps.length, 1, "updated_at is left as it was");
    });

    test("interrupted after its history line, run again: one line, one decrement", async () => {
      await insertRow({ id: "retry", subtotal: "100.00", deposit: "30.00", total: "130.00" });
      const statements = (await readFile(MIGRATION, "utf8")).split("--> statement-breakpoint");
      const insert = statements.find((statement) => statement.includes("INSERT INTO"));
      assert.ok(insert);
      // The history line is written, then the run stops before the update.
      await connection.query(insert);

      await runMigration();

      const [lines] = await connection.query<RowDataPacket[]>(
        "SELECT COUNT(*) AS count FROM reservation_activity WHERE reservation_id = 'retry'",
      );
      assert.equal(Number(lines[0]?.count), 1);
      assert.equal((await totals()).retry, "100.00");
    });

    test("only its own history line marks a row as done: another type with the same value does not", async () => {
      await insertRow({
        id: "other_marker",
        subtotal: "100.00",
        deposit: "30.00",
        total: "130.00",
      });
      await connection.query(
        `INSERT INTO reservation_activity (id, reservation_id, activity_type, metadata)
         VALUES ('other_marker_note', 'other_marker', 'note_updated', JSON_OBJECT('migration', '0108'))`,
      );

      await runMigration();

      const [lines] = await connection.query<RowDataPacket[]>(
        "SELECT activity_type AS type FROM reservation_activity WHERE reservation_id = 'other_marker'",
      );
      assert.deepEqual(lines.map((line) => String(line.type)).sort(), ["modified", "note_updated"]);
      assert.equal((await totals()).other_marker, "100.00");
    });
  },
);

const MIGRATIONS = fileURLToPath(new URL("./migrations", import.meta.url));

/** The repo's migrations, its journal cut after `lastTag`. */
async function migrationsUpTo(lastTag: string): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), "louez-migrations-"));
  await cp(MIGRATIONS, folder, { recursive: true });
  const journalPath = path.join(folder, "meta", "_journal.json");
  const journal: { entries: Array<{ tag: string }> } = JSON.parse(
    await readFile(journalPath, "utf8"),
  );
  const last = journal.entries.findIndex((entry) => entry.tag === lastTag);
  assert.ok(last >= 0, `${lastTag} is in the journal`);
  await writeFile(
    journalPath,
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, last + 1) }),
  );
  return folder;
}

describe(
  "migration 0108 through the shared runner: all or nothing (database)",
  {
    skip: skipWithoutTestDatabase(),
  },
  () => {
    let database: TestDatabase;
    let connection: Connection;
    let before0108: string;

    before(async () => {
      before0108 = await migrationsUpTo("0107_reservation_pricing_facts");
      database = await createTestDatabase("deposit_out_of_total_atomic", {
        migrationsFolder: before0108,
      });
      connection = await database.connect();
      await connection.query(
        `INSERT INTO reservations
        (id, store_id, customer_id, number, reservation_status, start_date, end_date,
         subtotal_amount, discount_amount, delivery_fee, deposit_amount, total_amount, source,
         created_at, updated_at)
       VALUES ('legacy', ?, 'customer', 'legacy', 'completed', '2026-02-10 09:00:00',
         '2026-02-12 09:00:00', '100.00', '0.00', '0.00', '30.00', '130.00', 'online',
         '2026-02-01 08:00:00', '2026-03-01 08:00:00')`,
        [STORE],
      );
    });

    after(async () => {
      await connection?.end();
      await database?.drop();
      if (before0108) await rm(before0108, { recursive: true, force: true });
    });

    const state = async () => {
      const [[row]] = await connection.query<RowDataPacket[]>(
        "SELECT total_amount AS total FROM reservations WHERE id = 'legacy'",
      );
      const [[lines]] = await connection.query<RowDataPacket[]>(
        "SELECT COUNT(*) AS count FROM reservation_activity WHERE reservation_id = 'legacy'",
      );
      const hash = createHash("sha256")
        .update(await readFile(MIGRATION))
        .digest("hex");
      const [recorded] = await connection.query<RowDataPacket[]>(
        "SELECT 1 FROM __drizzle_migrations WHERE hash = ?",
        [hash],
      );
      return {
        total: String(row?.total),
        historyLines: Number(lines?.count),
        recorded: recorded.length === 1,
      };
    };

    test("its update refused: no total changed, no history line, not recorded; run again, applied once", async () => {
      // The update made to fail, as an interruption between the two statements would.
      await connection.query(
        `CREATE TRIGGER refuse_0108 BEFORE UPDATE ON reservations FOR EACH ROW
         SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'update refused'`,
      );
      await assert.rejects(
        runMigrations({ databaseUrl: database.url, migrationsFolder: MIGRATIONS }),
      );
      assert.deepEqual(await state(), { total: "130.00", historyLines: 0, recorded: false });

      await connection.query("DROP TRIGGER refuse_0108");
      await runMigrations({ databaseUrl: database.url, migrationsFolder: MIGRATIONS });
      assert.deepEqual(await state(), { total: "100.00", historyLines: 1, recorded: true });
    });
  },
);
