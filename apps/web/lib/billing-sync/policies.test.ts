import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createPullLimiter, policyV1Schema } from "./policies";

// The per-store pull limit of README §4.4: one pull per store every 10 seconds, and
// concurrent pulls share one request. Then the shapes of contract 1.3.0 that the
// schema must take, since Louez refuses a policy it cannot fully understand (§8.1).

describe("createPullLimiter", () => {
  test("a pull is shared for the interval from its start, then a new one runs", async () => {
    let now = 1_000_000;
    const limit = createPullLimiter<number>(10_000, () => now);
    let calls = 0;
    const pull = async () => {
      calls += 1;
      return calls;
    };

    assert.equal(await limit("s1", pull), 1);
    now += 9_999;
    assert.equal(await limit("s1", pull), 1, "still inside the 10 seconds");
    assert.equal(await limit("s2", pull), 2, "another store has its own window");
    now += 1;
    assert.equal(await limit("s1", pull), 3, "10 seconds after the first pull started");
    assert.equal(calls, 3);
  });

  test("calls made while a pull runs wait for it and get its result", async () => {
    const limit = createPullLimiter<string>(10_000, () => 0);
    let release: (value: string) => void = () => {};
    let calls = 0;
    const pull = () => {
      calls += 1;
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    };
    const first = limit("s1", pull);
    const second = limit("s1", pull);
    release("done");
    assert.deepEqual(await Promise.all([first, second]), ["done", "done"]);
    assert.equal(calls, 1);
  });
});

describe("policyV1Schema", () => {
  const policy = (overrides: Record<string, unknown>) => ({
    schema: "louez.billing.policy/1",
    storeId: "pol_balance_store",
    version: 4,
    effectiveFrom: "2027-02-01T00:00:00Z",
    issuedAt: "2027-02-01T00:00:00Z",
    newStoresCreatedFrom: null,
    offerKey: "test-commission",
    invoicing: "service",
    currency: "EUR",
    applicationFee: { kind: "none" },
    marketplaceFeeMinor: 0,
    reservations: { allowed: true },
    notice: null,
    stripeCustomerId: null,
    labels: { offer: { fr: "Offre", en: "Offer" }, notice: { fr: "Carte", en: "Card" } },
    ...overrides,
  });

  test("takes the balance limit's notices and gate reason (1.3.0)", () => {
    const near = policyV1Schema.safeParse(
      policy({ notice: { kind: "balance_limit_near", blockAt: null } }),
    );
    assert.ok(near.success);
    const reached = policyV1Schema.safeParse(
      policy({
        reservations: { allowed: false, reason: "balance_limit_reached" },
        notice: { kind: "balance_limit_reached", blockAt: null },
      }),
    );
    assert.ok(reached.success);
  });

  test("refuses a notice kind or a gate reason it does not know", () => {
    assert.ok(
      !policyV1Schema.safeParse(policy({ notice: { kind: "add_card", blockAt: null } })).success,
    );
    assert.ok(
      !policyV1Schema.safeParse(
        policy({ reservations: { allowed: false, reason: "balance_limit_near" } }),
      ).success,
    );
  });
});
