import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import type { Connection, RowDataPacket } from "mysql2/promise";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// `scripts/run-failed-checkout-cleanup.ts`, run by hand, on a migrated database:
// a dry run lists the pending online checkouts of a payment-mode store that are
// below Stripe's minimum and have no payment row; with --apply it cancels them as
// the failed checkout does (docs/domain/reservation-changes.md, 6a-4).

const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));
// An empty env file: the database comes from the environment the test passes.
const directory = mkdtempSync(join(tmpdir(), "louez-failed-checkout-cleanup-"));
const ENV_FILE = join(directory, ".env");
writeFileSync(ENV_FILE, "");
after(() => rmSync(directory, { recursive: true }));

// The script takes ids of 21 characters, as the tables store them.
const id = (name: string) => name.padEnd(21, "0");
const STORE = id("fcc_store_");
const SMALL = id("fcc_small_");
const SMALL_PAID = id("fcc_small_paid_");
const LARGE = id("fcc_large_");
const PHONE = id("fcc_phone_");
const CONFIRMED = id("fcc_confirmed_");
const ALL = [SMALL, SMALL_PAID, LARGE, PHONE, CONFIRMED];

describe("the failed checkout cleanup (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let connection: Connection;

  before(async () => {
    database = await createTestDatabase("failed_checkout_cleanup");
    connection = await database.connect();
    await connection.query(
      `INSERT INTO stores (id, user_id, name, slug, stripe_charges_enabled, settings)
       VALUES (?, 'owner', 'Cleanup', 'failed-checkout-cleanup', 1, ?)`,
      [STORE, JSON.stringify({ reservationMode: "payment", currency: "EUR" })],
    );
    const rows: Array<[string, string, string, string]> = [
      [SMALL, "pending", "online", "0.10"],
      [SMALL_PAID, "pending", "online", "0.10"],
      [LARGE, "pending", "online", "10.00"],
      [PHONE, "pending", "phone", "0.10"],
      [CONFIRMED, "confirmed", "online", "0.10"],
    ];
    for (const [reservationId, status, source, amount] of rows) {
      await connection.query(
        `INSERT INTO reservations (id, store_id, customer_id, number, reservation_status, source,
                                   start_date, end_date, subtotal_amount, deposit_amount, total_amount)
         VALUES (?, ?, 'customer', ?, ?, ?, '2026-10-01 08:00:00', '2026-10-02 08:00:00', ?, 0, ?)`,
        [reservationId, STORE, `N-${reservationId.slice(4, 12)}`, status, source, amount, amount],
      );
    }
    await connection.query(
      `INSERT INTO payments (id, reservation_id, amount, payment_type, payment_method, payment_status)
       VALUES ('fcc_payment', ?, '0.10', 'rental', 'stripe', 'failed')`,
      [SMALL_PAID],
    );
  });

  after(async () => {
    await connection?.end();
    await database?.drop();
  });

  function runScript(...args: string[]) {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/run-failed-checkout-cleanup.ts",
        "--store-id",
        STORE,
        "--reservation-ids",
        ALL.join(","),
        "--env-file",
        ENV_FILE,
        ...args,
      ],
      {
        cwd: APP_ROOT,
        encoding: "utf8",
        env: { ...process.env, DATABASE_URL: database.url, SKIP_ENV_VALIDATION: "true" },
      },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    // The script's own lines are JSON; the env loaders of the modules it imports log too.
    return result.stdout
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  const target = () => {
    const url = new URL(database.url);
    return `${url.hostname}:${url.port || "3306"}${url.pathname}`;
  };

  async function statuses() {
    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT id, reservation_status AS status FROM reservations WHERE store_id = ? ORDER BY id",
      [STORE],
    );
    return Object.fromEntries(rows.map((row) => [row.id, row.status]));
  }

  async function activity(reservationId: string) {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT activity_type AS type, user_id AS userId, metadata
       FROM reservation_activity WHERE reservation_id = ? ORDER BY activity_type`,
      [reservationId],
    );
    return rows.map((row) => ({
      type: row.type,
      userId: row.userId,
      metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
    }));
  }

  const UNTOUCHED = {
    [SMALL]: "pending",
    [SMALL_PAID]: "pending",
    [LARGE]: "pending",
    [PHONE]: "pending",
    [CONFIRMED]: "confirmed",
  };

  test("a dry run lists the checkout below the minimum with no payment row, and writes nothing", async () => {
    assert.deepEqual(runScript(), [
      { target: target(), apply: false },
      {
        number: "N-small_00",
        amount: "0.10",
        minimumAmount: 0.5,
        currency: "EUR",
        cancelled: false,
      },
      { inspected: 3 },
    ]);
    assert.deepEqual(await statuses(), UNTOUCHED);
    for (const reservationId of ALL) assert.deepEqual(await activity(reservationId), []);
  });

  test("--apply cancels it as a failed checkout, and leaves every other reservation", async () => {
    assert.deepEqual(runScript("--apply"), [
      { target: target(), apply: true },
      {
        number: "N-small_00",
        amount: "0.10",
        minimumAmount: 0.5,
        currency: "EUR",
        cancelled: true,
      },
      { inspected: 3 },
    ]);
    assert.deepEqual(await statuses(), { ...UNTOUCHED, [SMALL]: "cancelled" });
    const failure = {
      source: "checkout_payment_failed",
      reason: "amount_too_small",
      minimumAmount: 0.5,
      currency: "EUR",
    };
    assert.deepEqual(await activity(SMALL), [
      {
        type: "cancelled",
        userId: null,
        metadata: {
          previousStatus: "pending",
          newStatus: "cancelled",
          actor: "system",
          ...failure,
        },
      },
      { type: "payment_failed", userId: null, metadata: failure },
    ]);
    for (const reservationId of [SMALL_PAID, LARGE, PHONE, CONFIRMED]) {
      assert.deepEqual(await activity(reservationId), []);
    }
  });

  test("--apply again finds nothing left to cancel", async () => {
    assert.deepEqual(runScript("--apply"), [{ target: target(), apply: true }, { inspected: 2 }]);
    assert.deepEqual(await statuses(), { ...UNTOUCHED, [SMALL]: "cancelled" });
  });
});
