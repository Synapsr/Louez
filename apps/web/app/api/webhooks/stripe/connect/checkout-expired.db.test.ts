import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";
import type { Connection, RowDataPacket } from "mysql2/promise";

import {
  createTestDatabase,
  reservationChangeTestHooks,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";

// The Connect webhook's `checkout.session.expired` on a migrated database, its
// POST run whole: the session's payment cancelled with its `payment_expired`
// row, the marketplace attempt failed, then the abandoned checkout cancelled,
// each in its own commit, in this order, and the answer and the log. The
// signature check, the log and the fee runner are replaced; each call is
// recorded with its payload, in order. A move of the cancellation into
// packages/api must leave every case passing unchanged
// (docs/domain/reservation-changes.md, 6a-4).

const directory = mkdtempSync(join(tmpdir(), "louez-checkout-expired-"));
const stubsPath = join(directory, "stubs.cjs");
writeFileSync(stubsPath, "module.exports = globalThis.__louezCheckoutExpiredStubs;");
after(() => rmSync(directory, { recursive: true }));

const STUBBED = new Set([
  "next/headers",
  "@/lib/stripe/client",
  "@/lib/evlog",
  "@/lib/billing/reservation-effects",
]);

type Call = [name: string, ...args: unknown[]];
const calls: Call[] = [];
/** How many commits wrote rows so far; set once the database exists. */
let commitsSoFar: () => Promise<number> = async () => 0;

const record =
  (name: string) =>
  (...args: unknown[]) => {
    calls.push([name, ...structuredClone(args)]);
  };

Reflect.set(globalThis, "__louezCheckoutExpiredStubs", {
  headers: async () => new Headers({ "stripe-signature": "t=1,v1=test" }),
  stripe: {
    webhooks: {
      // The signature is not checked: the body is the event.
      constructEvent: (body: string) => JSON.parse(body),
    },
  },
  log: { error: record("log.error"), warn: record("log.warn"), info: record("log.info") },
  // Records the effects, and how many commits came before the call.
  runReservationEffects: async (effects: unknown) => {
    calls.push([
      "runReservationEffects",
      structuredClone(effects),
      { afterCommits: await commitsSoFar() },
    ]);
  },
});

Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: { parentURL?: string },
    next: (specifier: string, context: unknown) => unknown,
  ) {
    if (specifier === "server-only" || specifier === "@/lib/storage/files") {
      return { url: "node:module", shortCircuit: true };
    }
    const parent = context.parentURL ? decodeURIComponent(context.parentURL) : "";
    if (parent.endsWith("/api/webhooks/stripe/connect/route.ts") && STUBBED.has(specifier)) {
      return { url: pathToFileURL(stubsPath).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const STORE = "store_chk_expired";
const ACCOUNT = "acct_checkout_expired";

const TRX = `(SELECT CONCAT(THREAD_ID, ':', EVENT_ID) FROM performance_schema.events_transactions_current WHERE THREAD_ID = PS_CURRENT_THREAD_ID())`;
const WRITE_LOG = [
  `CREATE TABLE test_writes (
     seq INT AUTO_INCREMENT PRIMARY KEY,
     trx VARCHAR(32) NOT NULL,
     reservation_id VARCHAR(64) NOT NULL,
     entry VARCHAR(255) NOT NULL
   )`,
  `CREATE TRIGGER test_writes_payments AFTER UPDATE ON payments FOR EACH ROW
     INSERT INTO test_writes (trx, reservation_id, entry)
     VALUES (${TRX}, NEW.reservation_id, CONCAT('payments ', OLD.payment_status, ' > ', NEW.payment_status))`,
  `CREATE TRIGGER test_writes_activity AFTER INSERT ON reservation_activity FOR EACH ROW
     INSERT INTO test_writes (trx, reservation_id, entry)
     VALUES (${TRX}, NEW.reservation_id, CONCAT('reservation_activity + ', NEW.activity_type))`,
  `CREATE TRIGGER test_writes_reservations AFTER UPDATE ON reservations FOR EACH ROW
     INSERT INTO test_writes (trx, reservation_id, entry)
     VALUES (${TRX}, NEW.id, CONCAT('reservations', IF(OLD.reservation_status <=> NEW.reservation_status, '', CONCAT(' status ', OLD.reservation_status, ' > ', NEW.reservation_status))))`,
  `CREATE TRIGGER test_writes_attempts AFTER UPDATE ON marketplace_booking_attempts FOR EACH ROW
     INSERT INTO test_writes (trx, reservation_id, entry)
     VALUES (${TRX}, NEW.reservation_id, CONCAT('marketplace_booking_attempts ', OLD.status, ' > ', NEW.status))`,
];

describe("checkout.session.expired (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let raw: Connection;
  let louezDb: typeof import("@louez/db");
  let route: typeof import("./route");
  let counter = 0;

  before(async () => {
    database = await createTestDatabase("checkout_expired");
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = "whsec_test";
    louezDb = await import("@louez/db");
    route = await import("./route");

    raw = await database.connect();
    for (const statement of WRITE_LOG) await raw.query(statement);
    commitsSoFar = async () => {
      const [rows] = await raw.query<RowDataPacket[]>(
        "SELECT COUNT(DISTINCT trx) AS commits FROM test_writes",
      );
      return Number(rows[0]?.commits);
    };

    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: "owner",
      name: "Expired",
      slug: "checkout-expired",
      stripeAccountId: ACCOUNT,
    });
  });

  after(async () => {
    await raw?.end();
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    calls.length = 0;
    reservationChangeTestHooks().beforeReservationLock = null;
    await raw.query("TRUNCATE TABLE test_writes");
  });

  const nextId = (prefix: string) => `${prefix}_${++counter}`;

  async function booking(source: "online" | "marketplace" = "online") {
    const id = nextId("exp");
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId: STORE,
      customerId: "customer",
      number: id,
      status: "pending",
      startDate: new Date("2026-02-01T09:00:00Z"),
      endDate: new Date("2026-02-03T09:00:00Z"),
      subtotalAmount: "10.00",
      depositAmount: "0.00",
      totalAmount: "10.00",
      source,
    });
    return id;
  }

  async function sessionPayment(
    reservationId: string,
    status: "pending" | "cancelled" | "completed" = "pending",
  ) {
    const sessionId = nextId("cs");
    await louezDb.db.insert(louezDb.payments).values({
      id: nextId("pay"),
      reservationId,
      amount: "10.00",
      type: "rental",
      method: "stripe",
      status,
      stripeCheckoutSessionId: sessionId,
    });
    return sessionId;
  }

  const expire = async (
    reservationId: string,
    sessionId: string,
    checkoutFlow: string | null = "storefront_checkout",
  ) => {
    const event = {
      id: nextId("evt"),
      type: "checkout.session.expired",
      account: ACCOUNT,
      data: {
        object: {
          id: sessionId,
          object: "checkout.session",
          currency: "eur",
          amount_total: 1000,
          metadata: { reservationId, ...(checkoutFlow && { checkoutFlow }) },
        },
      },
    };
    const response = await route.POST(
      new Request("https://louez.test/api/webhooks/stripe/connect", {
        method: "POST",
        body: JSON.stringify(event),
      }),
    );
    return { status: response.status, body: await response.json() };
  };

  /** The reservation's writes, in order, each with the number of its commit (1, 2, …). */
  async function readWrites(reservationId: string) {
    const [rows] = await raw.query<RowDataPacket[]>(
      "SELECT trx, entry FROM test_writes WHERE reservation_id = ? ORDER BY seq",
      [reservationId],
    );
    const commits: string[] = [];
    return rows.map((row) => {
      if (!commits.includes(String(row.trx))) commits.push(String(row.trx));
      return `${commits.indexOf(String(row.trx)) + 1}: ${String(row.entry)}`;
    });
  }

  async function readStatus(id: string) {
    const [row] = await louezDb.db
      .select({ status: louezDb.reservations.status })
      .from(louezDb.reservations)
      .where(eq(louezDb.reservations.id, id));
    return row?.status;
  }

  async function readActivity(id: string) {
    const rows = await louezDb.db
      .select({
        activityType: louezDb.reservationActivity.activityType,
        userId: louezDb.reservationActivity.userId,
        metadata: louezDb.reservationActivity.metadata,
      })
      .from(louezDb.reservationActivity)
      .where(eq(louezDb.reservationActivity.reservationId, id));
    // Rows of one second share their `createdAt`: sorted by type.
    return rows.sort((a, b) => a.activityType.localeCompare(b.activityType));
  }

  const paymentExpired = (sessionId: string) => ({
    activityType: "payment_expired",
    userId: null,
    metadata: { checkoutSessionId: sessionId, amount: 10, currency: "EUR", method: "stripe" },
  });

  const expiredLog = (reservationId: string, sessionId: string, reservationCancelled: boolean) => [
    "log.info",
    {
      stripeWebhook: {
        event: "checkout.session.expired",
        reservationId,
        sessionId,
        reservationCancelled,
      },
    },
  ];

  test("a storefront checkout never paid: its payment cancelled with its row, then the checkout cancelled, then its fee effects, then the log", async () => {
    const id = await booking();
    const sessionId = await sessionPayment(id);

    assert.deepEqual(await expire(id, sessionId), { status: 200, body: { received: true } });

    assert.deepEqual(await readWrites(id), [
      "1: payments pending > cancelled",
      "1: reservation_activity + payment_expired",
      "2: reservations status pending > cancelled",
      "2: reservation_activity + cancelled",
    ]);
    assert.deepEqual(calls, [
      [
        "runReservationEffects",
        [{ type: "legacy_fee.void", storeId: STORE, reservationId: id }],
        { afterCommits: 2 },
      ],
      expiredLog(id, sessionId, true),
    ]);
    assert.equal(await readStatus(id), "cancelled");
    assert.deepEqual(await readActivity(id), [
      {
        activityType: "cancelled",
        userId: null,
        metadata: {
          previousStatus: "pending",
          newStatus: "cancelled",
          actor: "system",
          reason: "payment_expired",
          checkoutSessionId: sessionId,
        },
      },
      paymentExpired(sessionId),
    ]);
  });

  test("the same event again: another payment_expired row, the checkout already cancelled, no fee effects", async () => {
    const id = await booking();
    const sessionId = await sessionPayment(id);
    await expire(id, sessionId);
    calls.length = 0;
    await raw.query("TRUNCATE TABLE test_writes");

    assert.deepEqual(await expire(id, sessionId), { status: 200, body: { received: true } });

    assert.deepEqual(await readWrites(id), ["1: reservation_activity + payment_expired"]);
    assert.deepEqual(calls, [expiredLog(id, sessionId, false)]);
    assert.equal(await readStatus(id), "cancelled");
  });

  test("a session of another flow cancels its payment and leaves the reservation", async () => {
    for (const flow of [null, "payment_request"]) {
      const id = await booking();
      const sessionId = await sessionPayment(id);

      assert.deepEqual(await expire(id, sessionId, flow), {
        status: 200,
        body: { received: true },
      });

      assert.deepEqual(await readWrites(id), [
        "1: payments pending > cancelled",
        "1: reservation_activity + payment_expired",
      ]);
      assert.deepEqual(calls, [expiredLog(id, sessionId, false)]);
      assert.equal(await readStatus(id), "pending");
      calls.length = 0;
    }
  });

  test("a session whose payment was no longer pending (resumed or superseded) leaves the reservation", async () => {
    for (const status of ["cancelled", "completed"] as const) {
      const id = await booking();
      const sessionId = await sessionPayment(id, status);

      await expire(id, sessionId);

      assert.deepEqual(await readWrites(id), ["1: reservation_activity + payment_expired"]);
      assert.deepEqual(calls, [expiredLog(id, sessionId, false)]);
      assert.equal(await readStatus(id), "pending");
      calls.length = 0;
    }
  });

  test("another open rental payment keeps the checkout: its session's payment cancelled, the checkout left", async () => {
    const id = await booking();
    const sessionId = await sessionPayment(id);
    await sessionPayment(id);

    await expire(id, sessionId);

    assert.deepEqual(await readWrites(id), [
      "1: payments pending > cancelled",
      "1: reservation_activity + payment_expired",
    ]);
    assert.deepEqual(calls, [expiredLog(id, sessionId, false)]);
    assert.equal(await readStatus(id), "pending");
  });

  test("a marketplace booking: its attempt expires and the marketplace cancels it, then the abandoned checkout leaves it", async () => {
    const id = await booking("marketplace");
    const sessionId = await sessionPayment(id);
    await raw.query(
      `INSERT INTO marketplace_booking_attempts
         (id, booking_attempt_id, store_id, quote_token_hash, reservation_id, status, expires_at)
       VALUES (?, ?, ?, ?, ?, 'checkout_pending', ?)`,
      [nextId("att"), `attempt-${id}`, STORE, "0".repeat(64), id, new Date("2030-01-01T00:00:00Z")],
    );

    await expire(id, sessionId);

    assert.deepEqual(await readWrites(id), [
      "1: payments pending > cancelled",
      "1: reservation_activity + payment_expired",
      "2: reservations status pending > cancelled",
      "2: reservation_activity + cancelled",
      "2: marketplace_booking_attempts checkout_pending > expired",
    ]);
    assert.deepEqual(calls, [
      [
        "runReservationEffects",
        [{ type: "legacy_fee.void", storeId: STORE, reservationId: id }],
        { afterCommits: 2 },
      ],
      expiredLog(id, sessionId, false),
    ]);
    assert.equal(await readStatus(id), "cancelled");
    assert.deepEqual(await readActivity(id), [
      {
        activityType: "cancelled",
        userId: null,
        metadata: {
          previousStatus: "pending",
          newStatus: "cancelled",
          actor: "system",
          source: "marketplace",
          reason: "expired",
        },
      },
      paymentExpired(sessionId),
    ]);
  });

  test("a cancellation still busy after three runs answers 500 and logs it; its payment stays cancelled, and the event again leaves the checkout pending", async () => {
    const id = await booking();
    const sessionId = await sessionPayment(id);
    let runs = 0;
    reservationChangeTestHooks().beforeReservationLock = async (scope) => {
      if (scope.reservationId !== id) return;
      runs += 1;
      throw Object.assign(new Error("Deadlock found when trying to get lock"), {
        code: "ER_LOCK_DEADLOCK",
        errno: 1213,
      });
    };

    let answer: Awaited<ReturnType<typeof expire>>;
    try {
      answer = await expire(id, sessionId);
    } finally {
      reservationChangeTestHooks().beforeReservationLock = null;
    }

    assert.deepEqual(answer, { status: 500, body: { error: "Webhook handler failed" } });
    assert.equal(runs, 3);
    assert.deepEqual(await readWrites(id), [
      "1: payments pending > cancelled",
      "1: reservation_activity + payment_expired",
    ]);
    assert.equal(calls.length, 1);
    const [name, logged] = calls[0] as [string, { stripeWebhook: Record<string, unknown> }];
    assert.equal(name, "log.error");
    assert.equal(logged.stripeWebhook.event, "checkout.session.expired");
    assert.equal(logged.stripeWebhook.issue, "handler_failed");
    assert.equal(await readStatus(id), "pending");

    // Stripe sends the event again: the payment is no longer pending, so the
    // cancellation is skipped and the checkout stays pending (section 5).
    calls.length = 0;
    assert.deepEqual(await expire(id, sessionId), { status: 200, body: { received: true } });
    assert.deepEqual(calls, [expiredLog(id, sessionId, false)]);
    assert.equal(await readStatus(id), "pending");
  });
});
