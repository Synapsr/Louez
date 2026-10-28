import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, test } from "node:test";

import { z } from "zod";

import { resolvePolicy } from "@louez/db";

import { getEffectivePolicy, legacyBillingApplies } from "./policy";

// README §8.3's resolver on the contract's public vectors (policy-01 to policy-14,
// copied into lib/billing-sync/fee-vectors.public.json), and the built-in policies of
// the modes without the service (README §12).

const vectorSchema = z.object({
  id: z.string(),
  function: z.literal("resolvePolicy"),
  input: z.object({
    storeId: z.string(),
    storeCreatedAt: z.string(),
    t: z.string(),
    newStoresFrom: z.string().nullable(),
    versions: z.array(
      z.object({
        storeId: z.string(),
        version: z.number(),
        effectiveFrom: z.string(),
        newStoresCreatedFrom: z.string().nullable(),
        invoicing: z.enum(["service", "louez_legacy", "none"]),
      }),
    ),
  }),
  expected: z.object({
    source: z.enum(["store", "default", "fail_closed", "legacy"]),
    version: z.number().nullable(),
    isNew: z.boolean(),
    legacyBillingApplies: z.boolean(),
  }),
});

const vectors = z
  .object({ vectors: z.array(z.unknown()) })
  .parse(
    JSON.parse(
      readFileSync(new URL("../billing-sync/fee-vectors.public.json", import.meta.url), "utf8"),
    ),
  )
  .vectors.flatMap((raw) => {
    const parsed = vectorSchema.safeParse(raw);
    return parsed.success ? [parsed.data] : [];
  });

describe("resolvePolicy vectors", () => {
  test("all fourteen are present", () => {
    assert.deepEqual(
      vectors.map((vector) => vector.id),
      Array.from({ length: 14 }, (_, index) => `policy-${String(index + 1).padStart(2, "0")}`),
    );
  });

  for (const vector of vectors) {
    test(vector.id, () => {
      const { storeId, storeCreatedAt, t, newStoresFrom, versions } = vector.input;
      assert.deepEqual(
        resolvePolicy(storeId, storeCreatedAt, t, newStoresFrom, versions),
        vector.expected,
      );
    });
  }
});

describe("getEffectivePolicy without the service", () => {
  const saved = { billing: process.env.LOUEZ_BILLING, url: process.env.BILLING_SERVICE_URL };
  afterEach(() => {
    for (const [name, value] of [
      ["LOUEZ_BILLING", saved.billing],
      ["BILLING_SERVICE_URL", saved.url],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  // No database here: a read would fail, so these also show the table is not read.
  const at = new Date("2027-02-01T00:00:00Z");

  test("LOUEZ_BILLING off: the built-in policy, no legacy billing, no gate", async () => {
    delete process.env.LOUEZ_BILLING;
    process.env.BILLING_SERVICE_URL = "https://billing.example.test";
    assert.deepEqual(await getEffectivePolicy("any_store", at), {
      source: "built_in",
      version: null,
      isNew: false,
      legacyBillingApplies: false,
      policy: null,
      terms: {
        invoicing: "none",
        currency: null,
        applicationFee: { kind: "none" },
        marketplaceFeeMinor: 0,
        reservations: { allowed: true },
      },
      acceptsReservations: true,
    });
    assert.equal(await legacyBillingApplies("any_store", at), false);
  });

  test("LOUEZ_BILLING=cloud without BILLING_SERVICE_URL: every store is legacy", async () => {
    process.env.LOUEZ_BILLING = "cloud";
    delete process.env.BILLING_SERVICE_URL;
    const policy = await getEffectivePolicy("any_store", at);
    assert.equal(policy.source, "legacy");
    assert.equal(policy.legacyBillingApplies, true);
    assert.equal(policy.policy, null);
    assert.equal(policy.terms.invoicing, "louez_legacy");
    assert.equal(policy.acceptsReservations, true);
    assert.equal(await legacyBillingApplies("any_store", at), true);
  });
});
