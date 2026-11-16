import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import type { Connection, RowDataPacket } from "mysql2/promise";

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
];

describe(
  "migration 0108: the deposit out of the total (database)",
  {
    skip: skipWithoutTestDatabase(),
  },
  () => {
    let database: TestDatabase;
    let connection: Connection;

    before(async () => {
      database = await createTestDatabase("deposit_out_of_total");
      connection = await database.connect();
      // The test database is migrated already: the rows are written after 0108
      // ran on an empty table, as the rows of an instance were written before.
      await connection.query("SET time_zone = '+00:00'");
      for (const row of ROWS) {
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
  },
);
