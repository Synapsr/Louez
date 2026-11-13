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
  raceOnOpenTransaction,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";

import type { DepositIntent } from "@/lib/reservations/util.deposit-hold-transition";

// The Connect webhook's `payment_intent.payment_failed` on a migrated database, its
// POST run whole (docs/domain/reservation-changes.md, 6a-W1). A rental payment's
// failed attempt writes its `payment_failed` line once per Stripe event and sends the
// owner's message and the platform's alert, on its reservation, in the store of the
// account that sent it; the Checkout Session stays open, and its completion or its
// expiry settles the payment, the booking and a marketplace attempt. A PaymentIntent a
// `deposit_hold` row records goes to the deposit events. An event that does not agree
// with the deployment's mode, its account or its records writes nothing. The
// signature check, the deployment's keys, the log, the fee runner, the senders and
// Stripe are replaced; Stripe answers what a case sets and fails on any other call.
// Triggers record each write with its transaction.

const directory = mkdtempSync(join(tmpdir(), "louez-payment-failed-"));
const stubsPath = join(directory, "stubs.cjs");
writeFileSync(stubsPath, "module.exports = globalThis.__louezPaymentFailedStubs;");
after(() => rmSync(directory, { recursive: true }));

/** What each module of the webhook has replaced, by the module that imports it. */
const STUBBED: Record<string, ReadonlySet<string>> = {
  "/api/webhooks/stripe/connect/route.ts": new Set([
    "next/headers",
    "@/env",
    "@/lib/stripe/client",
    "@/lib/evlog",
    "@/lib/billing/reservation-effects",
    "@/lib/discord/platform-notifications",
    "@/lib/reservations/deposit-hold-live",
  ]),
  "/api/webhooks/stripe/connect/payment-failure.ts": new Set([
    "@/lib/evlog",
    "@/lib/discord/platform-notifications",
    "@/lib/notifications/dispatcher",
  ]),
  "/api/webhooks/stripe/connect/deposit-events.ts": new Set(["@/lib/evlog"]),
};

type Call = [name: string, ...args: unknown[]];
const calls: Call[] = [];
const record =
  (name: string) =>
  (...args: unknown[]) => {
    calls.push([name, ...structuredClone(args)]);
  };

const TEST_KEY = "sk_test_payment_failed";
const LIVE_KEY = "sk_live_payment_failed";
/** The deployment's keys, as the route reads them; a case may change the secret key. */
const env = { STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_test", STRIPE_SECRET_KEY: TEST_KEY };

/** What Stripe answers for a PaymentIntent, by its id; a case sets it. */
const intents = new Map<string, DepositIntent>();
const unexpected = (name: string) => async () => {
  throw new Error(`Unexpected Stripe call: ${name}`);
};

const stubs = {
  headers: async () => new Headers({ "stripe-signature": "t=1,v1=test" }),
  env,
  stripe: {
    webhooks: {
      // The signature is not checked: the body is the event.
      constructEvent: (body: string) => JSON.parse(body),
    },
  },
  log: { error: record("log.error"), warn: record("log.warn"), info: record("log.info") },
  runReservationEffects: record("runReservationEffects"),
  notifyStripeConnected: unexpected("notifyStripeConnected"),
  notifyPaymentFailed: async (store: { id: string }, reservationNumber: string) => {
    calls.push(["notifyPaymentFailed", store.id, reservationNumber]);
  },
  dispatchNotification: async (
    type: string,
    context: { reservation?: { id: string }; payment?: unknown },
  ) => {
    calls.push([
      "dispatchNotification",
      type,
      { reservationId: context.reservation?.id, payment: context.payment },
    ]);
    return {
      email: { sent: true },
      sms: { sent: false },
      discord: { sent: false },
      push: { sent: false },
    };
  },
  // Set once the test database exists, before the route is imported.
  depositHoldDeps: null as unknown,
};
Reflect.set(globalThis, "__louezPaymentFailedStubs", stubs);

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
    for (const [module, replaced] of Object.entries(STUBBED)) {
      if (parent.endsWith(module) && replaced.has(specifier)) {
        return { url: pathToFileURL(stubsPath).href, shortCircuit: true };
      }
    }
    return next(specifier, context);
  },
});

const STORE = "store_pay_failed";
const ACCOUNT = "acct_payment_failed";
const OTHER_STORE = "store_pay_fail_other";
const OTHER_ACCOUNT = "acct_payment_failed_other";

const TRX = `(SELECT CONCAT(THREAD_ID, ':', EVENT_ID) FROM performance_schema.events_transactions_current WHERE THREAD_ID = PS_CURRENT_THREAD_ID())`;
const WRITE_LOG = [
  `CREATE TABLE test_writes (
     seq INT AUTO_INCREMENT PRIMARY KEY,
     trx VARCHAR(32) NOT NULL,
     reservation_id VARCHAR(64) NOT NULL,
     entry VARCHAR(255) NOT NULL
   )`,
  `CREATE TRIGGER test_writes_payments_insert AFTER INSERT ON payments FOR EACH ROW
     INSERT INTO test_writes (trx, reservation_id, entry)
     VALUES (${TRX}, NEW.reservation_id, CONCAT('payments + ', NEW.payment_type, ' ', NEW.payment_status))`,
  `CREATE TRIGGER test_writes_payments AFTER UPDATE ON payments FOR EACH ROW
     INSERT INTO test_writes (trx, reservation_id, entry)
     VALUES (${TRX}, NEW.reservation_id, CONCAT('payments ', NEW.payment_type, ' ', OLD.payment_status, ' > ', NEW.payment_status))`,
  `CREATE TRIGGER test_writes_activity AFTER INSERT ON reservation_activity FOR EACH ROW
     INSERT INTO test_writes (trx, reservation_id, entry)
     VALUES (${TRX}, NEW.reservation_id, CONCAT('reservation_activity + ', NEW.activity_type))`,
  `CREATE TRIGGER test_writes_reservations AFTER UPDATE ON reservations FOR EACH ROW
     INSERT INTO test_writes (trx, reservation_id, entry)
     VALUES (${TRX}, NEW.id, CONCAT('reservations', IF(OLD.reservation_status <=> NEW.reservation_status, '', CONCAT(' status ', OLD.reservation_status, ' > ', NEW.reservation_status)), IF(OLD.deposit_status <=> NEW.deposit_status, '', CONCAT(' deposit ', IFNULL(OLD.deposit_status, 'null'), ' > ', IFNULL(NEW.deposit_status, 'null')))))`,
  `CREATE TRIGGER test_writes_attempts AFTER UPDATE ON marketplace_booking_attempts FOR EACH ROW
     INSERT INTO test_writes (trx, reservation_id, entry)
     VALUES (${TRX}, NEW.reservation_id, CONCAT('marketplace_booking_attempts ', OLD.status, ' > ', NEW.status))`,
];

describe("payment_intent.payment_failed (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let raw: Connection;
  let louezDb: typeof import("@louez/db");
  let route: typeof import("./route");
  let counter = 0;

  before(async () => {
    database = await createTestDatabase("payment_failed");
    louezDb = await import("@louez/db");
    stubs.depositHoldDeps = {
      database: louezDb.db,
      stripe: {
        readIntent: async (accountId: string, paymentIntentId: string) => {
          calls.push(["stripe.readIntent", accountId, paymentIntentId]);
          const intent = intents.get(paymentIntentId);
          if (!intent) throw new Error(`No such payment_intent: ${paymentIntentId}`);
          return intent;
        },
        authorize: unexpected("authorize"),
        cardCustomer: unexpected("cardCustomer"),
        listCustomerIntents: unexpected("listCustomerIntents"),
        capture: unexpected("capture"),
        release: unexpected("release"),
      },
      dispatchEffects: record("dispatchEffects"),
    };
    route = await import("./route");

    raw = await database.connect();
    for (const statement of WRITE_LOG) await raw.query(statement);

    await louezDb.db.insert(louezDb.stores).values([
      {
        id: STORE,
        userId: "owner",
        name: "Failed payments",
        slug: "payment-failed",
        stripeAccountId: ACCOUNT,
      },
      {
        id: OTHER_STORE,
        userId: "other-owner",
        name: "Other",
        slug: "payment-failed-other",
        stripeAccountId: OTHER_ACCOUNT,
      },
    ]);
  });

  after(async () => {
    await raw?.end();
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    calls.length = 0;
    intents.clear();
    env.STRIPE_SECRET_KEY = TEST_KEY;
    await raw.query("TRUNCATE TABLE test_writes");
  });

  const nextId = (prefix: string) => `${prefix}_${++counter}`;

  /** A pending booking; its id is 21 characters, as a nanoid is. */
  async function booking(
    options: { source?: "online" | "marketplace"; storeId?: string; deposit?: boolean } = {},
  ) {
    const id = `res_pfd_${String(++counter).padStart(13, "0")}`;
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId: options.storeId ?? STORE,
      customerId: "customer",
      number: id,
      status: "pending",
      startDate: new Date("2027-02-01T09:00:00Z"),
      endDate: new Date("2027-02-03T09:00:00Z"),
      subtotalAmount: "80.00",
      depositAmount: options.deposit ? "50.00" : "0.00",
      depositStatus: options.deposit ? "pending" : null,
      totalAmount: "80.00",
      currency: "EUR",
      source: options.source ?? "online",
    });
    return id;
  }

  /** The storefront checkout's payment row, its session open. */
  async function checkoutPayment(reservationId: string) {
    const sessionId = nextId("cs");
    await louezDb.db.insert(louezDb.payments).values({
      id: nextId("pay"),
      reservationId,
      amount: "80.00",
      type: "rental",
      method: "stripe",
      status: "pending",
      stripeCheckoutSessionId: sessionId,
      currency: "EUR",
    });
    return sessionId;
  }

  /** A payment row that records the PaymentIntent. */
  async function recordedPayment(
    reservationId: string,
    paymentIntentId: string,
    type: "rental" | "deposit_hold",
    status: "pending" | "completed" | "refunded" | "failed",
  ) {
    const id = nextId("pay");
    await louezDb.db.insert(louezDb.payments).values({
      id,
      reservationId,
      amount: type === "deposit_hold" ? "50.00" : "80.00",
      type,
      method: "stripe",
      status,
      stripePaymentIntentId: paymentIntentId,
      stripeAccountId: ACCOUNT,
      currency: "EUR",
      ...(type === "deposit_hold" && { grossMinor: 5000 }),
    });
    return id;
  }

  async function marketplaceAttempt(reservationId: string) {
    await raw.query(
      `INSERT INTO marketplace_booking_attempts
         (id, booking_attempt_id, store_id, quote_token_hash, reservation_id, status, expires_at)
       VALUES (?, ?, ?, ?, ?, 'checkout_pending', ?)`,
      [
        nextId("att"),
        `attempt-${reservationId}`,
        STORE,
        "0".repeat(64),
        reservationId,
        new Date("2030-01-01T00:00:00Z"),
      ],
    );
  }

  const DECLINED = {
    message: "Your card was declined.",
    code: "card_declined",
    decline_code: "insufficient_funds",
  };

  /** Stripe's `payment_intent.payment_failed`, as the sending account delivers it. */
  const fail = async (
    paymentIntentId: string,
    metadata: Record<string, string>,
    options: { eventId?: string; account?: string | null; livemode?: boolean } = {},
  ) => {
    const event = {
      id: options.eventId ?? nextId("evt"),
      type: "payment_intent.payment_failed",
      livemode: options.livemode ?? false,
      // null: an event that names no account.
      ...(options.account !== null && { account: options.account ?? ACCOUNT }),
      data: {
        object: {
          id: paymentIntentId,
          object: "payment_intent",
          amount: 8000,
          currency: "eur",
          metadata,
          last_payment_error: DECLINED,
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

  const expire = async (reservationId: string, sessionId: string) => {
    const response = await route.POST(
      new Request("https://louez.test/api/webhooks/stripe/connect", {
        method: "POST",
        body: JSON.stringify({
          id: nextId("evt"),
          type: "checkout.session.expired",
          livemode: false,
          account: ACCOUNT,
          data: {
            object: {
              id: sessionId,
              object: "checkout.session",
              currency: "eur",
              amount_total: 8000,
              metadata: { reservationId, checkoutFlow: "storefront_checkout" },
            },
          },
        }),
      }),
    );
    return { status: response.status, body: await response.json() };
  };

  const OK = { status: 200, body: { received: true } };

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

  async function readPayments(reservationId: string) {
    const rows = await louezDb.db
      .select({ type: louezDb.payments.type, status: louezDb.payments.status })
      .from(louezDb.payments)
      .where(eq(louezDb.payments.reservationId, reservationId));
    return rows.map((row) => `${row.type} ${row.status}`).sort();
  }

  async function readAttempt(reservationId: string) {
    const [rows] = await raw.query<RowDataPacket[]>(
      "SELECT status FROM marketplace_booking_attempts WHERE reservation_id = ?",
      [reservationId],
    );
    return rows[0]?.status;
  }

  async function readLines(reservationId: string) {
    const rows = await louezDb.db
      .select({
        activityType: louezDb.reservationActivity.activityType,
        metadata: louezDb.reservationActivity.metadata,
      })
      .from(louezDb.reservationActivity)
      .where(eq(louezDb.reservationActivity.reservationId, reservationId));
    // Rows of one second share their `createdAt`: sorted by type, then by event.
    const key = (row: (typeof rows)[number]) =>
      `${row.activityType} ${String((row.metadata as { stripeEventId?: string })?.stripeEventId)}`;
    return rows.sort((a, b) => key(a).localeCompare(key(b), undefined, { numeric: true }));
  }

  const failedLine = (paymentIntentId: string, stripeEventId: string) => ({
    activityType: "payment_failed",
    metadata: {
      paymentIntentId,
      stripeEventId,
      amount: 80,
      currency: "EUR",
      method: "stripe",
      error: DECLINED.message,
      errorCode: DECLINED.code,
      declineCode: DECLINED.decline_code,
    },
  });

  /** What a recorded failure logs and sends, in order. */
  const recordedCalls = (reservationId: string, paymentIntentId: string) => [
    [
      "log.info",
      {
        stripeWebhook: {
          event: "payment_failed",
          kind: "rental",
          reservationId,
          paymentIntentId,
          errorCode: DECLINED.code,
          declineCode: DECLINED.decline_code,
        },
      },
    ],
    [
      "dispatchNotification",
      "payment_failed",
      { reservationId, payment: { amount: 80, currency: "EUR" } },
    ],
    ["notifyPaymentFailed", STORE, reservationId],
  ];

  const notRecorded = (
    issue: "duplicate_event" | "stale_event_for_completed_payment",
    reservationId: string,
    paymentIntentId: string,
  ) => [
    "log.info",
    { stripeWebhook: { event: "payment_failed", issue, reservationId, paymentIntentId } },
  ];

  /** A refusal of the failed attempt's binding, with the event's ids and the ids read. */
  const refused = (
    issue: string,
    ids: {
      eventId: string;
      paymentIntentId: string;
      accountId?: string;
      namedReservationId?: string;
      recordedReservationIds?: string[];
      readReservationId?: string;
      storeAccountId?: string | null;
      livemode?: boolean;
    },
  ) => [
    "log.error",
    {
      stripeWebhook: {
        event: "payment_failed",
        issue,
        stripeEventId: ids.eventId,
        paymentIntentId: ids.paymentIntentId,
        ...(ids.accountId !== undefined && { accountId: ids.accountId }),
        ...(ids.namedReservationId !== undefined && { namedReservationId: ids.namedReservationId }),
        ...(ids.livemode !== undefined && { livemode: ids.livemode }),
        ...(ids.recordedReservationIds !== undefined && {
          recordedReservationIds: ids.recordedReservationIds,
        }),
        ...(ids.readReservationId !== undefined && { readReservationId: ids.readReservationId }),
        ...(ids.storeAccountId !== undefined && { storeAccountId: ids.storeAccountId }),
      },
    },
  ];

  describe("a rental payment's failed attempt", () => {
    test("a storefront checkout's: its line, the owner's message and the platform's alert, and no payment row, booking or attempt written", async () => {
      const id = await booking();
      await checkoutPayment(id);
      await raw.query("TRUNCATE TABLE test_writes");
      const paymentIntentId = nextId("pi");
      const eventId = nextId("evt");

      assert.deepEqual(await fail(paymentIntentId, { reservationId: id }, { eventId }), OK);

      assert.deepEqual(await readWrites(id), ["1: reservation_activity + payment_failed"]);
      assert.deepEqual(await readLines(id), [failedLine(paymentIntentId, eventId)]);
      assert.deepEqual(calls, recordedCalls(id, paymentIntentId));
      assert.deepEqual(await readPayments(id), ["rental pending"]);
      assert.equal(await readStatus(id), "pending");
    });

    test("the same event again writes and sends nothing", async () => {
      const id = await booking();
      await checkoutPayment(id);
      const paymentIntentId = nextId("pi");
      const eventId = nextId("evt");
      await fail(paymentIntentId, { reservationId: id }, { eventId });
      calls.length = 0;
      await raw.query("TRUNCATE TABLE test_writes");

      assert.deepEqual(await fail(paymentIntentId, { reservationId: id }, { eventId }), OK);

      assert.deepEqual(await readWrites(id), []);
      assert.deepEqual(calls, [notRecorded("duplicate_event", id, paymentIntentId)]);
    });

    test("a second attempt, another event: its own line, its own message and alert", async () => {
      const id = await booking();
      await checkoutPayment(id);
      const paymentIntentId = nextId("pi");
      const first = nextId("evt");
      const second = nextId("evt");
      await fail(paymentIntentId, { reservationId: id }, { eventId: first });
      calls.length = 0;
      await raw.query("TRUNCATE TABLE test_writes");

      assert.deepEqual(await fail(paymentIntentId, { reservationId: id }, { eventId: second }), OK);

      assert.deepEqual(await readWrites(id), ["1: reservation_activity + payment_failed"]);
      assert.deepEqual(await readLines(id), [
        failedLine(paymentIntentId, first),
        failedLine(paymentIntentId, second),
      ]);
      assert.deepEqual(calls, recordedCalls(id, paymentIntentId));
      assert.deepEqual(await readPayments(id), ["rental pending"]);
    });

    test("a marketplace booking's: the booking stays pending and its attempt checkout_pending, then its session's expiry cancels it", async () => {
      const id = await booking({ source: "marketplace" });
      const sessionId = await checkoutPayment(id);
      await marketplaceAttempt(id);
      await raw.query("TRUNCATE TABLE test_writes");
      const paymentIntentId = nextId("pi");

      assert.deepEqual(await fail(paymentIntentId, { reservationId: id }), OK);

      assert.deepEqual(await readWrites(id), ["1: reservation_activity + payment_failed"]);
      assert.deepEqual(calls, recordedCalls(id, paymentIntentId));
      assert.equal(await readStatus(id), "pending");
      assert.equal(await readAttempt(id), "checkout_pending");
      assert.deepEqual(await readPayments(id), ["rental pending"]);

      // The customer leaves the session unpaid: it expires.
      calls.length = 0;
      assert.deepEqual(await expire(id, sessionId), OK);

      assert.deepEqual(await readWrites(id), [
        "1: reservation_activity + payment_failed",
        "2: payments rental pending > cancelled",
        "2: reservation_activity + payment_expired",
        "3: reservations status pending > cancelled",
        "3: reservation_activity + cancelled",
        "3: marketplace_booking_attempts checkout_pending > expired",
      ]);
      assert.equal(await readStatus(id), "cancelled");
      assert.equal(await readAttempt(id), "expired");
    });

    test("of a PaymentIntent a completed or a refunded payment of the reservation records: stale, nothing written or sent", async () => {
      for (const status of ["completed", "refunded"] as const) {
        const id = await booking();
        const paymentIntentId = nextId("pi");
        await recordedPayment(id, paymentIntentId, "rental", status);
        await raw.query("TRUNCATE TABLE test_writes");

        assert.deepEqual(await fail(paymentIntentId, { reservationId: id }), OK);

        assert.deepEqual(await readWrites(id), [], status);
        assert.deepEqual(
          calls,
          [notRecorded("stale_event_for_completed_payment", id, paymentIntentId)],
          status,
        );
        assert.deepEqual(await readPayments(id), [`rental ${status}`]);
        calls.length = 0;
      }
    });

    test("a completion that commits while the failure waits for the reservation's lock: read once committed, nothing written or sent", async () => {
      const id = await booking();
      await checkoutPayment(id);
      await raw.query("TRUNCATE TABLE test_writes");
      const paymentIntentId = nextId("pi");

      // The completion's claim holds the reservation's row, then records the
      // PaymentIntent on the checkout's payment; it commits once the failure waits.
      const [answer] = await raceOnOpenTransaction(
        database,
        async (holder) => {
          await holder.query("SELECT id FROM reservations WHERE id = ? FOR UPDATE", [id]);
          await holder.query(
            `UPDATE payments SET payment_status = 'completed', stripe_payment_intent_id = ?
             WHERE reservation_id = ? AND payment_type = 'rental'`,
            [paymentIntentId, id],
          );
        },
        [() => fail(paymentIntentId, { reservationId: id })],
      );

      assert.deepEqual(answer, OK);
      assert.deepEqual(await readWrites(id), ["1: payments rental pending > completed"]);
      assert.deepEqual(calls, [
        notRecorded("stale_event_for_completed_payment", id, paymentIntentId),
      ]);
    });

    test("of a PaymentIntent a payment of another reservation records: reservation_mismatch, nothing written on either", async () => {
      const recorded = await booking();
      const named = await booking();
      const paymentIntentId = nextId("pi");
      await recordedPayment(recorded, paymentIntentId, "rental", "pending");
      await raw.query("TRUNCATE TABLE test_writes");
      const eventId = nextId("evt");

      assert.deepEqual(await fail(paymentIntentId, { reservationId: named }, { eventId }), OK);

      assert.deepEqual(await readWrites(recorded), []);
      assert.deepEqual(await readWrites(named), []);
      assert.deepEqual(calls, [
        refused("reservation_mismatch", {
          eventId,
          paymentIntentId,
          accountId: ACCOUNT,
          namedReservationId: named,
          recordedReservationIds: [recorded],
          readReservationId: recorded,
          storeAccountId: ACCOUNT,
        }),
      ]);
    });

    test("sent with no account: connected_account_missing, nothing written", async () => {
      const id = await booking();
      const paymentIntentId = nextId("pi");
      const eventId = nextId("evt");

      assert.deepEqual(
        await fail(paymentIntentId, { reservationId: id }, { eventId, account: null }),
        OK,
      );

      assert.deepEqual(await readWrites(id), []);
      assert.deepEqual(calls, [
        refused("connected_account_missing", {
          eventId,
          paymentIntentId,
          namedReservationId: id,
        }),
      ]);
    });

    test("sent by another account than its store's: connected_account_mismatch, nothing written", async () => {
      const id = await booking();
      const paymentIntentId = nextId("pi");
      const eventId = nextId("evt");

      assert.deepEqual(
        await fail(paymentIntentId, { reservationId: id }, { eventId, account: OTHER_ACCOUNT }),
        OK,
      );

      assert.deepEqual(await readWrites(id), []);
      assert.deepEqual(calls, [
        refused("connected_account_mismatch", {
          eventId,
          paymentIntentId,
          accountId: OTHER_ACCOUNT,
          namedReservationId: id,
          recordedReservationIds: [],
          readReservationId: id,
          storeAccountId: ACCOUNT,
        }),
      ]);
    });

    test("a test event under a live key and a live event under a test key: livemode_mismatch, nothing written", async () => {
      for (const [secretKey, livemode] of [
        [LIVE_KEY, false],
        [TEST_KEY, true],
      ] as const) {
        env.STRIPE_SECRET_KEY = secretKey;
        const id = await booking();
        const paymentIntentId = nextId("pi");
        const eventId = nextId("evt");

        assert.deepEqual(
          await fail(paymentIntentId, { reservationId: id }, { eventId, livemode }),
          OK,
        );

        assert.deepEqual(await readWrites(id), []);
        assert.deepEqual(calls, [
          refused("livemode_mismatch", {
            eventId,
            paymentIntentId,
            accountId: ACCOUNT,
            namedReservationId: id,
            livemode,
          }),
        ]);
        calls.length = 0;
      }
    });
  });

  describe("a deposit hold's failed attempt", () => {
    /** Stripe's answer for a hold the customer's card did not authorize. */
    const declinedHold = (reservationId: string, paymentIntentId: string): DepositIntent => ({
      paymentIntentId,
      status: "requires_payment_method",
      amountMinor: 5000,
      capturedMinor: 0,
      currency: "EUR",
      captureBefore: null,
      captureMethod: "manual",
      customerId: null,
      paymentMethodId: null,
      chargeId: null,
      attemptId: null,
      reservationId,
    });

    test("of a PaymentIntent a deposit_hold row records, the event stating the deposit type or not: the deposit events' answer, one deposit_failed line", async () => {
      for (const metadata of [
        (id: string) => ({ reservationId: id, type: "deposit_hold" }),
        (id: string) => ({ reservationId: id }),
      ]) {
        const id = await booking({ deposit: true });
        const paymentIntentId = nextId("pi");
        // The hold's writer recorded the decline Stripe answered it.
        await recordedPayment(id, paymentIntentId, "deposit_hold", "failed");
        intents.set(paymentIntentId, declinedHold(id, paymentIntentId));
        await raw.query("TRUNCATE TABLE test_writes");

        assert.deepEqual(await fail(paymentIntentId, metadata(id)), OK);

        assert.deepEqual(await readWrites(id), ["1: reservation_activity + deposit_failed"]);
        // Read from Stripe and settled, then its line's message and alert, then the log.
        assert.deepEqual(
          calls.map(([name]) => name),
          [
            "stripe.readIntent",
            "dispatchEffects",
            "log.info",
            "dispatchNotification",
            "notifyPaymentFailed",
            "log.info",
          ],
        );
        assert.deepEqual(calls[0], ["stripe.readIntent", ACCOUNT, paymentIntentId]);
        assert.deepEqual(
          (await readLines(id)).map((line) => line.activityType),
          ["deposit_failed"],
        );
        assert.deepEqual(await readPayments(id), ["deposit_hold failed"]);
        assert.equal(await readStatus(id), "pending");
        calls.length = 0;
      }
    });

    test("of a PaymentIntent a deposit_hold row records, whose event names another reservation: reservation_mismatch, no call to Stripe", async () => {
      const recorded = await booking({ deposit: true });
      const named = await booking({ deposit: true });
      const paymentIntentId = nextId("pi");
      await recordedPayment(recorded, paymentIntentId, "deposit_hold", "pending");
      await raw.query("TRUNCATE TABLE test_writes");

      assert.deepEqual(
        await fail(paymentIntentId, { reservationId: named, type: "deposit_hold" }),
        OK,
      );

      assert.deepEqual(await readWrites(recorded), []);
      assert.deepEqual(await readWrites(named), []);
      assert.deepEqual(calls, [
        [
          "log.error",
          {
            stripeWebhook: {
              event: "payment_intent.payment_failed",
              issue: "reservation_mismatch",
              paymentIntentId,
              expected: recorded,
              received: named,
            },
          },
        ],
      ]);
    });

    test("sent with no account, or in another mode: refused before the deposit events, no call to Stripe", async () => {
      const id = await booking({ deposit: true });
      const paymentIntentId = nextId("pi");
      await recordedPayment(id, paymentIntentId, "deposit_hold", "pending");
      await raw.query("TRUNCATE TABLE test_writes");
      const metadata = { reservationId: id, type: "deposit_hold" };

      const missing = nextId("evt");
      assert.deepEqual(
        await fail(paymentIntentId, metadata, { eventId: missing, account: null }),
        OK,
      );
      const live = nextId("evt");
      assert.deepEqual(
        await fail(paymentIntentId, metadata, { eventId: live, livemode: true }),
        OK,
      );

      assert.deepEqual(await readWrites(id), []);
      assert.deepEqual(calls, [
        refused("connected_account_missing", {
          eventId: missing,
          paymentIntentId,
          namedReservationId: id,
        }),
        refused("livemode_mismatch", {
          eventId: live,
          paymentIntentId,
          accountId: ACCOUNT,
          namedReservationId: id,
          livemode: true,
        }),
      ]);
    });
  });
});
