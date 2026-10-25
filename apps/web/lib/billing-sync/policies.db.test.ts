import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import {
  type FakeBillingService,
  type FakeReply,
  captureAlerts,
  startFakeBillingService,
  useFakeServiceEnv,
} from "./fake-billing-service.fixtures";

// The policy cache against a fake billing service (louez-billing docs/api, README §8.1
// and §8.2). The policies use the public test values of fees.md (Q33): 123 and 250
// bps, a 150 marketplace fee, a 90 per-reservation fee.

const DEFAULT_POLICY = {
  schema: "louez.billing.policy/1",
  storeId: "*",
  version: 1,
  effectiveFrom: "2026-12-01T00:00:00Z",
  issuedAt: "2026-11-20T10:00:00Z",
  newStoresCreatedFrom: "2026-12-01T00:00:00Z",
  offerKey: "test-commission",
  invoicing: "service",
  currency: "EUR",
  applicationFee: {
    kind: "percent",
    rateBps: 123,
    minMinor: 10,
    maxMinor: 5000,
    excludeInsurance: false,
    appliesTo: ["rental", "custom_request"],
  },
  marketplaceFeeMinor: 150,
  reservations: { allowed: false, reason: "payment_method_required" },
  notice: { kind: "payment_method_missing", blockAt: null },
  stripeCustomerId: null,
  labels: {
    offer: { fr: "Commission de test", en: "Test commission" },
    notice: { fr: "Ajoutez une carte.", en: "Add a card." },
  },
};

const STORE_POLICY = {
  ...DEFAULT_POLICY,
  storeId: "pol_store_1",
  newStoresCreatedFrom: null,
  applicationFee: { ...DEFAULT_POLICY.applicationFee, rateBps: 250 },
  reservations: { allowed: true },
  notice: null,
  stripeCustomerId: "cus_TestExample0001",
  labels: { offer: DEFAULT_POLICY.labels.offer, notice: null },
  // A field from a later 1.x version: ignored, kept in the stored body.
  futureField: "kept",
};

const policySet = (etag: string, policies: unknown[]) => ({
  schema: "louez.billing.policy-set/1",
  etag,
  generatedAt: new Date().toISOString(),
  history: false,
  policies,
});

describe("billing policy pull (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let service: FakeBillingService;
  let restoreEnv: () => void;
  let louezDb: typeof import("@louez/db");
  let policies: typeof import("./policies");
  let reply: FakeReply = { status: 500 };

  before(async () => {
    database = await createTestDatabase("billing_policies");
    service = await startFakeBillingService();
    restoreEnv = useFakeServiceEnv(service);
    louezDb = await import("@louez/db");
    policies = await import("./policies");
    service.handle("/policies", () => reply);
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await service?.close();
    restoreEnv?.();
    await database?.drop();
  });

  const stored = async () =>
    (
      await louezDb.db
        .select({
          storeId: louezDb.billingPolicies.storeId,
          version: louezDb.billingPolicies.version,
          body: louezDb.billingPolicies.body,
        })
        .from(louezDb.billingPolicies)
    ).sort((a, b) => `${a.storeId}${a.version}`.localeCompare(`${b.storeId}${b.version}`));

  const capture = () => {
    const captured = captureAlerts();
    return {
      captured,
      alerts: {
        log: captured.log,
        alert: async (kind: string, message: string) =>
          void captured.errors.push(`${kind}: ${message}`),
      },
    };
  };

  test("an empty cache pulls history; valid versions are stored, an invalid one is refused", async () => {
    const invalid = {
      ...STORE_POLICY,
      version: 2,
      applicationFee: { ...STORE_POLICY.applicationFee, minMinor: 500, maxMinor: 100 },
    };
    const unknownEnum = { ...STORE_POLICY, version: 3, invoicing: "partner" };
    reply = {
      status: 200,
      body: policySet("p-test-etag-0001", [DEFAULT_POLICY, STORE_POLICY, invalid, unknownEnum]),
    };
    const { captured, alerts } = capture();

    const result = await policies.pullPolicies({ alerts });

    assert.deepEqual(result, {
      outcome: "updated",
      inserted: 2,
      known: 0,
      invalid: 2,
      conflicts: 0,
    });
    const request = service.requests.at(-1);
    assert.equal(request?.verified, true);
    assert.equal(request?.target, "/api/v1/louez/policies?include=history");
    assert.equal(request?.headers["if-none-match"], undefined);
    const rows = await stored();
    assert.deepEqual(
      rows.map((row) => [row.storeId, row.version]),
      [
        ["*", 1],
        ["pol_store_1", 1],
      ],
    );
    // Stored as received, unknown fields included.
    assert.deepEqual(rows[1]?.body, STORE_POLICY);
    assert.ok(
      captured.errors.some((line) => line.startsWith("policies_invalid: 2 policy version(s)")),
    );
    const [state] = await louezDb.db.select().from(louezDb.billingSyncState);
    assert.equal(state?.policiesEtag, "p-test-etag-0001");
    assert.ok(state?.lastPolicyPullAt);

    // The cutoff for new stores is the earliest `*` newStoresCreatedFrom when earlier.
    assert.equal(
      (await policies.newStoresCutoff(new Date("2027-01-25T00:00:00Z"))).toISOString(),
      "2026-12-01T00:00:00.000Z",
    );
    assert.equal(
      (await policies.newStoresCutoff(new Date("2026-11-01T00:00:00Z"))).toISOString(),
      "2026-11-01T00:00:00.000Z",
    );
  });

  test("with rows cached, the pull sends the signed ETag and a signed 304 only records the time", async () => {
    reply = { status: 304 };
    const [before] = await louezDb.db.select().from(louezDb.billingSyncState);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const result = await policies.pullPolicies(capture());
    assert.deepEqual(result, { outcome: "not_modified" });
    const request = service.requests.at(-1);
    assert.equal(request?.verified, true, "If-None-Match is part of the signature");
    assert.equal(request?.target, "/api/v1/louez/policies");
    assert.equal(request?.headers["if-none-match"], '"p-test-etag-0001"');
    const [after] = await louezDb.db.select().from(louezDb.billingSyncState);
    assert.ok(
      (after?.lastPolicyPullAt?.getTime() ?? 0) > (before?.lastPolicyPullAt?.getTime() ?? 0),
    );
  });

  test("a known version with other content keeps the stored row and alerts", async () => {
    const changed = { ...STORE_POLICY, marketplaceFeeMinor: 0 };
    const next = { ...STORE_POLICY, version: 4, effectiveFrom: "2027-02-01T00:00:00Z" };
    reply = { status: 200, body: policySet("p-test-etag-0002", [DEFAULT_POLICY, changed, next]) };
    const { captured, alerts } = capture();
    const result = await policies.pullPolicies({ alerts });
    assert.deepEqual(result, {
      outcome: "updated",
      inserted: 1,
      known: 2,
      invalid: 0,
      conflicts: 1,
    });
    const rows = await stored();
    assert.deepEqual(
      rows.find((row) => row.storeId === "pol_store_1" && row.version === 1)?.body,
      STORE_POLICY,
    );
    assert.ok(rows.some((row) => row.storeId === "pol_store_1" && row.version === 4));
    assert.ok(captured.errors.some((line) => line.startsWith("policies_conflict:")));
  });

  test("an unsigned 200 is not cached", async () => {
    reply = {
      status: 200,
      body: policySet("p-test-etag-0003", [{ ...STORE_POLICY, version: 9 }]),
      signed: false,
    };
    const { captured, alerts } = capture();
    const result = await policies.pullPolicies({ alerts });
    assert.equal(result.outcome, "failed");
    assert.equal(
      (await stored()).some((row) => row.version === 9),
      false,
    );
    const [state] = await louezDb.db.select().from(louezDb.billingSyncState);
    assert.equal(state?.policiesEtag, "p-test-etag-0002");
    assert.ok(captured.errors.some((line) => line.startsWith("response_invalid:")));
  });
});
