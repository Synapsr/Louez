import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// The effective policy in service mode, read from the policy cache (louez-billing
// docs/api, README §8.3 and §8.4). The policies use the public test values of
// fees.md (Q33): 123 and 250 bps, a 150 marketplace fee, a 90 per-reservation fee,
// a minimum of 50 and a maximum of 300.

const NEW_STORES_FROM = "2027-01-25T00:00:00Z";

const base = {
  schema: "louez.billing.policy/1",
  issuedAt: "2026-11-20T10:00:00Z",
  newStoresCreatedFrom: null,
  currency: "EUR",
  marketplaceFeeMinor: 150,
  reservations: { allowed: true },
  notice: null,
  stripeCustomerId: null,
  labels: { offer: { fr: "Offre de test", en: "Test offer" }, notice: null },
};
const percent = {
  kind: "percent",
  rateBps: 123,
  minMinor: 50,
  maxMinor: 300,
  excludeInsurance: true,
  appliesTo: ["rental", "extension"],
};

const DEFAULT_V1 = {
  ...base,
  storeId: "*",
  version: 1,
  effectiveFrom: "2027-01-25T00:00:00Z",
  newStoresCreatedFrom: "2027-01-25T00:00:00Z",
  offerKey: "test-commission",
  invoicing: "service",
  applicationFee: percent,
  reservations: { allowed: false, reason: "payment_method_required" },
  notice: { kind: "payment_method_missing", blockAt: null },
  labels: {
    offer: { fr: "Commission de test", en: "Test commission" },
    notice: { fr: "Ajoutez une carte.", en: "Add a card." },
  },
};
const OLD_STORE_V1 = {
  ...base,
  storeId: "pol_old_store",
  version: 1,
  effectiveFrom: "2026-12-01T00:00:00Z",
  offerKey: "test-legacy",
  invoicing: "louez_legacy",
  applicationFee: { kind: "per_reservation", amountMinor: 90 },
};
const NEW_STORE_V1 = {
  ...base,
  storeId: "pol_new_store",
  version: 1,
  effectiveFrom: "2027-02-05T00:00:00Z",
  offerKey: "test-commission",
  invoicing: "service",
  applicationFee: { ...percent, rateBps: 250 },
};

describe("getEffectivePolicy (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let policy: typeof import("./policy");
  const names = ["LOUEZ_BILLING", "BILLING_SERVICE_URL", "BILLING_NEW_STORES_FROM"] as const;
  const saved = new Map(names.map((name) => [name, process.env[name]]));

  before(async () => {
    database = await createTestDatabase("billing_policy");
    louezDb = await import("@louez/db");
    policy = await import("./policy");
    await louezDb.db
      .insert(louezDb.stores)
      .values([
        store("pol_old_store", "2026-05-01T00:00:00Z"),
        store("pol_plain_old", "2026-06-01T00:00:00Z"),
        store("pol_new_store", "2027-02-01T00:00:00Z"),
        store("pol_early_new", "2027-01-20T00:00:00Z"),
      ]);
    await louezDb.db.insert(louezDb.billingPolicies).values(
      [DEFAULT_V1, OLD_STORE_V1, NEW_STORE_V1].map((body) => ({
        storeId: body.storeId,
        version: body.version,
        effectiveFrom: new Date(body.effectiveFrom),
        body,
      })),
    );
  });
  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });
  beforeEach(() => {
    process.env.LOUEZ_BILLING = "cloud";
    process.env.BILLING_SERVICE_URL = "http://127.0.0.1:1";
    process.env.BILLING_NEW_STORES_FROM = NEW_STORES_FROM;
  });
  afterEach(() => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  function store(id: string, createdAt: string) {
    return {
      id,
      userId: `user_${id}`,
      name: id,
      slug: id.replaceAll("_", "-"),
      createdAt: new Date(createdAt),
    };
  }

  test("an old store's own louez_legacy version: legacy billing applies, its fee is informational", async () => {
    const effective = await policy.getEffectivePolicy(
      "pol_old_store",
      new Date("2027-02-01T00:00:00Z"),
    );
    assert.equal(effective.source, "store");
    assert.equal(effective.version, 1);
    assert.equal(effective.isNew, false);
    assert.equal(effective.legacyBillingApplies, true);
    assert.equal(effective.policy?.offerKey, "test-legacy");
    assert.deepEqual(effective.terms, {
      invoicing: "louez_legacy",
      currency: "EUR",
      applicationFee: { kind: "per_reservation", amountMinor: 90 },
      marketplaceFeeMinor: 150,
      reservations: { allowed: true },
    });
    assert.equal(effective.acceptsReservations, true);
  });

  test("an old store without a version of its own is legacy, as today", async () => {
    const effective = await policy.getEffectivePolicy(
      "pol_plain_old",
      new Date("2027-02-01T00:00:00Z"),
    );
    assert.equal(effective.source, "legacy");
    assert.equal(effective.policy, null);
    assert.equal(effective.terms.invoicing, "louez_legacy");
    assert.equal(effective.legacyBillingApplies, true);
    assert.equal(
      await policy.legacyBillingApplies("pol_plain_old", new Date("2027-02-01T00:00:00Z")),
      true,
    );
  });

  test("a new store uses * until its own version takes effect", async () => {
    const before = await policy.getEffectivePolicy(
      "pol_new_store",
      new Date("2027-02-03T00:00:00Z"),
    );
    assert.equal(before.source, "default");
    assert.equal(before.isNew, true);
    assert.equal(before.legacyBillingApplies, false);
    assert.deepEqual(before.terms.applicationFee, percent);
    assert.deepEqual(before.terms.reservations, {
      allowed: false,
      reason: "payment_method_required",
    });
    assert.equal(before.acceptsReservations, false);
    assert.equal(before.policy?.labels.notice?.en, "Add a card.");

    const own = await policy.getEffectivePolicy("pol_new_store", new Date("2027-02-05T00:00:00Z"));
    assert.equal(own.source, "store");
    assert.equal(own.terms.invoicing, "service");
    assert.deepEqual(own.terms.applicationFee, { ...percent, rateBps: 250 });
    assert.equal(own.acceptsReservations, true);
  });

  test("a new store with no version in force fails closed: no fee, no billable reservation", async () => {
    // New by BILLING_NEW_STORES_FROM, before the * version takes effect.
    process.env.BILLING_NEW_STORES_FROM = "2027-01-18T00:00:00Z";
    const effective = await policy.getEffectivePolicy(
      "pol_early_new",
      new Date("2027-01-21T00:00:00Z"),
    );
    assert.deepEqual(effective, {
      source: "fail_closed",
      version: null,
      isNew: true,
      legacyBillingApplies: false,
      policy: null,
      terms: {
        invoicing: "service",
        currency: null,
        applicationFee: { kind: "none" },
        marketplaceFeeMinor: 0,
        reservations: { allowed: false, reason: "payment_method_required" },
      },
      acceptsReservations: false,
    });
  });

  test("a store that does not exist is an error", async () => {
    await assert.rejects(
      policy.getEffectivePolicy("pol_missing", new Date("2027-02-01T00:00:00Z")),
      /pol_missing does not exist/,
    );
  });
});
