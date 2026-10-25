import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import type { RowDataPacket } from "mysql2/promise";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// `pnpm billing:mark` on a migrated database (louez-billing docs/api, README §5.2,
// §5.7 and §6): dry run by default, forced marks with --apply.

const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("billing:mark (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;

  before(async () => {
    database = await createTestDatabase("billing_mark");
    const connection = await database.connect();
    try {
      await connection.query(
        `INSERT INTO stores (id, user_id, name, slug) VALUES ('bm_store', 'u1', 'Store', 'bm-store')`,
      );
      await connection.query(
        `INSERT INTO reservations (id, store_id, customer_id, number, start_date, end_date,
                                   subtotal_amount, deposit_amount, total_amount)
         VALUES ('bm_res_1', 'bm_store', 'c', 'R-1', '2026-10-01 08:00:00', '2026-10-02 08:00:00', 10, 0, 10),
                ('bm_res_2', 'bm_store', 'c', 'R-2', '2026-10-01 08:00:00', '2026-10-02 08:00:00', 10, 0, 10)`,
      );
      await connection.query(
        `INSERT INTO platform_fee (id, store_id, reservation_id, dedup_key, amount_cents,
                                   platform_fee_source, platform_fee_status, billing_month)
         VALUES ('bm_fee_1', 'bm_store', 'bm_res_1', 'res:bm_res_1', 90, 'manual', 'pending', '2026-03')`,
      );
      // A synced store row and a dead reservation row, with a sent hash.
      await connection.query(
        `INSERT INTO billing_sync_queue (aggregate_type, aggregate_id, store_id, version, status, sent_hash, attempt_count)
         VALUES ('store', 'bm_store', 'bm_store', 4, 'synced', 'hash', 0),
                ('reservation', 'bm_res_2', 'bm_store', 7, 'dead', 'hash', 5)`,
      );
    } finally {
      await connection.end();
    }
  });

  after(async () => {
    await database?.drop();
  });

  function runScript(...args: string[]) {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/run-billing-mark.ts", ...args],
      {
        cwd: APP_ROOT,
        encoding: "utf8",
        env: { ...process.env, MIGRATE_DATABASE_URL: database.url },
      },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return result.stdout;
  }

  async function queue() {
    const connection = await database.connect();
    try {
      const [rows] = await connection.query<RowDataPacket[]>(
        `SELECT CAST(aggregate_type AS CHAR) AS type, aggregate_id AS id, version, status,
                sent_hash AS sentHash, attempt_count AS attempts
         FROM billing_sync_queue ORDER BY CAST(aggregate_type AS CHAR), aggregate_id`,
      );
      return rows.map((row) => ({ ...row }));
    } finally {
      await connection.end();
    }
  }

  test("a dry run counts and writes nothing", async () => {
    const before = await queue();
    const output = runScript("--all");
    assert.match(output, /Would force-mark/);
    assert.match(output, /reservation\s+2/);
    assert.match(output, /Dry run: nothing was written/);
    assert.deepEqual(await queue(), before);
  });

  test("--dead requeues dead rows with a forced mark and resets their attempts", async () => {
    runScript("--dead", "--apply");
    const row = (await queue()).find((entry) => entry.id === "bm_res_2");
    assert.deepEqual(row, {
      type: "reservation",
      id: "bm_res_2",
      version: 8,
      status: "pending",
      sentHash: null,
      attempts: 0,
    });
  });

  test("--all --version-bump raises every version and force-marks every aggregate", async () => {
    runScript("--all", "--version-bump=10000000", "--apply");
    const rows = await queue();
    const versions = Object.fromEntries(rows.map((row) => [`${row.type}:${row.id}`, row.version]));
    const periods = [
      new Date(),
      new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1)),
    ].map((date) => date.toISOString().slice(0, 7));
    assert.deepEqual(versions, {
      "store:bm_store": 10_000_005,
      "reservation:bm_res_1": 10_000_001,
      "reservation:bm_res_2": 10_000_009,
      "legacy_store:bm_store": 10_000_001,
      "legacy_month:bm_store:2026-03": 10_000_001,
      [`legacy_month:bm_store:${periods[0]}`]: 10_000_001,
      [`legacy_month:bm_store:${periods[1]}`]: 10_000_001,
    });
    assert.ok(rows.every((row) => row.status === "pending" && row.sentHash === null));
  });
});
