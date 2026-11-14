import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { WRITE_SAMPLES_FLAG, sampleDataRefusal } from "./approvals-guard";

// Where the sample approvals script may write, without a database: only to
// one on this machine, only with its flag, never in production; and the
// script exits on a refusal before anything connects.

const APP_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const LOCAL = "mysql://root:secret@127.0.0.1:3306/louez";

const refusal = (databaseUrl: string | undefined, options: { flagged?: boolean; nodeEnv?: string } = {}) =>
  sampleDataRefusal({
    databaseUrl,
    nodeEnv: options.nodeEnv ?? "development",
    flagged: options.flagged ?? true,
  });

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

  test("a local database without the flag is refused, and the message names the flag", () => {
    assert.match(refusal(LOCAL, { flagged: false }) ?? "", new RegExp(WRITE_SAMPLES_FLAG));
  });

  test("production is refused even on this machine with the flag", () => {
    assert.match(refusal(LOCAL, { nodeEnv: "production" }) ?? "", /production/);
  });

  test("a malformed or missing URL is refused", () => {
    assert.match(refusal("not a url") ?? "", /not a URL/);
    assert.match(refusal("mysql://") ?? "", /not at this machine|not a URL/);
    assert.match(refusal("") ?? "", /not set/);
    assert.match(refusal(undefined) ?? "", /not set/);
  });

  test("the script exits on a refusal before anything connects", () => {
    for (const [url, flag, why] of [
      ["mysql://louez:secret@db.louez.io:47213/louez", true, /not at this machine/],
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
      assert.doesNotMatch(result.stderr, /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|mysql/i);
      assert.ok(Date.now() - started < 60_000);
    }
  });
});
