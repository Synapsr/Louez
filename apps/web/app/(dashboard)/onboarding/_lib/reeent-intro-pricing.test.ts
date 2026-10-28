import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, test } from "node:test";

import type { PolicyV1 } from "@/lib/billing-sync/policies";
import type { EffectivePolicy } from "@/lib/billing/policy";

import { describeReeentIntroPricing } from "./reeent-intro-pricing";

// The reeent step's pricing slide, for a store created now: Louez's own pricing only
// while Louez's legacy billing would bill it, else the label of the policy the billing
// service sets. The policy uses the public test values of fees.md (Q33).

const DEFAULT_POLICY: PolicyV1 = {
  schema: "louez.billing.policy/1",
  storeId: "*",
  version: 1,
  effectiveFrom: "2027-01-25T00:00:00Z",
  issuedAt: "2027-01-20T10:00:00Z",
  newStoresCreatedFrom: "2027-01-25T00:00:00Z",
  offerKey: "test-commission",
  invoicing: "service",
  currency: "EUR",
  applicationFee: {
    kind: "percent",
    rateBps: 250,
    minMinor: 0,
    maxMinor: null,
    excludeInsurance: false,
    appliesTo: ["rental"],
  },
  marketplaceFeeMinor: 150,
  reservations: { allowed: true },
  notice: null,
  stripeCustomerId: null,
  labels: { offer: { fr: "Commission de test", en: "Test commission" }, notice: null },
};

function uncreated(overrides: Partial<EffectivePolicy>): EffectivePolicy {
  return {
    source: "default",
    version: 1,
    isNew: true,
    legacyBillingApplies: false,
    policy: DEFAULT_POLICY,
    terms: {
      invoicing: "service",
      currency: "EUR",
      applicationFee: DEFAULT_POLICY.applicationFee,
      marketplaceFeeMinor: 150,
      reservations: { allowed: true },
    },
    acceptsReservations: true,
    ...overrides,
  };
}

describe("describeReeentIntroPricing", () => {
  test("a store Louez's own billing would bill sees Louez's pricing", () => {
    // Without the billing service, or before BILLING_NEW_STORES_FROM.
    const legacy = uncreated({ source: "legacy", version: null, isNew: false, legacyBillingApplies: true, policy: null });
    assert.deepEqual(describeReeentIntroPricing(legacy, "fr"), { kind: "legacy" });
  });

  test("a new store sees the label of the * version, in its language or in English", () => {
    assert.deepEqual(describeReeentIntroPricing(uncreated({}), "fr"), {
      kind: "offer",
      offer: "Commission de test",
    });
    assert.deepEqual(describeReeentIntroPricing(uncreated({}), "ja"), {
      kind: "offer",
      offer: "Test commission",
    });
  });

  test("a new store with no * version in force sees no offer", () => {
    const failClosed = uncreated({ source: "fail_closed", version: null, policy: null });
    assert.deepEqual(describeReeentIntroPricing(failClosed, "fr"), { kind: "offer", offer: null });
  });

  test("Louez's words around the offer name no price and no rate, in every language", async () => {
    const directory = new URL("../../../../messages/", import.meta.url);
    const files = (await readdir(directory)).filter((name) => name.endsWith(".json"));
    assert.equal(files.length, 13);
    for (const file of files) {
      const catalogue: unknown = JSON.parse(await readFile(new URL(file, directory), "utf8"));
      const pricing = readPath(catalogue, ["onboarding", "reeent", "panel", "pricing"]);
      assert.ok(pricing && typeof pricing === "object", file);
      for (const key of ["title", "details", "individualNote"]) {
        const text = readPath(pricing, [key]);
        assert.equal(typeof text, "string", `${file} ${key}`);
        assert.doesNotMatch(String(text), /\d/, `${file} ${key}`);
      }
    }
  });
});

function readPath(value: unknown, path: readonly string[]): unknown {
  let node = value;
  for (const key of path) {
    if (!node || typeof node !== "object" || !(key in node)) return undefined;
    node = Object.fromEntries(Object.entries(node))[key];
  }
  return node;
}
