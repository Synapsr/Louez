import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// Final snapshots at account deletion (louez-billing docs/api, README §5.5), with the
// real builders on a migrated database: which reservations get one, what the stored
// bodies hold, what stops the deletion or is raised, and that nothing is written
// without the billing service.

process.env.LOUEZ_BILLING = "cloud";
process.env.BILLING_SERVICE_URL = "http://localhost:3100";

const STORE = "store_final_1";
const OTHER = "store_final_other";
const OWNER = "user_final_owner";

// The purge's clock is fixed, so the window does not depend on today's date: it opens
// on 2026-09-01, the first day of the month before OBSERVED_AT's.
const OBSERVED_AT = new Date("2026-10-15T12:00:00.000Z");
const at = (iso: string) => new Date(iso);
/** Just inside the window. */
const WINDOW_OPENS = at("2026-09-01T00:30:00Z");
/** The last day before the window. */
const BEFORE_WINDOW = at("2026-08-31T23:30:00Z");
const LONG_AGO = at("2025-01-10T09:00:00Z");
const LONG_AGO_END = at("2025-01-12T09:00:00Z");

const queueRow = z.object({
  type: z.string(),
  id: z.string(),
  storeId: z.string(),
  version: z.coerce.number(),
  status: z.string(),
  sentHash: z.string().nullable(),
  finalPayload: z.unknown(),
});

const payloadSchema = z.object({
  observedAt: z.string(),
  data: z.record(z.string(), z.unknown()),
});

describe("final snapshots (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let finals: typeof import("./final-snapshots");

  const reservation = (
    id: string,
    values: Partial<typeof import("@louez/db").reservations.$inferInsert>,
  ) => ({
    id,
    storeId: STORE,
    customerId: "customer_final",
    number: id.toUpperCase(),
    status: "pending" as const,
    startDate: LONG_AGO,
    endDate: LONG_AGO_END,
    subtotalAmount: "10.00",
    depositAmount: "0.00",
    totalAmount: "10.00",
    createdAt: LONG_AGO,
    ...values,
  });

  async function rows() {
    const [result] = await louezDb.db.execute(
      sql`SELECT aggregate_type AS type, aggregate_id AS id, store_id AS storeId, version,
                 status, sent_hash AS sentHash, final_payload AS finalPayload
          FROM billing_sync_queue ORDER BY aggregate_type, aggregate_id`,
    );
    return z.array(queueRow).parse(result);
  }

  before(async () => {
    database = await createTestDatabase("final_snapshots");
    louezDb = await import("@louez/db");
    finals = await import("./final-snapshots");
    const db = louezDb.db;

    await db.insert(louezDb.stores).values([
      {
        id: STORE,
        userId: OWNER,
        name: "Final store",
        slug: "final-store",
        settings: {
          reservationMode: "payment",
          advanceNoticeMinutes: 0,
          currency: "eur",
          country: "fr",
          timezone: "Europe/Paris",
        },
        createdAt: new Date("2024-06-01T08:00:00Z"),
      },
      { id: OTHER, userId: "user_other", name: "Other", slug: "final-other" },
    ]);
    await db.insert(louezDb.storeMembers).values({ storeId: STORE, userId: OWNER, role: "owner" });
    await db.insert(louezDb.reservations).values([
      // In the billable set, however old.
      reservation("r_billable", {
        status: "completed",
        billableAt: LONG_AGO,
      }),
      // Withdrawn long ago, nothing since: the service has nothing left to bill.
      reservation("r_old_cancelled", {
        status: "cancelled",
        billableAt: LONG_AGO,
        withdrawnAt: LONG_AGO,
      }),
      // An old request with a recent payment.
      reservation("r_recent_payment", {}),
      // Ends this month.
      reservation("r_recent_end", {
        status: "rejected",
        startDate: at("2026-10-13T09:00:00Z"),
        endDate: at("2026-10-18T09:00:00Z"),
      }),
      // Old, but its queue row is still pending.
      reservation("r_pending_row", { status: "declined" }),
      // Each has one fact on the first day of the previous month, and nothing since.
      reservation("r_withdrawn_prev", {
        status: "cancelled",
        billableAt: LONG_AGO,
        withdrawnAt: WINDOW_OPENS,
      }),
      reservation("r_billable_prev", { status: "cancelled", billableAt: WINDOW_OPENS }),
      reservation("r_dispute_prev", {
        status: "cancelled",
        billableAt: LONG_AGO,
        withdrawnAt: LONG_AGO,
      }),
      // Every fact on the day before the window: the service has billed it already.
      reservation("r_before_window", {
        status: "cancelled",
        startDate: at("2026-08-29T09:00:00Z"),
        endDate: BEFORE_WINDOW,
        billableAt: BEFORE_WINDOW,
        withdrawnAt: BEFORE_WINDOW,
      }),
      // Another store's reservation is never touched.
      { ...reservation("r_other_store", { status: "completed" }), storeId: OTHER },
    ]);
    const payment = (id: string, reservationId: string, date: Date) => ({
      id,
      reservationId,
      amount: "10.00",
      type: "rental" as const,
      method: "cash" as const,
      status: "completed" as const,
      paidAt: date,
      createdAt: date,
      updatedAt: date,
    });
    await db
      .insert(louezDb.payments)
      .values([
        payment("p_recent", "r_recent_payment", at("2026-10-14T09:00:00Z")),
        payment("p_disputed", "r_dispute_prev", LONG_AGO),
        payment("p_before", "r_before_window", BEFORE_WINDOW),
      ]);
    const dispute = (id: string, paymentId: string, reservationId: string, date: Date) => ({
      id,
      paymentId,
      reservationId,
      amountMinor: 1000,
      currency: "eur",
      status: "open" as const,
      stripeStatus: "needs_response",
      openedAt: date,
      createdAt: date,
      updatedAt: date,
    });
    await db
      .insert(louezDb.paymentDisputes)
      .values([
        dispute("dp_prev", "p_disputed", "r_dispute_prev", WINDOW_OPENS),
        dispute("dp_before", "p_before", "r_before_window", BEFORE_WINDOW),
      ]);
    await louezDb.markReservation(db, { id: "r_pending_row", storeId: STORE });
  });

  const writeFinals = (options: import("./final-snapshots").FinalSnapshotOptions = {}) =>
    louezDb.db.transaction((tx) =>
      finals.writeFinalSnapshots(tx, [STORE], { observedAt: OBSERVED_AT, ...options }),
    );

  afterEach(() => {
    process.env.LOUEZ_BILLING = "cloud";
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  test("without the billing service nothing is written", async () => {
    process.env.LOUEZ_BILLING = "off";
    const result = await writeFinals();
    assert.deepEqual(result, { stores: 0, reservations: 0, problems: [] });
    assert.deepEqual(
      (await rows()).map((row) => `${row.type}:${row.id}`),
      ["reservation:r_pending_row"],
    );
  });

  test("a build failure that may heal stops the deletion, with nothing written", async () => {
    const before = await rows();
    await assert.rejects(
      writeFinals({
        buildReservation: async () => {
          throw new Error("Connection lost: The server closed the connection.");
        },
      }),
      /Connection lost/,
    );
    assert.deepEqual(await rows(), before);
  });

  test("writes a closing body for each reservation the service may bill, then the store's", async () => {
    const result = await writeFinals();
    assert.deepEqual(result, { stores: 1, reservations: 7, problems: [] });

    const queue = await rows();
    assert.deepEqual(
      queue.map((row) => `${row.type}:${row.id}`),
      [
        `store:${STORE}`,
        "reservation:r_billable",
        "reservation:r_billable_prev",
        "reservation:r_dispute_prev",
        "reservation:r_pending_row",
        "reservation:r_recent_end",
        "reservation:r_recent_payment",
        "reservation:r_withdrawn_prev",
      ],
      "the old cancelled reservation, the one before the window and the other store's are left out",
    );
    for (const row of queue) {
      assert.equal(row.status, "pending", `${row.id} is due`);
      assert.equal(row.sentHash, null, `${row.id} is sent even if unchanged`);
      assert.equal(row.storeId, STORE);
    }
    // The row that was already pending got one more version; the others their first.
    assert.equal(queue.find((row) => row.id === "r_pending_row")?.version, 2);

    const payloads = new Map(
      queue.map((row) => [`${row.type}:${row.id}`, payloadSchema.parse(row.finalPayload)]),
    );
    for (const [key, payload] of payloads) {
      assert.equal(payload.observedAt, OBSERVED_AT.toISOString(), `${key} shares the purge's clock`);
      assert.equal(payload.data.deleted, true, `${key} says deleted`);
    }

    const recentPayment = payloads.get("reservation:r_recent_payment")?.data;
    assert.equal(recentPayment?.number, "R_RECENT_PAYMENT");
    assert.equal(Array.isArray(recentPayment?.payments) && recentPayment.payments.length, 1);

    const store = payloads.get(`store:${STORE}`)?.data;
    assert.equal(store?.slug, null, "the service already holds the slug");
    assert.deepEqual(store?.ownerUserIds, [], "and the owners");
    assert.equal(store?.currency, "EUR");
    assert.deepEqual(
      store?.finalReservations,
      queue
        .filter((row) => row.type === "reservation")
        .map((row) => ({ aggregateId: row.id, version: row.version })),
      "the store lists every final reservation at its version",
    );
  });

  test("a reservation the contract cannot express is left out and raised once committed", async () => {
    // More payments than the contract allows: a data error that no retry fixes.
    await louezDb.db.insert(louezDb.reservations).values(reservation("r_too_many", { status: "completed" }));
    await louezDb.db.insert(louezDb.payments).values(
      Array.from({ length: 201 }, (_, index) => ({
        id: `p_too_many_${index}`,
        reservationId: "r_too_many",
        amount: "0.00",
        type: "rental" as const,
        method: "stripe" as const,
        status: "cancelled" as const,
        stripeCheckoutSessionId: `cs_too_many_${index}`,
      })),
    );
    const logged: string[] = [];
    const result = await writeFinals({
      log: { error: (_tag, message) => logged.push(message), info: () => undefined },
    });

    assert.equal(result.reservations, 7);
    assert.equal(result.problems.length, 1);
    const [problem] = result.problems;
    assert.equal(problem?.kind, "reservation_skipped");
    assert.equal(problem?.kind === "reservation_skipped" && problem.reservationId, "r_too_many");
    assert.equal(problem?.storeId, STORE);
    assert.match(logged[0] ?? "", /r_too_many/);
    const queue = await rows();
    assert.equal(queue.some((row) => row.id === "r_too_many"), false, "no queue row");
    const store = payloadSchema.parse(queue.find((row) => row.type === "store")?.finalPayload);
    assert.equal(JSON.stringify(store.data.finalReservations).includes("r_too_many"), false);

    const alerts: Array<{ kind: string; message: string }> = [];
    await finals.alertFinalSnapshotProblems(result.problems, {
      log: { error: () => undefined, info: () => undefined },
      alert: async (kind, message) => void alerts.push({ kind, message }),
    });
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]?.kind, "final_snapshot_skipped");
    assert.match(alerts[0]?.message ?? "", new RegExp(`reservation r_too_many of store ${STORE}`));
    assert.match(alerts[0]?.message ?? "", /payments has 201 entries/);
  });

  test("the deletion locks the store's subscription row, and the closing body keeps its plan", async () => {
    await louezDb.db.insert(louezDb.subscriptions).values({
      id: "sub_final_row",
      storeId: STORE,
      planSlug: "pro",
      billingMode: "subscription",
      status: "active",
      stripeSubscriptionId: "sub_final",
      stripeCustomerId: "cus_final",
    });
    const probe = await database.connect();
    try {
      await louezDb.db.transaction(async (tx) => {
        await finals.lockFinalSnapshotFacts(tx, [STORE]);
        // A plan written now would be missing from the closing body: it has to wait.
        await assert.rejects(
          probe.query("SELECT id FROM subscriptions WHERE store_id = ? FOR UPDATE NOWAIT", [STORE]),
          /NOWAIT/,
        );
        await finals.writeFinalSnapshots(tx, [STORE], { observedAt: OBSERVED_AT });
      });
    } finally {
      await probe.end();
    }
    const store = payloadSchema.parse(
      (await rows()).find((row) => row.type === "store")?.finalPayload,
    );
    assert.deepEqual(store.data.plan, {
      slug: "pro",
      status: "active",
      stripeCustomerId: "cus_final",
    });
  });
});
