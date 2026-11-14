import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import type { Connection, RowDataPacket } from "mysql2/promise";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { WRITE_SAMPLES_FLAG } from "./approvals-guard";

// The sample approvals script, run as `pnpm db:seed:approvals` runs it, on a
// migrated database: three pending approvals of the owner, one per
// consequence the page treats apart, asked by a key nobody holds; their
// page URLs printed; refused in production and for anyone but an owner.
// Every run passes the flag; the guard's other refusals are in
// approvals-guard.test.ts.

const APP_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OWNER = "sa_owner_user_000001";
const MEMBER = "sa_member_user_00001";
const STORE = "sa_store_a_000000001";

describe("the sample approvals script (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let connection: Connection;

  before(async () => {
    database = await createTestDatabase("seed_approvals");
    const mysql = await import("mysql2/promise");
    connection = await mysql.createConnection(database.url);
    await connection.query(
      `INSERT INTO users (id, email, name) VALUES (?, 'owner@samples.test', 'Olga'), (?, 'member@samples.test', 'Malo')`,
      [OWNER, MEMBER],
    );
    await connection.query(
      `INSERT INTO stores (id, user_id, name, slug) VALUES (?, ?, 'Roscoff Voile', 'sa-roscoff')`,
      [STORE, OWNER],
    );
    await connection.query(
      `INSERT INTO store_members (id, store_id, user_id, member_role) VALUES ('sa_member_owner_0001', ?, ?, 'owner'), ('sa_member_membr_0001', ?, ?, 'member')`,
      [STORE, OWNER, STORE, MEMBER],
    );
  });

  after(async () => {
    await connection?.end();
    await database?.drop();
  });

  beforeEach(async () => {
    await connection.query("DELETE FROM api_handoffs");
    await connection.query("DELETE FROM api_keys");
  });

  function run(args: string[], env: Record<string, string> = {}) {
    return spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/seed/approvals.ts", WRITE_SAMPLES_FLAG, ...args],
      {
        cwd: APP_ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          DATABASE_URL: database.url,
          SKIP_ENV_VALIDATION: "true",
          NODE_ENV: "development",
          NEXT_PUBLIC_APP_URL: "https://app.samples.test",
          ...env,
        },
      },
    );
  }

  const approvals = async () =>
    (
      await connection.query<RowDataPacket[]>(
        `SELECT id, status, user_id AS userId, credential_kind AS credentialKind, api_handoffs.procedure AS procedureName,
                binding_hash AS bindingHash, payload, TIMESTAMPDIFF(HOUR, link_issued_at, expires_at) AS hours
           FROM api_handoffs WHERE kind = 'operation_approval' ORDER BY api_handoffs.procedure`,
      )
    )[0];

  test("three pending approvals of the owner, one per consequence, and their page URLs", async () => {
    const result = run(["--email=owner@samples.test", "--store=sa-roscoff"]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const rows = await approvals();
    assert.equal(rows.length, 3);
    const payloadOf = (row: RowDataPacket) =>
      (typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload) as {
        preview: { summary: string };
        consequences: string[];
      };
    assert.deepEqual(
      rows.map((row) => [row.procedureName, payloadOf(row).consequences]),
      [
        ["dashboard.payments.record", ["money"]],
        ["dashboard.reservations.updateStatus", ["stock_override", "customer_message"]],
        ["dashboard.team.removeMember", ["access_removed"]],
      ],
    );
    for (const row of rows) {
      assert.equal(row.status, "pending");
      assert.equal(row.userId, OWNER);
      assert.equal(row.credentialKind, "api_key");
      assert.match(row.bindingHash, /^[0-9a-f]{64}$/);
      assert.equal(row.hours, 24);
      assert.ok(result.stdout.includes(`https://app.samples.test/handoffs/${row.id}`));
    }
    assert.match(payloadOf(rows[0] as RowDataPacket).preview.summary, /^Record a rental payment/);
    assert.match(payloadOf(rows[2] as RowDataPacket).preview.summary, /from "Roscoff Voile"/);
    // The key that asks exists, and nobody holds its secret.
    const [keys] = await connection.query<RowDataPacket[]>(
      "SELECT name, revoked_at AS revokedAt FROM api_keys",
    );
    assert.deepEqual(
      keys.map((key) => [key.name, key.revokedAt]),
      [["Sample assistant", null]],
    );
  });

  test("it refuses to run in production, and writes nothing", async () => {
    const result = run(["--email=owner@samples.test", `--store=${STORE}`], {
      NODE_ENV: "production",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /NODE_ENV is production/);
    assert.equal((await approvals()).length, 0);
  });

  test("it refuses anyone but an owner of the store, and an unknown store or user", async () => {
    for (const args of [
      ["--email=member@samples.test", `--store=${STORE}`],
      ["--email=nobody@samples.test", `--store=${STORE}`],
      ["--email=owner@samples.test", "--store=nowhere"],
      ["--email=owner@samples.test"],
    ]) {
      const result = run(args);
      assert.equal(result.status, 1, args.join(" "));
    }
    assert.equal((await approvals()).length, 0);
  });
});
