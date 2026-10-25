import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import {
  type FakeBillingService,
  type FakeReply,
  type FakeRequest,
  captureAlerts,
  startFakeBillingService,
  useFakeServiceEnv,
} from "./fake-billing-service.fixtures";

// Monthly manifests against a fake billing service (louez-billing docs/api, README §7.3).

const LEGACY_STORE = "mf_store_legacy";
const NEW_STORE = "mf_store_new";

const manifestsBody = z.object({
  manifests: z.array(
    z.object({
      storeId: z.string(),
      period: z.string(),
      generatedAt: z.string(),
      aggregates: z.array(
        z.object({ type: z.string(), aggregateId: z.string(), version: z.number() }),
      ),
    }),
  ),
});

describe("billing manifests (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let service: FakeBillingService;
  let restoreEnv: () => void;
  let louezDb: typeof import("@louez/db");
  let manifests: typeof import("./manifests");
  let reply: (request: FakeRequest) => FakeReply = () => ({ status: 500 });

  before(async () => {
    database = await createTestDatabase("billing_manifests");
    service = await startFakeBillingService();
    restoreEnv = useFakeServiceEnv(service);
    louezDb = await import("@louez/db");
    manifests = await import("./manifests");
    service.handle("/manifests", (request) => reply(request));

    const { db, stores, reservations, payments, paymentDisputes } = louezDb;
    // BILLING_NEW_STORES_FROM is 2027-01-25 in the fake's variables.
    await db.insert(stores).values([
      {
        id: LEGACY_STORE,
        userId: "user_1",
        name: "Legacy",
        slug: "mf-legacy",
        createdAt: new Date("2026-03-01T00:00:00Z"),
      },
      {
        id: NEW_STORE,
        userId: "user_2",
        name: "New",
        slug: "mf-new",
        createdAt: new Date("2027-02-01T00:00:00Z"),
      },
    ]);
    const reservation = (
      id: string,
      storeId: string,
      dates: { endDate: string; billableAt?: string; withdrawnAt?: string },
    ) => ({
      id,
      storeId,
      customerId: "customer",
      number: id,
      status: "completed" as const,
      startDate: new Date("2026-08-01T08:00:00Z"),
      endDate: new Date(dates.endDate),
      subtotalAmount: "10.00",
      depositAmount: "0.00",
      totalAmount: "10.00",
      billableAt: dates.billableAt ? new Date(dates.billableAt) : null,
      withdrawnAt: dates.withdrawnAt ? new Date(dates.withdrawnAt) : null,
    });
    // Fixtures written directly; the helpers would set billableAt themselves.
    await db.insert(reservations).values([
      // Ends in September.
      reservation("mf_res_end", LEGACY_STORE, { endDate: "2026-09-30T23:30:00Z" }),
      // Became billable in September.
      reservation("mf_res_billable", LEGACY_STORE, {
        endDate: "2026-11-02T08:00:00Z",
        billableAt: "2026-09-03T10:00:00Z",
      }),
      // Paid in September only.
      reservation("mf_res_paid", LEGACY_STORE, { endDate: "2026-12-02T08:00:00Z" }),
      // Disputed in September only.
      reservation("mf_res_disputed", LEGACY_STORE, { endDate: "2026-12-03T08:00:00Z" }),
      // Nothing in September: ends on October 1 at 00:00 UTC.
      reservation("mf_res_outside", LEGACY_STORE, { endDate: "2026-10-01T00:00:00Z" }),
      reservation("mf_res_other_store", NEW_STORE, { endDate: "2026-09-15T08:00:00Z" }),
    ]);
    await db.insert(payments).values({
      id: "mf_pay_1",
      reservationId: "mf_res_paid",
      amount: "10.00",
      type: "rental",
      method: "cash",
      status: "completed",
      paidAt: new Date("2026-09-20T12:00:00Z"),
    });
    await db.insert(paymentDisputes).values({
      id: "dp_test_1",
      paymentId: "mf_pay_x",
      reservationId: "mf_res_disputed",
      amountMinor: 1000,
      currency: "EUR",
      status: "open",
      stripeStatus: "needs_response",
      openedAt: new Date("2026-09-25T12:00:00Z"),
    });
    // Delivered versions: the store and one reservation.
    await louezDb.markStore(db, LEGACY_STORE);
    await louezDb.markReservation(db, { id: "mf_res_end", storeId: LEGACY_STORE });
    await db.execute(
      sql`UPDATE billing_sync_queue SET status = 'synced', version = version + 3,
             delivered_version = version WHERE store_id = ${LEGACY_STORE}`,
    );
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await service?.close();
    restoreEnv?.();
    await database?.drop();
  });

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

  const manifestRow = async (storeId: string, period: string) => {
    const [rows] = await louezDb.db.execute(
      sql`SELECT status, last_error AS lastError FROM billing_sync_manifests
          WHERE store_id = ${storeId} AND period = ${period}`,
    );
    return z
      .array(z.object({ status: z.string().nullable(), lastError: z.string().nullable() }))
      .parse(rows)[0];
  };

  test("lists the store, the reservations of the period and the legacy aggregates, then resyncs a mismatch", async () => {
    reply = (request) => {
      const { manifests: sent } = manifestsBody.parse(request.json());
      return {
        status: 200,
        body: {
          results: sent.map((manifest) => ({
            storeId: manifest.storeId,
            period: manifest.period,
            status: "mismatched",
            resync: [
              { type: "reservation", aggregateId: "mf_res_billable", requestId: "rs_mf_000001" },
            ],
            error: null,
          })),
        },
      };
    };
    await manifests.requestManifests([{ storeId: LEGACY_STORE, period: "2026-09" }]);
    const { alerts } = capture();
    const result = await manifests.sendPendingManifests({ alerts });

    assert.equal(result.outcome, "ok");
    assert.equal(result.mismatched, 1);
    const request = service.requests.at(-1);
    assert.equal(request?.verified, true);
    const [manifest] = request ? manifestsBody.parse(request.json()).manifests : [];
    assert.equal(manifest?.storeId, LEGACY_STORE);
    assert.equal(manifest?.period, "2026-09");
    assert.match(manifest?.generatedAt ?? "", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.deepEqual(manifest?.aggregates, [
      { type: "store", aggregateId: LEGACY_STORE, version: 4 },
      { type: "reservation", aggregateId: "mf_res_billable", version: 0 },
      { type: "reservation", aggregateId: "mf_res_disputed", version: 0 },
      { type: "reservation", aggregateId: "mf_res_end", version: 4 },
      { type: "reservation", aggregateId: "mf_res_paid", version: 0 },
      { type: "legacy_store", aggregateId: LEGACY_STORE, version: 0 },
      { type: "legacy_month", aggregateId: `${LEGACY_STORE}:2026-09`, version: 0 },
    ]);

    // The mismatch force-marked the entry at once and recorded its request id.
    const [queued] = await louezDb.db.execute(
      sql`SELECT status, sent_hash AS sentHash FROM billing_sync_queue
          WHERE aggregate_type = 'reservation' AND aggregate_id = 'mf_res_billable'`,
    );
    assert.deepEqual(
      z.array(z.object({ status: z.string(), sentHash: z.string().nullable() })).parse(queued),
      [{ status: "pending", sentHash: null }],
    );
    const handled = await louezDb.db.select().from(louezDb.billingSyncHandledRequests);
    assert.deepEqual(
      handled.map((row) => row.requestId),
      ["rs_mf_000001"],
    );
    assert.deepEqual(await manifestRow(LEGACY_STORE, "2026-09"), {
      status: "mismatched",
      lastError: null,
    });

    // Nothing pending: no call.
    const calls = service.requests.length;
    assert.equal((await manifests.sendPendingManifests({ alerts })).sent, 0);
    assert.equal(service.requests.length, calls);
  });

  test("on the 1st after 06:00 UTC, one manifest a day per store of the month that ended", async () => {
    const answers: string[] = [];
    reply = (request) => {
      const { manifests: sent } = manifestsBody.parse(request.json());
      return {
        status: 200,
        body: {
          results: sent.map((manifest) => {
            answers.push(`${manifest.storeId}:${manifest.period}`);
            // A new store has no legacy aggregates.
            if (manifest.storeId === NEW_STORE) {
              assert.deepEqual(
                manifest.aggregates.map((aggregate) => aggregate.type),
                ["store"],
              );
            }
            return manifest.storeId === NEW_STORE
              ? {
                  storeId: manifest.storeId,
                  period: manifest.period,
                  status: "rejected",
                  resync: [],
                  error: { code: "processing_failed", message: "the service failed" },
                }
              : {
                  storeId: manifest.storeId,
                  period: manifest.period,
                  status: "matched",
                  resync: [],
                  error: null,
                };
          }),
        },
      };
    };

    // The new store was created after March ended, so it gets no manifest for March.
    assert.equal(await manifests.scheduleMonthlyManifests(new Date("2027-04-01T05:59:00Z")), 0);
    await manifests.scheduleMonthlyManifests(new Date("2027-04-01T06:30:00Z"));
    const { alerts } = capture();
    await manifests.sendPendingManifests({ alerts });
    assert.deepEqual(answers.sort(), [`${LEGACY_STORE}:2027-03`, `${NEW_STORE}:2027-03`]);
    assert.deepEqual(await manifestRow(LEGACY_STORE, "2027-03"), {
      status: "matched",
      lastError: null,
    });
    // processing_failed is retried on the next run.
    assert.deepEqual(await manifestRow(NEW_STORE, "2027-03"), {
      status: "pending",
      lastError: "processing_failed",
    });

    // Later the same day, the matched manifest is not requested again.
    answers.length = 0;
    await manifests.scheduleMonthlyManifests(new Date("2027-04-01T09:00:00Z"));
    await manifests.sendPendingManifests({ alerts });
    assert.deepEqual(answers, [`${NEW_STORE}:2027-03`]);

    // On the 2nd it is posted once more.
    answers.length = 0;
    await manifests.scheduleMonthlyManifests(new Date("2027-04-02T06:01:00Z"));
    await manifests.sendPendingManifests({ alerts });
    assert.deepEqual(answers.sort(), [`${LEGACY_STORE}:2027-03`, `${NEW_STORE}:2027-03`]);
    assert.equal(await manifests.scheduleMonthlyManifests(new Date("2027-04-03T06:01:00Z")), 0);
  });

  test("a transport failure leaves the manifest pending; any other rejection alerts", async () => {
    await manifests.requestManifests([{ storeId: LEGACY_STORE, period: "2026-08" }]);
    reply = () => ({ status: 502, body: "bad gateway", signed: false });
    const { captured, alerts } = capture();
    assert.equal((await manifests.sendPendingManifests({ alerts })).outcome, "failed");
    assert.equal((await manifestRow(LEGACY_STORE, "2026-08"))?.status, "pending");

    reply = (request) => {
      const { manifests: sent } = manifestsBody.parse(request.json());
      return {
        status: 200,
        body: {
          results: sent.map((manifest) => ({
            storeId: manifest.storeId,
            period: manifest.period,
            status: "rejected",
            resync: [],
            error: { code: "store_closed", message: "the store has a final snapshot" },
          })),
        },
      };
    };
    await manifests.sendPendingManifests({ alerts });
    assert.deepEqual(await manifestRow(LEGACY_STORE, "2026-08"), {
      status: "rejected",
      lastError: "store_closed: the store has a final snapshot",
    });
    assert.ok(captured.errors.some((line) => line.startsWith("manifest_rejected:")));
  });
});
