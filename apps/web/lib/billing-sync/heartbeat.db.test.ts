import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import {
  type FakeBillingService,
  captureAlerts,
  startFakeBillingService,
  useFakeServiceEnv,
} from "./fake-billing-service.fixtures";

// The heartbeat against a fake billing service (louez-billing docs/api, README §7.1
// and §7.2): what Louez reports, and what it does with the resync entries it gets.

const STORE = "hb_store_1";
const OTHER_STORE = "hb_store_2";

const heartbeatBody = z.object({
  at: z.string(),
  louezVersion: z.string(),
  queue: z.object({
    pending: z.number(),
    oldestPendingMarkedAt: z.string().nullable(),
    dead: z.number(),
    deadByStore: z.array(z.object({ storeId: z.string(), dead: z.number() })),
    stalePendingByStore: z.array(
      z.object({ storeId: z.string(), pending: z.number(), oldestMarkedAt: z.string() }),
    ),
    truncated: z.boolean(),
  }),
  invariants: z.object({
    billableWithoutBillableAt: z.number(),
    completedPaymentsWithoutGross: z.number().nullable(),
    byStore: z.array(
      z.object({
        storeId: z.string(),
        billableWithoutBillableAt: z.number(),
        completedPaymentsWithoutGross: z.number().nullable(),
      }),
    ),
  }),
  policies: z.object({ etag: z.string().nullable(), lastPullAt: z.string().nullable() }),
  lastSweepAt: z.string().nullable(),
  handledRequestIds: z.array(z.string()),
});

/** A store policy with the public test values of fees.md (Q33), never launch values. */
const storePolicy = {
  schema: "louez.billing.policy/1",
  storeId: STORE,
  version: 1,
  effectiveFrom: "2026-10-01T00:00:00Z",
  issuedAt: "2026-09-30T12:00:00Z",
  newStoresCreatedFrom: null,
  offerKey: "test-offer",
  invoicing: "louez_legacy",
  currency: "EUR",
  applicationFee: { kind: "per_reservation", amountMinor: 90 },
  marketplaceFeeMinor: 150,
  reservations: { allowed: true },
  notice: null,
  stripeCustomerId: null,
  labels: { offer: { fr: "Offre de test", en: "Test offer" }, notice: null },
};

describe("billing heartbeat (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let service: FakeBillingService;
  let restoreEnv: () => void;
  let louezDb: typeof import("@louez/db");
  let heartbeat: typeof import("./heartbeat");
  let response: Record<string, unknown> = {};

  before(async () => {
    database = await createTestDatabase("billing_heartbeat");
    service = await startFakeBillingService();
    restoreEnv = useFakeServiceEnv(service);
    louezDb = await import("@louez/db");
    heartbeat = await import("./heartbeat");
    service.handle("/heartbeat", () => ({ status: 200, body: response }));
    service.handle("/policies", () => ({
      status: 200,
      body: {
        schema: "louez.billing.policy-set/1",
        etag: "p-test-etag-0001",
        generatedAt: new Date().toISOString(),
        history: true,
        policies: [storePolicy],
      },
    }));

    const { db, stores, reservations, payments } = louezDb;
    await db.insert(stores).values([
      { id: STORE, userId: "user_1", name: "Store one", slug: "hb-store-one" },
      { id: OTHER_STORE, userId: "user_2", name: "Store two", slug: "hb-store-two" },
    ]);
    const reservation = (id: string, storeId: string, billableAt: Date | null) => ({
      id,
      storeId,
      customerId: "customer",
      number: id,
      status: "confirmed" as const,
      startDate: new Date("2026-10-10T08:00:00Z"),
      endDate: new Date("2026-10-12T08:00:00Z"),
      subtotalAmount: "10.00",
      depositAmount: "0.00",
      totalAmount: "10.00",
      billableAt,
    });
    // Test fixtures written directly; the helpers would set billableAt.
    await db
      .insert(reservations)
      .values([
        reservation("hb_res_1", STORE, new Date("2026-10-01T08:00:00Z")),
        reservation("hb_res_2", STORE, new Date("2026-10-01T08:00:00Z")),
        reservation("hb_res_3", OTHER_STORE, null),
      ]);
    await db.insert(payments).values([
      {
        id: "hb_pay_1",
        reservationId: "hb_res_3",
        amount: "10.00",
        type: "rental",
        method: "cash",
        status: "completed",
      },
      {
        id: "hb_pay_2",
        reservationId: "hb_res_1",
        amount: "10.00",
        type: "rental",
        method: "cash",
        status: "completed",
        grossMinor: 1000,
      },
    ]);
    await db.insert(louezDb.platformFees).values({
      id: "hb_fee_1",
      storeId: STORE,
      reservationId: "hb_res_1",
      dedupKey: "res:hb_res_1",
      amountCents: 90,
      source: "manual",
      status: "pending",
      billingMonth: "2026-09",
    });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await service?.close();
    restoreEnv?.();
    await database?.drop();
  });

  const rowSchema = z.object({
    type: z.string(),
    id: z.string(),
    version: z.coerce.number(),
    status: z.string(),
    sentHash: z.string().nullable(),
  });
  async function queue() {
    const [rows] = await louezDb.db.execute(
      sql`SELECT aggregate_type AS type, aggregate_id AS id, version, status, sent_hash AS sentHash
          FROM billing_sync_queue ORDER BY CAST(aggregate_type AS CHAR), aggregate_id`,
    );
    return z.array(rowSchema).parse(rows);
  }

  const lastHeartbeat = () => {
    const requests = service.requests.filter(
      (request) => request.target === "/api/v1/louez/heartbeat",
    );
    const last = requests[requests.length - 1];
    return last ? heartbeatBody.parse(last.json()) : null;
  };

  test("reports the queue and invariants, pulls policies, and force-marks each resync once", async () => {
    // A synced row with a sent hash: the resync must clear it.
    await louezDb.markReservation(louezDb.db, { id: "hb_res_1", storeId: STORE });
    await louezDb.db.execute(
      sql`UPDATE billing_sync_queue SET status = 'synced', sent_hash = 'old', delivered_version = 1`,
    );
    await louezDb.markReservation(louezDb.db, { id: "hb_res_3", storeId: OTHER_STORE });
    await louezDb.db.execute(
      sql`UPDATE billing_sync_queue SET status = 'dead' WHERE aggregate_id = 'hb_res_3'`,
    );
    response = {
      serverTime: new Date().toISOString(),
      policiesEtag: "p-test-etag-0001",
      resync: [
        { type: "reservation", aggregateId: "hb_res_1", requestId: "rs_test_0001" },
        { type: "reservation", aggregateId: "hb_res_gone", requestId: "rs_test_0002" },
      ],
      resyncStores: [{ storeId: STORE, requestId: "rs_test_0003" }],
      manifestsWanted: [],
    };
    const captured = captureAlerts();
    const alerts = {
      log: captured.log,
      alert: async (kind: string, message: string) =>
        void captured.errors.push(`${kind}: ${message}`),
    };

    const first = await heartbeat.runHeartbeat({ alerts });
    assert.equal(first.outcome, "ok");
    assert.ok(
      service.requests.every((request) => request.verified),
      "every request was signed",
    );

    const sent = lastHeartbeat();
    assert.equal(sent?.queue.pending, 0);
    assert.equal(sent?.queue.dead, 1);
    assert.deepEqual(sent?.queue.deadByStore, [{ storeId: OTHER_STORE, dead: 1 }]);
    assert.equal(sent?.queue.truncated, false);
    assert.deepEqual(sent?.invariants, {
      billableWithoutBillableAt: 1,
      completedPaymentsWithoutGross: 1,
      byStore: [
        { storeId: OTHER_STORE, billableWithoutBillableAt: 1, completedPaymentsWithoutGross: 1 },
      ],
    });
    assert.deepEqual(sent?.policies, { etag: null, lastPullAt: null });
    assert.deepEqual(sent?.handledRequestIds, []);

    // The empty cache was filled with history.
    const pull = service.requests.find((request) =>
      request.target.startsWith("/api/v1/louez/policies"),
    );
    assert.equal(pull?.target, "/api/v1/louez/policies?include=history");
    assert.equal(pull?.headers["if-none-match"], undefined);
    const policies = await louezDb.db.select().from(louezDb.billingPolicies);
    assert.deepEqual(
      policies.map((policy) => [policy.storeId, policy.version]),
      [[STORE, 1]],
    );

    // Resyncs are forced marks: pending, no sent hash. The store resync covers the
    // store, its reservations and its legacy aggregates.
    assert.deepEqual(await queue(), [
      {
        type: "legacy_month",
        id: `${STORE}:2026-09`,
        version: 1,
        status: "pending",
        sentHash: null,
      },
      { type: "legacy_store", id: STORE, version: 1, status: "pending", sentHash: null },
      { type: "reservation", id: "hb_res_1", version: 3, status: "pending", sentHash: null },
      { type: "reservation", id: "hb_res_2", version: 1, status: "pending", sentHash: null },
      { type: "reservation", id: "hb_res_3", version: 1, status: "dead", sentHash: null },
      { type: "store", id: STORE, version: 1, status: "pending", sentHash: null },
    ]);
    assert.ok(captured.errors.some((line) => line.includes("hb_res_gone no longer exists")));

    // The service repeats the entries until they are listed as handled: no new mark.
    const second = await heartbeat.runHeartbeat({ alerts });
    assert.equal(second.outcome, "ok");
    assert.deepEqual(lastHeartbeat()?.handledRequestIds, [
      "rs_test_0001",
      "rs_test_0002",
      "rs_test_0003",
    ]);
    assert.equal(lastHeartbeat()?.policies.etag, "p-test-etag-0001");
    assert.equal((await queue()).find((row) => row.id === "hb_res_1")?.version, 3);
    assert.equal(lastHeartbeat()?.queue.pending, 5);
    // Same ETag and a fresh pull: no second policy call.
    assert.equal(
      service.requests.filter((request) => request.target.startsWith("/api/v1/louez/policies"))
        .length,
      1,
    );
  });

  test("an unsigned answer changes nothing", async () => {
    service.handle("/heartbeat", () => ({
      status: 200,
      body: {
        ...response,
        resync: [{ type: "store", aggregateId: OTHER_STORE, requestId: "rs_test_0009" }],
      },
      signed: false,
    }));
    const captured = captureAlerts();
    const result = await heartbeat.runHeartbeat({
      alerts: {
        log: captured.log,
        alert: async (kind: string, message: string) =>
          void captured.errors.push(`${kind}: ${message}`),
      },
    });
    assert.equal(result.outcome, "failed");
    assert.equal(
      (await queue()).some((row) => row.type === "store" && row.id === OTHER_STORE),
      false,
    );
    assert.ok(captured.errors.some((line) => line.startsWith("response_invalid:")));
  });
});
