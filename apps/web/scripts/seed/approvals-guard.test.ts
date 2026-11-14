import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { WRITE_SAMPLES_FLAG, checkSampleDatabase } from "./approvals-guard";
import { openSampleDatabase } from "./approvals-write";

// Where the sample approvals script may write, without a database: only to
// one on this machine, named by a URL with no query string or fragment,
// only with its flag, never in production; the writer's pool is opened with
// exactly the fields the guard read; and the script exits on a refusal
// before anything connects.

const APP_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const LOCAL = "mysql://root:secret@127.0.0.1:3306/louez";

const check = (
  databaseUrl: string | undefined,
  options: { flagged?: boolean; nodeEnv?: string } = {},
) =>
  checkSampleDatabase({
    databaseUrl,
    nodeEnv: options.nodeEnv ?? "development",
    flagged: options.flagged ?? true,
  });
/** Why the guard refuses, or null when it lets the script write. */
const refusal = (...args: Parameters<typeof check>) => {
  const verdict = check(...args);
  return verdict.ok ? null : verdict.reason;
};

describe("the sample approvals' guard", () => {
  test("a database on this machine, with the flag, may take the samples", () => {
    for (const url of [
      LOCAL,
      "mysql://root:secret@localhost:6984/louez",
      "mysql://root:secret@LOCALHOST/louez",
      "mysql://root:secret@[::1]:3306/louez",
    ]) {
      assert.equal(refusal(url), null, url);
    }
    assert.equal(refusal(LOCAL, { nodeEnv: undefined }), null);
  });

  test("a remote host is refused, whatever its port or name", () => {
    for (const url of [
      "mysql://louez:secret@db.louez.io:3306/louez",
      "mysql://louez:secret@10.0.0.12:47213/louez",
      "mysql://louez:secret@db.internal:6984/louez",
      "mysql://louez:secret@127.0.0.1.example.com/louez",
      "mysql://louez:secret@localhost.attacker.test/louez",
    ]) {
      assert.match(refusal(url) ?? "", /not at this machine/, url);
    }
  });

  test("any query string or fragment is refused: the driver reads another host or socket there", () => {
    for (const url of [
      "mysql://u:p@localhost/db?host=db.production.example",
      "mysql://u:p@127.0.0.1:3306/db?socketPath=/var/run/prod/mysqld.sock",
      "mysql://u:p@localhost/db?ssl=true",
      "mysql://u:p@localhost/db?",
      "mysql://u:p@localhost/db#fragment",
      "mysql://u:p@localhost/db#",
      "mysql://u:p@localhost/db?a=1#b",
    ]) {
      assert.match(refusal(url) ?? "", /query string or a fragment/, url);
    }
  });

  test("the writer's pool is opened with the fields the guard read, nothing else", async () => {
    const verdict = check("mysql://sample%40user:p%3Ass@localhost:6984/louez_dev");
    assert.ok(verdict.ok);
    assert.deepEqual(verdict.connection, {
      host: "localhost",
      port: 6984,
      user: "sample@user",
      password: "p:ss",
      database: "louez_dev",
    });
    const ipv6 = check("mysql://root:x@[::1]/louez");
    assert.deepEqual(ipv6.ok && ipv6.connection, {
      host: "::1",
      port: 3306,
      user: "root",
      password: "x",
      database: "louez",
    });
    // The pool connects to nothing until a query: its options are what it would connect with.
    const { pool } = openSampleDatabase(verdict.connection);
    try {
      const config = Reflect.get(Reflect.get(pool, "pool"), "config") as {
        connectionConfig: Record<string, unknown>;
      };
      const { host, port, user, password, database, socketPath } = config.connectionConfig;
      assert.deepEqual(
        { host, port, user, password, database, socketPath },
        { host: "localhost", port: 6984, user: "sample@user", password: "p:ss", database: "louez_dev", socketPath: undefined },
      );
    } finally {
      await pool.end();
    }
  });

  test("a URL naming no database, or not mysql, is refused", () => {
    assert.match(refusal("mysql://root:x@localhost") ?? "", /names no database/);
    assert.match(refusal("mysql://root:x@localhost/a/b") ?? "", /names no database/);
    assert.match(refusal("postgres://root:x@localhost/louez") ?? "", /not a mysql/);
  });

  test("a local database without the flag is refused, and the message names the flag", () => {
    assert.match(refusal(LOCAL, { flagged: false }) ?? "", new RegExp(WRITE_SAMPLES_FLAG));
  });

  test("production is refused even on this machine with the flag", () => {
    assert.match(refusal(LOCAL, { nodeEnv: "production" }) ?? "", /production/);
  });

  test("a malformed or missing URL is refused", () => {
    assert.match(refusal("not a url") ?? "", /not a URL/);
    assert.match(refusal("mysql://") ?? "", /not at this machine|not a URL/);
    assert.match(refusal("mysql://root:x@:3306/louez") ?? "", /not at this machine|not a URL/);
    assert.match(refusal("") ?? "", /not set/);
    assert.match(refusal(undefined) ?? "", /not set/);
  });

  test("the script exits on a refusal before anything connects", () => {
    for (const [url, flag, why] of [
      ["mysql://louez:secret@db.louez.io:47213/louez", true, /not at this machine/],
      ["mysql://u:p@localhost/db?host=db.louez.io", true, /query string or a fragment/],
      [LOCAL, false, new RegExp(WRITE_SAMPLES_FLAG)],
    ] as const) {
      const started = Date.now();
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "scripts/seed/approvals.ts",
          "--email=owner@samples.test",
          "--store=sa-roscoff",
          ...(flag ? [WRITE_SAMPLES_FLAG] : []),
        ],
        {
          cwd: APP_ROOT,
          encoding: "utf8",
          env: { ...process.env, DATABASE_URL: url, NODE_ENV: "development", SKIP_ENV_VALIDATION: "true" },
        },
      );
      assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stderr, why);
      // The database modules were never loaded: no connection, no driver error.
      assert.doesNotMatch(result.stderr, /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ER_[A-Z_]+|at .*mysql2/);
      assert.ok(Date.now() - started < 60_000);
    }
  });
});
