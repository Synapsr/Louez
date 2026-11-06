import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { summarizeLinkedAccounts } from "./util.linked-accounts";

const account = (providerId: string, updatedAt: string) => ({
  providerId,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date(updatedAt),
});

describe("summarizeLinkedAccounts", () => {
  test("an account that only uses the e-mail code has no row", () => {
    assert.deepEqual(summarizeLinkedAccounts([]), {
      googleLinked: false,
      passwordSetAt: null,
    });
  });

  test("reports Google and the date the password was last changed", () => {
    const summary = summarizeLinkedAccounts([
      account("google", "2026-02-01T00:00:00Z"),
      account("credential", "2026-09-12T10:00:00Z"),
    ]);

    assert.equal(summary.googleLinked, true);
    assert.deepEqual(summary.passwordSetAt, new Date("2026-09-12T10:00:00Z"));
  });

  test("a Google account alone does not count as a password", () => {
    assert.equal(
      summarizeLinkedAccounts([account("google", "2026-02-01T00:00:00Z")]).passwordSetAt,
      null,
    );
  });
});
