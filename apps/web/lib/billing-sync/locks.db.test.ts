import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { hostname } from "node:os";

import type { RowDataPacket } from "mysql2/promise";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// A named lock's connection stays talking while its run lasts, and MySQL frees a lock
// whose connection falls silent within the idle limit (dev, 2026-10-30: a heartbeat
// lock held 2 h 13 min by a connection the network had dropped).

const LOCK = "louez:test:locks";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("named locks (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let locks: typeof import("./locks");

  before(async () => {
    database = await createTestDatabase("billing_locks");
    louezDb = await import("@louez/db");
    locks = await import("./locks");
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  /** Whether another session could take the lock now; it lets it go at once. */
  async function lockIsFree(): Promise<boolean> {
    const other = await database.connect();
    try {
      const [rows] = await other.query<RowDataPacket[]>("SELECT GET_LOCK(?, 0) AS got", [LOCK]);
      const free = Number(rows[0]?.got) === 1;
      if (free) await other.query("SELECT RELEASE_LOCK(?)", [LOCK]);
      return free;
    } finally {
      await other.end();
    }
  }

  async function sessionTimeout(connection: { query: typeof louezDb.db.$client.query }) {
    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT CONNECTION_ID() AS id, @@SESSION.wait_timeout AS session, @@GLOBAL.wait_timeout AS global",
    );
    const row = rows[0] ?? {};
    return { id: Number(row.id), session: Number(row.session), global: Number(row.global) };
  }

  test("the lock's connection has the idle limit while it holds the lock, then the server's again", async () => {
    let during: Awaited<ReturnType<typeof sessionTimeout>> | undefined;
    const result = await locks.withNamedLock(LOCK, 0, async (lockedDb) => {
      during = await sessionTimeout(lockedDb.$client);
      return "ran";
    });
    assert.deepEqual(result, { ran: true, value: "ran" });
    assert.equal(during?.session, locks.LOCK_IDLE_SECONDS);

    // The pool hands back its last released connection first.
    const pooled = await louezDb.db.$client.getConnection();
    try {
      const afterwards = await sessionTimeout(pooled);
      assert.equal(afterwards.id, during?.id);
      assert.equal(afterwards.session, afterwards.global);
    } finally {
      pooled.release();
    }
    assert.equal(await lockIsFree(), true);
  });

  test("a run longer than the idle limit keeps its lock: the pings keep its connection talking", async () => {
    const errors: string[] = [];
    const result = await locks.withNamedLock(
      LOCK,
      0,
      async () => {
        await sleep(2_500);
        return lockIsFree();
      },
      {
        idleSeconds: 1,
        pingMs: 200,
        log: { error: (_tag, message) => errors.push(message), warn: () => {} },
      },
    );
    assert.deepEqual(result, { ran: true, value: false });
    assert.deepEqual(errors, []);
    assert.equal(await lockIsFree(), true);
  });

  test("MySQL frees a lock whose connection falls silent, and the failed release is logged", async () => {
    const errors: string[] = [];
    let freedDuringRun = false;
    const result = await locks.withNamedLock(
      LOCK,
      0,
      async () => {
        // No ping reaches MySQL, as on a connection the network dropped.
        await sleep(2_500);
        freedDuringRun = await lockIsFree();
        return "ran";
      },
      {
        idleSeconds: 1,
        pingMs: 60_000,
        log: { error: (_tag, message) => errors.push(message), warn: () => {} },
      },
    );
    assert.deepEqual(result, { ran: true, value: "ran" });
    assert.equal(freedDuringRun, true);
    assert.equal(errors.length, 1);
    assert.match(errors[0] ?? "", /lock louez:test:locks: release failed .*within 1 s/);
    assert.equal(await lockIsFree(), true);
  });

  test("a lock taken too long by one connection is logged with its holder, then not again before the interval", async () => {
    const holder = await louezDb.db.$client.getConnection();
    try {
      const [rows] = await holder.query<RowDataPacket[]>(
        "SELECT CONNECTION_ID() AS id, GET_LOCK(?, 0) AS got",
        [LOCK],
      );
      assert.equal(Number(rows[0]?.got), 1);
      const id = Number(rows[0]?.id);
      const warnings: string[] = [];
      const options = {
        busyLogAfterMs: 0,
        busyLogEveryMs: 60_000,
        log: { error: () => {}, warn: (_tag: string, message: string) => warnings.push(message) },
      };
      assert.deepEqual(await locks.withNamedLock(LOCK, 0, async () => "ran", options), {
        ran: false,
      });
      assert.deepEqual(await locks.withNamedLock(LOCK, 0, async () => "ran", options), {
        ran: false,
      });
      assert.equal(warnings.length, 1);
      assert.match(
        warnings[0] ?? "",
        new RegExp(
          `^lock louez:test:locks: taken for at least 0 min by MySQL connection ${id} ` +
            `\\(root@[^,]+, louez@${hostname()}, Sleep for \\d+ s\\); KILL ${id} frees it$`,
        ),
      );
    } finally {
      await holder.query("SELECT RELEASE_LOCK(?)", [LOCK]);
      holder.release();
    }
    assert.equal(await lockIsFree(), true);
  });
});
