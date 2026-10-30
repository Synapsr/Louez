import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import {
  type BillingPolicyCore,
  type CachedPolicy,
  type StorePolicyRecords,
  billingNewStoresFrom,
  effectiveStorePolicy,
} from "./billing-policy";

// The effective policy from cached records (louez-billing docs/api, README §8.3 and
// §8.5). The resolver itself runs on the contract's vectors in
// apps/web/lib/billing/policy.test.ts.

const savedNewStoresFrom = process.env.BILLING_NEW_STORES_FROM;

afterEach(() => {
  if (savedNewStoresFrom === undefined) delete process.env.BILLING_NEW_STORES_FROM;
  else process.env.BILLING_NEW_STORES_FROM = savedNewStoresFrom;
});

function version(
  overrides: Partial<BillingPolicyCore> & Pick<BillingPolicyCore, "storeId">,
): CachedPolicy {
  const core: BillingPolicyCore = {
    schema: "louez.billing.policy/1",
    version: 1,
    effectiveFrom: "2027-01-25T00:00:00Z",
    newStoresCreatedFrom: null,
    invoicing: "service",
    reservations: { allowed: true },
    ...overrides,
  };
  return { ...core, body: { ...core, offerKey: "test-offer" } };
}

const records = (
  storeCreatedAt: string,
  versions: readonly CachedPolicy[],
): StorePolicyRecords => ({
  storeId: "s1",
  storeCreatedAt: new Date(storeCreatedAt),
  versions,
});

describe("effectiveStorePolicy", () => {
  test("a new store with no version in force fails closed: reservations are refused", () => {
    process.env.BILLING_NEW_STORES_FROM = "2027-01-25T00:00:00Z";
    const policy = effectiveStorePolicy(
      records("2027-02-01T00:00:00Z", []),
      new Date("2027-02-01T00:05:00Z"),
    );
    assert.equal(policy.source, "fail_closed");
    assert.equal(policy.applied, null);
    assert.equal(policy.legacyBillingApplies, false);
    assert.deepEqual(policy.reservations, { allowed: false, reason: "payment_method_required" });
    assert.equal(policy.acceptsReservations, false);
  });

  test("the version in force is the one returned, with its body", () => {
    const v1 = version({ storeId: "s1", invoicing: "louez_legacy" });
    const v2 = version({
      storeId: "s1",
      version: 2,
      effectiveFrom: "2027-03-01T00:00:00Z",
      reservations: { allowed: false, reason: "payment_overdue" },
    });
    const before = effectiveStorePolicy(
      records("2026-05-01T00:00:00Z", [v1, v2]),
      new Date("2027-02-01T00:00:00Z"),
    );
    assert.equal(before.applied, v1);
    assert.equal(before.legacyBillingApplies, true);
    assert.equal(before.acceptsReservations, true);
    const after = effectiveStorePolicy(
      records("2026-05-01T00:00:00Z", [v1, v2]),
      new Date("2027-03-01T00:00:00Z"),
    );
    assert.equal(after.applied, v2);
    assert.equal(after.legacyBillingApplies, false);
    assert.equal(after.acceptsReservations, false);
  });

  test("an old store with no version of its own is legacy and takes reservations", () => {
    process.env.BILLING_NEW_STORES_FROM = "2027-01-25T00:00:00Z";
    const policy = effectiveStorePolicy(
      records("2026-05-01T00:00:00Z", [
        version({ storeId: "*", newStoresCreatedFrom: "2027-01-25T00:00:00Z" }),
      ]),
      new Date("2027-02-01T00:00:00Z"),
    );
    assert.equal(policy.source, "legacy");
    assert.equal(policy.applied, null);
    assert.equal(policy.legacyBillingApplies, true);
    assert.deepEqual(policy.reservations, { allowed: true });
  });
});

describe("billing variables", () => {
  test("BILLING_NEW_STORES_FROM: null when unset, a date when set, an error when not a date", () => {
    delete process.env.BILLING_NEW_STORES_FROM;
    assert.equal(billingNewStoresFrom(), null);
    process.env.BILLING_NEW_STORES_FROM = "2027-01-25T00:00:00Z";
    assert.equal(billingNewStoresFrom()?.toISOString(), "2027-01-25T00:00:00.000Z");
    process.env.BILLING_NEW_STORES_FROM = "soon";
    assert.throws(() => billingNewStoresFrom(), /BILLING_NEW_STORES_FROM/);
  });
});
