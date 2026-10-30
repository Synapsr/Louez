import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import {
  createTestDatabase,
  raceOnOpenTransaction,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";

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
    const cutoff = (from: string) => louezDb.newStoresCutoff(louezDb.db, new Date(from));
    assert.equal((await cutoff("2027-01-25T00:00:00Z")).toISOString(), "2026-12-01T00:00:00.000Z");
    assert.equal((await cutoff("2026-11-01T00:00:00Z")).toISOString(), "2026-11-01T00:00:00.000Z");
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

  // Each test pulls its own store: the limiter keeps a store's pull for 10 seconds.
  const storeSet = (storeId: string, versions: unknown[]) => ({
    schema: "louez.billing.store-policies/1",
    storeId,
    generatedAt: new Date().toISOString(),
    history: false,
    policies: versions,
  });
  const storePolicy = (storeId: string, version: number) => ({
    ...STORE_POLICY,
    storeId,
    version,
  });
  const syncState = async () => {
    const [state] = await louezDb.db.select().from(louezDb.billingSyncState);
    return { etag: state?.policiesEtag, pulledAt: state?.lastPolicyPullAt?.getTime() };
  };

  test("a store pull caches the store's versions and leaves the set's ETag alone", async () => {
    const before = await syncState();
    service.handle("/stores/pull_store_a/policies", () => ({
      status: 200,
      body: storeSet("pull_store_a", [storePolicy("pull_store_a", 1)]),
    }));
    const result = await policies.pullStorePolicies("pull_store_a", capture());
    assert.deepEqual(result, {
      outcome: "updated",
      inserted: 1,
      known: 0,
      invalid: 0,
      conflicts: 0,
    });
    const request = service.requests.at(-1);
    assert.equal(request?.verified, true);
    assert.equal(request?.target, "/api/v1/louez/stores/pull_store_a/policies");
    assert.ok((await stored()).some((row) => row.storeId === "pull_store_a" && row.version === 1));
    assert.deepEqual(await syncState(), before);
  });

  test("pulls of one store within 10 seconds share one request", async () => {
    let calls = 0;
    service.handle("/stores/pull_store_b/policies", async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { status: 200, body: storeSet("pull_store_b", [storePolicy("pull_store_b", 1)]) };
    });
    const [first, second] = await Promise.all([
      policies.pullStorePolicies("pull_store_b", capture()),
      policies.pullStorePolicies("pull_store_b", capture()),
    ]);
    const third = await policies.pullStorePolicies("pull_store_b", capture());
    assert.equal(calls, 1);
    assert.equal(first.outcome, "updated");
    assert.deepEqual(second, first);
    assert.deepEqual(third, first);
  });

  test("an answer that holds another store is refused whole, with an alert", async () => {
    service.handle("/stores/pull_store_c/policies", () => ({
      status: 200,
      body: storeSet("pull_store_c", [storePolicy("pull_store_c", 1), DEFAULT_POLICY]),
    }));
    service.handle("/stores/pull_store_d/policies", () => ({
      status: 200,
      body: storeSet("pull_other", [storePolicy("pull_store_d", 1)]),
    }));
    for (const storeId of ["pull_store_c", "pull_store_d"]) {
      const { captured, alerts } = capture();
      const result = await policies.pullStorePolicies(storeId, { alerts });
      assert.equal(result.outcome, "failed");
      assert.equal(
        (await stored()).some((row) => row.storeId === storeId),
        false,
      );
      assert.ok(captured.errors.some((line) => line.startsWith("policies_store_mismatch:")));
    }
  });

  const queueRows = (storeId: string) =>
    louezDb.db
      .select({
        type: louezDb.billingSyncQueue.aggregateType,
        status: louezDb.billingSyncQueue.status,
        sentHash: louezDb.billingSyncQueue.sentHash,
      })
      .from(louezDb.billingSyncQueue)
      .where(eq(louezDb.billingSyncQueue.storeId, storeId));

  test("404 store_unknown plain-marks the store and caches nothing", async () => {
    // A store row synced once: a plain mark keeps its sent hash, a forced one clears it.
    const sentHash = "a".repeat(64);
    await louezDb.db.insert(louezDb.billingSyncQueue).values({
      aggregateType: "store",
      aggregateId: "pull_store_e",
      storeId: "pull_store_e",
      status: "synced",
      sentHash,
    });
    service.handle("/stores/pull_store_e/policies", () => ({
      status: 404,
      body: { code: "store_unknown" },
    }));
    const result = await policies.pullStorePolicies("pull_store_e", capture());
    assert.deepEqual(result, { outcome: "store_unknown" });
    assert.deepEqual(await queueRows("pull_store_e"), [
      { type: "store", status: "pending", sentHash },
    ]);
    assert.equal(
      (await stored()).some((row) => row.storeId === "pull_store_e"),
      false,
    );
  });

  test("an unsigned 404 store_unknown is a transport failure and marks nothing", async () => {
    service.handle("/stores/pull_store_j/policies", () => ({
      status: 404,
      body: { code: "store_unknown" },
      signed: false,
    }));
    const result = await policies.pullStorePolicies("pull_store_j", capture());
    assert.equal(result.outcome, "failed");
    assert.deepEqual(await queueRows("pull_store_j"), []);
  });

  test("a store pull that loses the insert race to another writer counts the version as known", async () => {
    const policy = storePolicy("pull_store_r", 1);
    service.handle("/stores/pull_store_r/policies", () => ({
      status: 200,
      body: storeSet("pull_store_r", [policy]),
    }));
    // Another writer, such as the heartbeat's pull, inserts the same version and has
    // not committed yet: the store pull's read misses the row, and its insert waits.
    const [result] = await raceOnOpenTransaction(
      database,
      async (holder) => {
        await holder.query(
          "INSERT INTO billing_policies (store_id, version, effective_from, body) VALUES (?, ?, ?, ?)",
          [policy.storeId, policy.version, new Date(policy.effectiveFrom), JSON.stringify(policy)],
        );
      },
      [() => policies.pullStorePolicies("pull_store_r", capture())],
    );
    assert.deepEqual(result, {
      outcome: "updated",
      inserted: 0,
      known: 1,
      invalid: 0,
      conflicts: 0,
    });
    assert.deepEqual(
      (await stored()).filter((row) => row.storeId === "pull_store_r").map((row) => row.body),
      [policy],
    );
  });

  test("a Retry-After the relay got holds store pulls too", async () => {
    service.handle("/stores/pull_store_k/policies", () => ({
      status: 200,
      body: storeSet("pull_store_k", [storePolicy("pull_store_k", 1)]),
    }));
    const setRetryAfter = (until: Date | null) =>
      louezDb.db
        .update(louezDb.billingSyncState)
        .set({ retryAfterUntil: until })
        .where(eq(louezDb.billingSyncState.id, 1));
    await setRetryAfter(new Date(Date.now() + 60_000));
    try {
      const sent = service.requests.length;
      const result = await policies.pullStorePolicies("pull_store_k", capture());
      assert.deepEqual(result, { outcome: "waiting", detail: "waiting for Retry-After" });
      assert.equal(service.requests.length, sent, "no request while the relay waits");
    } finally {
      await setRetryAfter(null);
    }
  });

  test("an unsigned answer is not cached", async () => {
    service.handle("/stores/pull_store_f/policies", () => ({
      status: 200,
      body: storeSet("pull_store_f", [storePolicy("pull_store_f", 1)]),
      signed: false,
    }));
    const { captured, alerts } = capture();
    const result = await policies.pullStorePolicies("pull_store_f", { alerts });
    assert.equal(result.outcome, "failed");
    assert.equal(
      (await stored()).some((row) => row.storeId === "pull_store_f"),
      false,
    );
    assert.ok(captured.errors.some((line) => line.startsWith("response_invalid:")));
  });

  test("the store pull gives up after 3 seconds and keeps the cache", async () => {
    service.handle("/stores/pull_store_g/policies", async () => {
      await new Promise((resolve) => setTimeout(resolve, 3500));
      return { status: 200, body: storeSet("pull_store_g", [storePolicy("pull_store_g", 1)]) };
    });
    const started = Date.now();
    const result = await policies.pullStorePolicies("pull_store_g", capture());
    const elapsed = Date.now() - started;
    assert.deepEqual(result, { outcome: "failed", detail: "timeout" });
    assert.ok(elapsed >= 2900 && elapsed < 3400, `gave up after ${elapsed} ms`);
    assert.equal(
      (await stored()).some((row) => row.storeId === "pull_store_g"),
      false,
    );
  });

  test("a * version whose newStoresCreatedFrom is not BILLING_NEW_STORES_FROM is cached, with an alert", async () => {
    // The fake service's BILLING_NEW_STORES_FROM, compared as an instant.
    const T = "2027-01-25T00:00:00Z";
    const atT = {
      ...DEFAULT_POLICY,
      version: 5,
      effectiveFrom: T,
      newStoresCreatedFrom: "2027-01-25T00:00:00.000Z",
    };
    const early = {
      ...DEFAULT_POLICY,
      version: 6,
      effectiveFrom: "2026-11-01T00:00:00Z",
      newStoresCreatedFrom: "2026-11-01T00:00:00Z",
    };
    const mismatches = (errors: readonly string[]) =>
      errors.filter((line) => line.startsWith("policies_cutoff_mismatch:"));

    reply = { status: 200, body: policySet("p-test-etag-cut1", [atT]) };
    const first = capture();
    assert.equal((await policies.pullPolicies({ alerts: first.alerts })).outcome, "updated");
    assert.deepEqual(mismatches(first.captured.errors), []);

    // Known versions are not checked again: only the new one alerts.
    reply = { status: 200, body: policySet("p-test-etag-cut2", [DEFAULT_POLICY, atT, early]) };
    const second = capture();
    const result = await policies.pullPolicies({ alerts: second.alerts });
    assert.deepEqual(result, {
      outcome: "updated",
      inserted: 1,
      known: 2,
      invalid: 0,
      conflicts: 0,
    });
    assert.deepEqual(mismatches(second.captured.errors), [
      `policies_cutoff_mismatch: 1 * version(s) cached with a newStoresCreatedFrom other than BILLING_NEW_STORES_FROM (2027-01-25T00:00:00.000Z): v6 at 2026-11-01T00:00:00Z. Louez counts every store created from the earlier instant as new (README §8.3).`,
    ]);
    // Cached all the same (README §8.1): the earlier instant is now the cutoff.
    assert.ok((await stored()).some((row) => row.storeId === "*" && row.version === 6));
    const cutoff = await louezDb.newStoresCutoff(louezDb.db, new Date(T));
    assert.equal(cutoff.toISOString(), "2026-11-01T00:00:00.000Z");
  });

  test("a store pull into an empty cache leaves the next set pull asking for history", async () => {
    // A fresh install: nothing cached, no set pulled yet.
    await louezDb.db.delete(louezDb.billingPolicies);
    await louezDb.db
      .update(louezDb.billingSyncState)
      .set({ policiesEtag: null })
      .where(eq(louezDb.billingSyncState.id, 1));
    service.handle("/stores/pull_store_boot/policies", () => ({
      status: 200,
      body: storeSet("pull_store_boot", [storePolicy("pull_store_boot", 1)]),
    }));
    const pulled = await policies.pullStorePolicies("pull_store_boot", capture());
    assert.equal(pulled.outcome, "updated");
    reply = { status: 200, body: policySet("p-test-etag-0004", [DEFAULT_POLICY]) };

    const result = await policies.pullPolicies(capture());

    assert.equal(result.outcome, "updated");
    const request = service.requests.at(-1);
    assert.equal(request?.target, "/api/v1/louez/policies?include=history");
    assert.equal(request?.headers["if-none-match"], undefined);
  });

  test("a version that moves a store into a balance notice emails its owner once (README §8.8)", async () => {
    const crossings: Array<{ storeId: string; version: number }> = [];
    const notifyBalanceLimit = async (found: readonly { storeId: string; version: number }[]) =>
      void crossings.push(...found);
    const labels = { offer: DEFAULT_POLICY.labels.offer, notice: { fr: "Solde", en: "Balance" } };
    const versions: unknown[] = [];
    const issue = (version: number, kind: string | null, closed = false) =>
      versions.push({
        ...storePolicy("pol_balance", version),
        reservations: closed
          ? { allowed: false, reason: "balance_limit_reached" }
          : { allowed: true },
        notice: kind ? { kind, blockAt: null } : null,
        labels: kind ? labels : { ...labels, notice: null },
      });
    let pulls = 0;
    const pull = async () => {
      pulls += 1;
      reply = { status: 200, body: policySet(`p-test-etag-bal-${pulls}`, [...versions]) };
      const result = await policies.pullPolicies({ ...capture(), notifyBalanceLimit });
      assert.equal(result.outcome, "updated");
      return crossings.map(({ version }) => version);
    };

    issue(1, null);
    assert.deepEqual(await pull(), []);
    issue(2, "balance_limit_near");
    assert.deepEqual(await pull(), [2]);
    // The same set again caches nothing, so nothing is sent again.
    assert.deepEqual(await pull(), [2]);
    // Near, then over the limit: the same crossing.
    issue(3, "balance_limit_reached", true);
    assert.deepEqual(await pull(), [2]);
    // Back under, then straight past the limit: a new crossing.
    issue(4, null);
    assert.deepEqual(await pull(), [2]);
    issue(5, "balance_limit_reached", true);
    assert.deepEqual(await pull(), [2, 5]);
    // Another notice is no crossing.
    issue(6, "card_expiring");
    assert.deepEqual(await pull(), [2, 5]);
  });

  test("an email that fails leaves the pull's result and cache as they are", async () => {
    service.handle("/stores/pull_store_bal/policies", () => ({
      status: 200,
      body: storeSet("pull_store_bal", [
        {
          ...storePolicy("pull_store_bal", 1),
          notice: { kind: "balance_limit_near", blockAt: null },
        },
      ]),
    }));
    const { captured, alerts } = capture();
    const result = await policies.pullStorePolicies("pull_store_bal", {
      alerts,
      notifyBalanceLimit: async () => {
        throw new Error("smtp down");
      },
    });
    assert.equal(result.outcome, "updated");
    assert.ok((await stored()).some((row) => row.storeId === "pull_store_bal"));
    // The emails run apart from the pull, which returned without waiting for them.
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(captured.errors.some((line) => line.includes("smtp down")));
  });

  // Last: the wait it sets holds every store pull of this process.
  test("a Retry-After on a store pull holds store pulls only, not the relay", async () => {
    service.handle("/stores/pull_store_h/policies", () => ({
      status: 429,
      body: { code: "rate_limited" },
      headers: { "Retry-After": "30" },
    }));
    const result = await policies.pullStorePolicies("pull_store_h", capture());
    assert.equal(result.outcome, "waiting");
    const [state] = await louezDb.db.select().from(louezDb.billingSyncState);
    assert.equal(state?.retryAfterUntil, null);
    const sent = service.requests.length;
    assert.equal((await policies.pullStorePolicies("pull_store_i", capture())).outcome, "waiting");
    assert.equal(service.requests.length, sent, "no request while the wait holds");
  });
});
