import assert from "node:assert/strict";
import { test } from "node:test";

import { DrizzleQueryError } from "drizzle-orm";

import { isDuplicateKeyError } from "./duplicate-key";

/** A server error as mysql2 builds it (Packet.asError): the code is on the error. */
function mysqlError(code: string, errno: number, message: string): Error {
  return Object.assign(new Error(message), {
    code,
    errno,
    sqlState: "23000",
    sqlMessage: message,
  });
}

const duplicate = () =>
  mysqlError(
    "ER_DUP_ENTRY",
    1062,
    "Duplicate entry 'res:r1' for key 'platform_fee.platform_fee_dedup_key_unique'",
  );

/** What drizzle 0.45 throws for a failed query: the driver's error is its cause. */
const failedQuery = (cause: Error) =>
  new DrizzleQueryError(
    "insert into `platform_fee` (`id`, `dedup_key`) values (?, ?)",
    ["f1", "res:r1"],
    cause,
  );

test("drizzle's error for a duplicate insert names only the query: the code is on its cause", () => {
  const error = failedQuery(duplicate());

  assert.doesNotMatch(error.message, /Duplicate|unique/);
  assert.equal(isDuplicateKeyError(error), true);
});

test("the driver's own error, or one wrapped again, is a duplicate too", () => {
  assert.equal(isDuplicateKeyError(duplicate()), true);
  assert.equal(
    isDuplicateKeyError(new Error("insert failed", { cause: failedQuery(duplicate()) })),
    true,
  );
  // errno alone, as a driver that names codes differently would report it.
  assert.equal(isDuplicateKeyError(Object.assign(new Error("dup"), { errno: 1062 })), true);
});

test("any other error is not, even when its message says Duplicate", () => {
  const lockTimeout = mysqlError("ER_LOCK_WAIT_TIMEOUT", 1205, "Lock wait timeout exceeded");
  assert.equal(isDuplicateKeyError(failedQuery(lockTimeout)), false);
  assert.equal(isDuplicateKeyError(new Error("Duplicate entry")), false);
  assert.equal(isDuplicateKeyError(new Error("violates unique constraint")), false);
  for (const value of [undefined, null, "Duplicate entry", 1062, { code: "ER_PARSE_ERROR" }]) {
    assert.equal(isDuplicateKeyError(value), false, String(value));
  }
});
