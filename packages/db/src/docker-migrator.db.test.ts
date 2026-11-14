import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { Connection, RowDataPacket } from "mysql2/promise";

import {
  createTestDatabase,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "./testing/test-database";

// The Docker migrator image and the app must agree on what is pending. A
// database the app's runner migrated records when each migration ran, later
// than the journal's `when` of the migrations that follow: a runner going by
// `created_at` (drizzle's migrate()) reported them pending, then applied none.

const MIGRATIONS = fileURLToPath(new URL("./migrations", import.meta.url));
const DOCKER_MIGRATOR = fileURLToPath(new URL("../../../docker/migrate.mjs", import.meta.url));
const execFileAsync = promisify(execFile);

/** The release's migrations, after main's 0091. */
const LAST_BEFORE = "0091_reservation_contract_signatures";
const RELEASE = [
  "0092_agent_api_operations",
  "0093_agent_oauth",
  "0094_api_effects",
  "0095_inbox",
  "0096_api_handoffs",
  "0097_api_operation_setup_store",
  "0098_api_jobs",
  "0099_api_handoffs_subject",
  "0100_deposit_hold_release_and_attempt",
  "0101_api_handoffs_revision",
  "0102_api_handoffs_decision",
  "0103_api_handoffs_approval",
];

interface Journal {
  entries: Array<{ tag: string }>;
}

/** The repo's migrations, its journal cut after `lastTag`. */
async function migrationsUpTo(lastTag: string): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), "louez-migrations-"));
  await cp(MIGRATIONS, folder, { recursive: true });
  const journalPath = path.join(folder, "meta", "_journal.json");
  const journal: Journal = JSON.parse(await readFile(journalPath, "utf8"));
  const last = journal.entries.findIndex((entry) => entry.tag === lastTag);
  assert.ok(last >= 0, `${lastTag} is in the journal`);
  await writeFile(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, last + 1) }));
  return folder;
}

const hashOf = async (tag: string) =>
  createHash("sha256")
    .update(await readFile(path.join(MIGRATIONS, `${tag}.sql`)))
    .digest("hex");

/** The image runs the script with only the variables it is given. */
const runDockerMigrator = (env: Record<string, string>) =>
  execFileAsync(process.execPath, [DOCKER_MIGRATOR], { env: { PATH: process.env.PATH, ...env } });

describe("Docker migrator after the app's runner (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let connection: Connection;
  let before0092: string;

  before(async () => {
    before0092 = await migrationsUpTo(LAST_BEFORE);
    // Production before this release: main's migrations, applied by the app at startup.
    database = await createTestDatabase("docker_migrator", { migrationsFolder: before0092 });
    connection = await database.connect();
  });

  after(async () => {
    await connection?.end();
    await database?.drop();
    if (before0092) await rm(before0092, { recursive: true, force: true });
  });

  const recordedHashes = async () => {
    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT hash, created_at FROM __drizzle_migrations",
    );
    return rows.map((row) => ({ hash: String(row.hash), createdAt: Number(row.created_at) }));
  };

  const columnExists = async (table: string, column: string) => {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return rows.length === 1;
  };

  test("applies 0092-0097 on a database the app migrated, then has nothing left", async () => {
    const recorded = await recordedHashes();
    const firstReleaseWhen = (
      JSON.parse(await readFile(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8")) as {
        entries: Array<{ tag: string; when: number }>;
      }
    ).entries.find((entry) => entry.tag === RELEASE[0])?.when;
    assert.ok(firstReleaseWhen);
    assert.ok(
      recorded.every((row) => row.createdAt > firstReleaseWhen),
      "the app's runner recorded each migration when it ran, after the release's `when`",
    );

    const run = await runDockerMigrator({ DATABASE_URL: database.url, MIGRATIONS_FOLDER: MIGRATIONS });
    assert.equal(run.stdout.match(/✅ Applied:/g)?.length, RELEASE.length, run.stdout);

    const after = new Set((await recordedHashes()).map((row) => row.hash));
    for (const tag of RELEASE) assert.ok(after.has(await hashOf(tag)), `${tag} is recorded`);
    for (const [table, column] of [
      ["api_operations", "setup_store_id"],
      ["oauth_clients", "client_id"],
      ["api_effects", "seq"],
      ["inbox_acknowledgements", "occurred_at"],
      ["reservations", "schedule_changed_at"],
      ["api_handoffs", "provider_checks"],
      ["api_handoffs", "decision_reason"],
      ["api_jobs", "slot_key"],
      ["payments", "release_owed_at"],
      ["payments", "provider_requested_at"],
      ["payments", "claimed_until"],
      ["payments", "claim_token"],
      ["payments", "stripe_customer_id"],
    ] as const) {
      assert.ok(await columnExists(table, column), `${table}.${column} exists`);
    }

    const again = await runDockerMigrator({ DATABASE_URL: database.url, MIGRATIONS_FOLDER: MIGRATIONS });
    assert.match(again.stdout, /No pending migrations/);
    assert.equal(again.stdout.match(/✅ Applied:/g), null);
  });

  test("exits 1 without DATABASE_URL, and when a migration fails", async () => {
    await assert.rejects(runDockerMigrator({ MIGRATIONS_FOLDER: MIGRATIONS }), (error: unknown) => {
      const failed = error as { code?: number; stderr?: string };
      assert.equal(failed.code, 1);
      assert.match(failed.stderr ?? "", /DATABASE_URL environment variable is not set/);
      return true;
    });

    const broken = await mkdtemp(path.join(tmpdir(), "louez-broken-migration-"));
    try {
      await cp(MIGRATIONS, broken, { recursive: true });
      const journalPath = path.join(broken, "meta", "_journal.json");
      const journal: Journal & { entries: Array<Record<string, unknown>> } = JSON.parse(
        await readFile(journalPath, "utf8"),
      );
      journal.entries.push({ ...journal.entries.at(-1), tag: "9999_broken" });
      await writeFile(journalPath, JSON.stringify(journal));
      await writeFile(path.join(broken, "9999_broken.sql"), "ALTER TABLE `no_such_table` ADD `x` int;");
      await assert.rejects(
        runDockerMigrator({ DATABASE_URL: database.url, MIGRATIONS_FOLDER: broken }),
        (error: unknown) => {
          const failed = error as { code?: number; stderr?: string };
          assert.equal(failed.code, 1);
          assert.match(failed.stderr ?? "", /Migration failed/);
          return true;
        },
      );
    } finally {
      await rm(broken, { recursive: true, force: true });
    }
  });
});
