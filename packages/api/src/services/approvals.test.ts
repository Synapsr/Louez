import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, mock, test } from "node:test";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of ["@louez/types", "@louez/utils", "@louez/utils/sanitize-rich-text"]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}

const {
  APPROVAL_COOL_DOWN_MS,
  APPROVAL_LIMITS,
  APPROVAL_REQUESTS_PER_HOUR,
  MAX_PENDING_APPROVALS,
  MAX_STORE_PENDING_APPROVALS,
  approvalIdentity,
  approvalsFull,
  coolDownEnd,
} = await import("./approvals");

// The rules of a person's approval that need no database, with their
// parameters: the identity of a request, the cool-down after a refusal, and
// the caps (docs/architecture/api-and-agents.md, "Refusals, expiry, repeated
// requests"). The database tests run them under the store's lock.

const NOW = new Date("2027-05-01T10:00:00.000Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);

describe("the plan's values", () => {
  test("ten open per connection and store, thirty new an hour, fifty open per store, an hour's cool-down", () => {
    assert.equal(MAX_PENDING_APPROVALS, 10);
    assert.equal(APPROVAL_REQUESTS_PER_HOUR, 30);
    assert.equal(MAX_STORE_PENDING_APPROVALS, 50);
    assert.equal(APPROVAL_COOL_DOWN_MS, 3_600_000);
  });
});

describe("approvalIdentity", () => {
  const request = {
    credential: { kind: "api_key", id: "key_1" },
    storeId: "store_1",
    procedure: "dashboard.payments.record",
    facts: { reservationId: "r1", amount: "40.00", currency: "EUR" },
  };

  test("the facts' order does not matter; each of credential, store, procedure and fact does", () => {
    const base = approvalIdentity(request);
    assert.match(base, /^[0-9a-f]{64}$/);
    assert.equal(
      approvalIdentity({
        ...request,
        facts: { currency: "EUR", amount: "40.00", reservationId: "r1" },
      }),
      base,
    );
    const others = [
      { ...request, credential: { kind: "oauth", id: "key_1" } },
      { ...request, credential: { kind: "api_key", id: "key_2" } },
      { ...request, storeId: "store_2" },
      { ...request, procedure: "dashboard.payments.delete" },
      { ...request, facts: { ...request.facts, amount: "41.00" } },
      { ...request, facts: { ...request.facts, currency: "USD" } },
      { ...request, facts: { ...request.facts, reservationId: "r2" } },
    ];
    for (const other of others) assert.notEqual(approvalIdentity(other), base);
  });
});

describe("coolDownEnd", () => {
  test("refused within the cool-down: until its end; past it, or never refused: none", () => {
    assert.equal(coolDownEnd(null, NOW), null);
    assert.deepEqual(coolDownEnd(at(-1), NOW), at(APPROVAL_COOL_DOWN_MS - 1));
    assert.equal(coolDownEnd(at(-APPROVAL_COOL_DOWN_MS), NOW), null, "the end itself is free");
    assert.deepEqual(coolDownEnd(at(-1_000), NOW, 5_000), at(4_000), "its parameter");
  });
});

describe("approvalsFull", () => {
  const counts = (connectionOpen: number, lastHour: number, storeOpen: number) => ({
    connectionOpen: { count: connectionOpen, firstEnd: at(600_000) },
    connectionLastHour: { count: lastHour, firstAt: at(-1_800_000) },
    storeOpen: { count: storeOpen, firstEnd: at(300_000) },
  });

  test("below every cap: none", () => {
    assert.equal(
      approvalsFull(
        counts(
          MAX_PENDING_APPROVALS - 1,
          APPROVAL_REQUESTS_PER_HOUR - 1,
          MAX_STORE_PENDING_APPROVALS - 1,
        ),
        NOW,
      ),
      null,
    );
  });

  test("each cap, with when its first entry frees", () => {
    assert.deepEqual(approvalsFull(counts(MAX_PENDING_APPROVALS, 0, 0), NOW), {
      limit: "connection_open",
      retryAt: at(600_000),
    });
    assert.deepEqual(approvalsFull(counts(0, APPROVAL_REQUESTS_PER_HOUR, 0), NOW), {
      limit: "connection_per_hour",
      retryAt: at(-1_800_000 + APPROVAL_LIMITS.hourMs),
    });
    assert.deepEqual(approvalsFull(counts(0, 0, MAX_STORE_PENDING_APPROVALS), NOW), {
      limit: "store_open",
      retryAt: at(300_000),
    });
  });

  test("its parameters", () => {
    const limits = { ...APPROVAL_LIMITS, connectionOpen: 2, connectionPerHour: 3, storeOpen: 4 };
    assert.equal(approvalsFull(counts(1, 2, 3), NOW, limits), null);
    assert.equal(approvalsFull(counts(2, 0, 0), NOW, limits)?.limit, "connection_open");
    assert.equal(approvalsFull(counts(0, 3, 0), NOW, limits)?.limit, "connection_per_hour");
    assert.equal(approvalsFull(counts(0, 0, 4), NOW, limits)?.limit, "store_open");
  });
});
