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
  raceOnLockedRow,
  raceOnOpenTransaction,
  reservationChangeTestHooks,
  skipWithoutTestDatabase,
  type TestDatabase,
  waitForLockWaits,
} from "@louez/db/testing";

import { closeNetworkForSuite } from "@/lib/testing/network-guard";

// The Connect webhook's `checkout.session.expired` on a migrated database, its
// POST run whole: the session's payment cancelled with its `payment_expired`
// row, the marketplace attempt failed, then the abandoned checkout cancelled,
// each in its own commit, in this order, and the answer and the log. The
// signature check, the log and the fee runner are replaced; each call is
// recorded with its payload, in order. A move of the cancellation into
// packages/api must leave every case passing unchanged
// (docs/domain/reservation-changes.md, 6a-4). The event acts on the payment
// row its session names, on that row's reservation, sent by the account that
// row records, or its store's for a row that records none (6a-W2): a metadata
// reservation or an account other than those is logged and writes nothing. The
// expiry is recorded by the delivery that moves the payment out of pending,
// once, and every delivery of a recorded expiry asks for the checkout's
// cancellation, so a redelivery finishes one that failed; a session a resumed
// checkout replaced finds its row no longer pending and cancels nothing,
// whenever its expiry comes; a payment request's session, which has no payment
// row, records its expiry once per session; an event of the other mode than the
// deployment's key writes nothing. Each write takes the reservation's row, then
// its payment, then its history; the account deletion takes the store's
// products, then its reservations, then their rows: the two run one after the
// other, billing sync off as here, and a reservation gone by then is written
// nothing.

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
/** The payment session's calls to Stripe, which is a fake: no network. */
const stripeCalls: string[] = [];
/**
 * Runs as the payment session or the scheduled pass asks Stripe for something: a
 * moment of the resume. It answers "fail" to make that call fail, "expired" to
 * read the session expired; a call it leaves succeeds, and a read reads expired.
 */
let onStripeCall: ((call: string) => Promise<"fail" | void>) | null = null;
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
const OTHER_STORE = "store_chk_exp_other";
const OTHER_ACCOUNT = "acct_checkout_expired_other";
/** A store that left PREVIOUS_ACCOUNT for its account of today. */
const RECONNECTED_STORE = "store_chk_exp_moved";
const PREVIOUS_ACCOUNT = "acct_checkout_expired_previous";
/** A store that takes payments online, and its customer: a checkout can be resumed in it. */
const RESUME_STORE = "store_chk_exp_resume";
const RESUME_SLUG = "checkout-expired-resume";
const RESUME_ACCOUNT = "acct_checkout_expired_resume";
const RESUME_CUSTOMER = "cus_chk_exp_resume";

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
  // No test of this suite reaches a provider: Stripe and the senders are fakes.
  closeNetworkForSuite();

  let database: TestDatabase;
  let raw: Connection;
  let louezDb: typeof import("@louez/db");
  let route: typeof import("./route");
  let deletion: typeof import("@/lib/account-deletion/database-repository");
  let paymentSession: typeof import("@/lib/reservations/payment-session");
  let abandoned: typeof import("@/lib/reservations/abandoned-checkouts");
  let counter = 0;

  before(async () => {
    database = await createTestDatabase("checkout_expired");
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = "whsec_test";
    // The deployment's key: a test one, so it hears test events.
    process.env.STRIPE_SECRET_KEY = "sk_test_checkout_expired";
    louezDb = await import("@louez/db");
    route = await import("./route");
    deletion = await import("@/lib/account-deletion/database-repository");
    paymentSession = await import("@/lib/reservations/payment-session");
    abandoned = await import("@/lib/reservations/abandoned-checkouts");
    const { getStripe } = await import("@/lib/stripe/client");
    Reflect.set(getStripe().checkout.sessions, "create", async () => {
      const id = `cs_resumed_${++counter}`;
      stripeCalls.push(`create ${id}`);
      await onStripeCall?.(`create ${id}`);
      return { id, url: `https://checkout.stripe.test/${id}`, expires_at: 1_900_000_000 };
    });
    Reflect.set(getStripe().checkout.sessions, "expire", async (id: string) => {
      stripeCalls.push(`expire ${id}`);
      if ((await onStripeCall?.(`expire ${id}`)) === "fail") {
        throw new Error("This Checkout Session is not in an expireable state.");
      }
      return { id, status: "expired" };
    });
    Reflect.set(getStripe().checkout.sessions, "retrieve", async (id: string) => {
      stripeCalls.push(`retrieve ${id}`);
      if ((await onStripeCall?.(`retrieve ${id}`)) === "fail") {
        throw new Error("Stripe not reached");
      }
      return {
        id,
        status: "expired",
        payment_status: "unpaid",
        amount_total: 1000,
        currency: "eur",
      };
    });

    raw = await database.connect();
    for (const statement of WRITE_LOG) await raw.query(statement);
    commitsSoFar = async () => {
      const [rows] = await raw.query<RowDataPacket[]>(
        "SELECT COUNT(DISTINCT trx) AS commits FROM test_writes",
      );
      return Number(rows[0]?.commits);
    };

    await louezDb.db.insert(louezDb.stores).values([
      {
        id: STORE,
        userId: "owner",
        name: "Expired",
        slug: "checkout-expired",
        stripeAccountId: ACCOUNT,
      },
      {
        id: OTHER_STORE,
        userId: "other-owner",
        name: "Other",
        slug: "checkout-expired-other",
        stripeAccountId: OTHER_ACCOUNT,
      },
      {
        id: RECONNECTED_STORE,
        userId: "moved-owner",
        name: "Moved",
        slug: "checkout-expired-moved",
        stripeAccountId: "acct_checkout_expired_today",
      },
      {
        id: RESUME_STORE,
        userId: "resume-owner",
        name: "Resume",
        slug: RESUME_SLUG,
        stripeAccountId: RESUME_ACCOUNT,
        stripeChargesEnabled: true,
        settings: { reservationMode: "payment", currency: "EUR", advanceNoticeMinutes: 0 },
      },
    ]);
    await louezDb.db.insert(louezDb.customers).values({
      id: RESUME_CUSTOMER,
      storeId: RESUME_STORE,
      email: "renter@resume.test",
      firstName: "Renter",
      lastName: "Resume",
    });
  });

  after(async () => {
    await raw?.end();
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    calls.length = 0;
    stripeCalls.length = 0;
    onStripeCall = null;
    reservationChangeTestHooks().beforeReservationLock = null;
    await raw.query("TRUNCATE TABLE test_writes");
  });

  const nextId = (prefix: string) => `${prefix}_${++counter}`;

  async function booking(
    source: "online" | "marketplace" = "online",
    storeId = STORE,
    customerId = "customer",
  ) {
    const id = nextId("exp");
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId,
      customerId,
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
    stripeAccountId: string | null = null,
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
      stripeAccountId,
    });
    return sessionId;
  }

  const expire = async (
    reservationId: string,
    sessionId: string,
    checkoutFlow: string | null = "storefront_checkout",
    // A delivery of its own, unless the test sends one event twice.
    eventId: string = nextId("evt"),
    // The sending account, the whole metadata and the mode, when not the session's own.
    overrides: {
      account?: string | null;
      metadata?: Record<string, string>;
      livemode?: boolean;
    } = {},
  ) => {
    const event = {
      id: eventId,
      type: "checkout.session.expired",
      livemode: overrides.livemode ?? false,
      // null: an event that names no account.
      ...(overrides.account !== null && { account: overrides.account ?? ACCOUNT }),
      data: {
        object: {
          id: sessionId,
          object: "checkout.session",
          currency: "eur",
          amount_total: 1000,
          metadata: overrides.metadata ?? {
            reservationId,
            ...(checkoutFlow && { checkoutFlow }),
          },
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

  const reservationMismatch = (sessionId: string, expected: string, received: string) => [
    "log.error",
    {
      stripeWebhook: {
        event: "checkout.session.expired",
        issue: "reservation_mismatch",
        sessionId,
        expected,
        received,
      },
    },
  ];

  const accountMismatch = (
    sessionId: string,
    reservationId: string,
    expected: string,
    received: string,
  ) => [
    "log.error",
    {
      stripeWebhook: {
        event: "checkout.session.expired",
        issue: "connected_account_mismatch",
        expected,
        received,
        reservationId,
        sessionId,
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

  test("the same event again writes nothing: one payment_expired row, the checkout already cancelled, no fee effects", async () => {
    const id = await booking();
    const sessionId = await sessionPayment(id);
    const eventId = nextId("evt");
    await expire(id, sessionId, undefined, eventId);
    calls.length = 0;
    await raw.query("TRUNCATE TABLE test_writes");

    assert.deepEqual(await expire(id, sessionId, undefined, eventId), {
      status: 200,
      body: { received: true },
    });

    assert.deepEqual(await readWrites(id), []);
    assert.deepEqual(calls, [expiredLog(id, sessionId, false)]);
    assert.equal(await readStatus(id), "cancelled");
    assert.equal(
      (await readActivity(id)).filter((line) => line.activityType === "payment_expired").length,
      1,
    );
  });

  test("the same event twice at once: one delivery cancels the payment and writes its payment_expired row, the other writes nothing", async () => {
    const id = await booking();
    const sessionId = await sessionPayment(id);
    const [payment] = await louezDb.db
      .select({ id: louezDb.payments.id })
      .from(louezDb.payments)
      .where(eq(louezDb.payments.stripeCheckoutSessionId, sessionId));
    const eventId = nextId("evt");

    // Both deliveries read the payment pending, then wait on its row.
    const answers = await raceOnLockedRow(database, { table: "payments", id: String(payment?.id) }, [
      () => expire(id, sessionId, undefined, eventId),
      () => expire(id, sessionId, undefined, eventId),
    ]);

    assert.deepEqual(answers, [
      { status: 200, body: { received: true } },
      { status: 200, body: { received: true } },
    ]);
    assert.deepEqual(await readWrites(id), [
      "1: payments pending > cancelled",
      "1: reservation_activity + payment_expired",
      "2: reservations status pending > cancelled",
      "2: reservation_activity + cancelled",
    ]);
    assert.equal(await readStatus(id), "cancelled");
    // The delivery that moved the payment cancelled the checkout; the other did not.
    const cancelledBy = calls
      .filter(([name]) => name === "log.info")
      .map(([, logged]) => (logged as { stripeWebhook: { reservationCancelled: boolean } }))
      .map((logged) => logged.stripeWebhook.reservationCancelled);
    assert.deepEqual(cancelledBy.sort(), [false, true]);
  });

  test("a live event under the deployment's test key: livemode_mismatch logged, nothing written", async () => {
    const id = await booking();
    const sessionId = await sessionPayment(id);
    const eventId = nextId("evt");

    assert.deepEqual(await expire(id, sessionId, undefined, eventId, { livemode: true }), {
      status: 200,
      body: { received: true },
    });

    assert.deepEqual(await readWrites(id), []);
    assert.deepEqual(calls, [
      [
        "log.error",
        {
          stripeWebhook: {
            event: "checkout.session.expired",
            issue: "livemode_mismatch",
            stripeEventId: eventId,
            objectId: sessionId,
            accountId: ACCOUNT,
            livemode: true,
          },
        },
      ],
    ]);
    assert.equal(await readStatus(id), "pending");
    assert.deepEqual(await readActivity(id), []);
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

  test("a session whose payment was no longer pending (resumed or superseded): nothing written, the reservation left", async () => {
    for (const status of ["cancelled", "completed"] as const) {
      const id = await booking();
      const sessionId = await sessionPayment(id, status);

      await expire(id, sessionId);

      assert.deepEqual(await readWrites(id), []);
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

  test("a cancellation still busy after three runs answers 500 and logs it; its payment stays cancelled, and the event again cancels the checkout", async () => {
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

    const eventId = nextId("evt");
    let answer: Awaited<ReturnType<typeof expire>>;
    try {
      answer = await expire(id, sessionId, undefined, eventId);
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

    // Stripe sends the event again: the session's expiry is recorded, so the
    // redelivery finishes the cancellation, and records the expiry no second time.
    calls.length = 0;
    await raw.query("TRUNCATE TABLE test_writes");
    assert.deepEqual(await expire(id, sessionId, undefined, eventId), {
      status: 200,
      body: { received: true },
    });
    assert.deepEqual(await readWrites(id), [
      "1: reservations status pending > cancelled",
      "1: reservation_activity + cancelled",
    ]);
    assert.deepEqual(calls, [
      [
        "runReservationEffects",
        [{ type: "legacy_fee.void", storeId: STORE, reservationId: id }],
        { afterCommits: 1 },
      ],
      expiredLog(id, sessionId, true),
    ]);
    assert.equal(await readStatus(id), "cancelled");
    assert.deepEqual(
      (await readActivity(id)).map((line) => line.activityType),
      ["cancelled", "payment_expired"],
    );
  });

  /** A storefront checkout of the store that takes payments, its session's payment open. */
  async function resumableCheckout() {
    const id = await booking("online", RESUME_STORE, RESUME_CUSTOMER);
    const sessionId = await sessionPayment(id, "pending", RESUME_ACCOUNT);
    return { id, sessionId };
  }

  /** The checkout's payment resumed, as the cancelled page asks for it. */
  const resume = (reservationId: string) =>
    paymentSession.createReservationPaymentSessionForCustomer(
      RESUME_SLUG,
      reservationId,
      RESUME_CUSTOMER,
      "checkout_resume",
      { allowPendingReservation: true, chargeAmount: 10 },
    );

  /** The reservation's payments: their status and session, by session. */
  async function paymentsOf(id: string) {
    const rows = await louezDb.db
      .select({
        status: louezDb.payments.status,
        session: louezDb.payments.stripeCheckoutSessionId,
      })
      .from(louezDb.payments)
      .where(eq(louezDb.payments.reservationId, id));
    return rows.sort((a, b) => String(a.session).localeCompare(String(b.session)));
  }

  test("the expiry of a session a resumed checkout replaced never cancels the checkout, whenever it comes; one handled before the resume cancels it as before", async () => {
    const moments = [
      "before the resume",
      "its row cancelled, its session not yet expired at Stripe",
      "the new session created, not yet installed",
      "the new session installed",
    ] as const;
    for (const moment of moments) {
      const { id, sessionId } = await resumableCheckout();
      const deliver = () =>
        expire(id, sessionId, undefined, undefined, { account: RESUME_ACCOUNT });
      let delivered: Awaited<ReturnType<typeof expire>> | undefined;
      onStripeCall = async (call) => {
        if (
          (moment === "its row cancelled, its session not yet expired at Stripe" &&
            call === `expire ${sessionId}`) ||
          (moment === "the new session created, not yet installed" && call.startsWith("create "))
        ) {
          delivered = await deliver();
        }
      };
      if (moment === "before the resume") delivered = await deliver();
      const result = await resume(id);
      onStripeCall = null;
      if (moment === "the new session installed") delivered = await deliver();

      assert.deepEqual(delivered, { status: 200, body: { received: true } }, moment);
      if (moment === "before the resume") {
        assert.deepEqual(result, { error: "errors.invalidStatus" }, moment);
        assert.deepEqual(stripeCalls, [], moment);
        assert.equal(await readStatus(id), "cancelled", moment);
        assert.deepEqual(await paymentsOf(id), [{ status: "cancelled", session: sessionId }]);
      } else {
        assert.ok(!("error" in result), `${moment}: ${JSON.stringify(result)}`);
        assert.equal(await readStatus(id), "pending", moment);
        assert.deepEqual(
          await paymentsOf(id),
          [
            { status: "cancelled", session: sessionId },
            { status: "pending", session: result.sessionId },
          ],
          moment,
        );
        // The replaced session's expiry recorded nothing.
        assert.deepEqual(
          (await readActivity(id)).map((line) => line.activityType),
          ["payment_initiated"],
          moment,
        );
        assert.deepEqual(
          calls.filter(([name]) => name === "log.info"),
          [expiredLog(id, sessionId, false)],
          moment,
        );
      }
      calls.length = 0;
      stripeCalls.length = 0;
    }
  });

  test("a resume refused for an unknown session while another installs its successor: one pending rental row, and the successor's expiry cancels the checkout", async () => {
    const { id, sessionId: first } = await resumableCheckout();
    let successor: Awaited<ReturnType<typeof resume>> | undefined;
    let firstExpireAsked = false;
    // Resume X has cancelled the first session's row and asks Stripe to expire it:
    // meanwhile resume Y runs whole, expires that session and installs its own.
    // Then X's expire fails, and X cannot read the session.
    onStripeCall = async (call) => {
      if (call === `expire ${first}` && !firstExpireAsked) {
        firstExpireAsked = true;
        successor = await resume(id);
        return "fail";
      }
      if (call === `retrieve ${first}`) return "fail";
    };

    assert.deepEqual(await resume(id), { error: "errors.paymentSessionError" });
    onStripeCall = null;

    assert.ok(successor && !("error" in successor), JSON.stringify(successor));
    assert.deepEqual(await paymentsOf(id), [
      { status: "cancelled", session: first },
      { status: "pending", session: successor.sessionId },
    ]);

    // The successor's session expires unpaid: the checkout is cancelled.
    assert.deepEqual(
      await expire(id, String(successor.sessionId), undefined, undefined, {
        account: RESUME_ACCOUNT,
      }),
      { status: 200, body: { received: true } },
    );
    assert.equal(await readStatus(id), "cancelled");
  });

  test("an expiry delivered while a refused resume holds its row cancelled: the row stays cancelled, and the scheduled pass later cancels the checkout", async () => {
    const { id, sessionId } = await resumableCheckout();
    // Created forty minutes ago: its session's lifetime is over.
    await louezDb.db
      .update(louezDb.payments)
      .set({ createdAt: new Date(Date.now() - 40 * 60 * 1000) })
      .where(eq(louezDb.payments.stripeCheckoutSessionId, sessionId));
    // The session's expiry is delivered after the resume cancelled its row; then
    // the resume can neither expire nor read the session.
    let delivered: Awaited<ReturnType<typeof expire>> | undefined;
    onStripeCall = async (call) => {
      if (call === `expire ${sessionId}`) {
        delivered = await expire(id, sessionId, undefined, undefined, { account: RESUME_ACCOUNT });
        return "fail";
      }
      if (call === `retrieve ${sessionId}`) return "fail";
    };

    assert.deepEqual(await resume(id), { error: "errors.paymentSessionError" });
    onStripeCall = null;

    assert.deepEqual(delivered, { status: 200, body: { received: true } });
    assert.deepEqual(await paymentsOf(id), [{ status: "cancelled", session: sessionId }]);
    assert.equal(await readStatus(id), "pending");

    // The scheduled pass reads the session at Stripe, expired, and cancels the checkout.
    await abandoned.settleAbandonedCheckouts();
    assert.equal(await readStatus(id), "cancelled");
    assert.deepEqual(await paymentsOf(id), [{ status: "cancelled", session: sessionId }]);
  });

  test("an event whose reservation disagrees with its payment's, in the same store: logged, nothing written on either", async () => {
    const paid = await booking();
    const sessionId = await sessionPayment(paid);
    const named = await booking();

    assert.deepEqual(await expire(named, sessionId), { status: 200, body: { received: true } });

    assert.deepEqual(await readWrites(paid), []);
    assert.deepEqual(await readWrites(named), []);
    assert.deepEqual(calls, [reservationMismatch(sessionId, paid, named)]);
    assert.equal(await readStatus(paid), "pending");
    assert.equal(await readStatus(named), "pending");
  });

  test("an event whose reservation disagrees with its payment's, in another store: logged, nothing written on either", async () => {
    const paid = await booking();
    const sessionId = await sessionPayment(paid);
    const named = await booking("online", OTHER_STORE);

    assert.deepEqual(await expire(named, sessionId), { status: 200, body: { received: true } });

    assert.deepEqual(await readWrites(paid), []);
    assert.deepEqual(await readWrites(named), []);
    assert.deepEqual(calls, [reservationMismatch(sessionId, paid, named)]);
    assert.equal(await readStatus(paid), "pending");
    assert.equal(await readStatus(named), "pending");
  });

  test("a session sent by another account than its store's: connected_account_mismatch logged, nothing written", async () => {
    const id = await booking();
    const sessionId = await sessionPayment(id);

    assert.deepEqual(
      await expire(id, sessionId, undefined, undefined, { account: OTHER_ACCOUNT }),
      {
        status: 200,
        body: { received: true },
      },
    );

    assert.deepEqual(await readWrites(id), []);
    assert.deepEqual(calls, [accountMismatch(sessionId, id, ACCOUNT, OTHER_ACCOUNT)]);
    assert.equal(await readStatus(id), "pending");
  });

  test("a session whose metadata names no reservation is left, as before the binding", async () => {
    const id = await booking();
    const sessionId = await sessionPayment(id);

    assert.deepEqual(
      await expire(id, sessionId, undefined, undefined, {
        metadata: { checkoutFlow: "storefront_checkout" },
      }),
      { status: 200, body: { received: true } },
    );

    assert.deepEqual(await readWrites(id), []);
    assert.deepEqual(calls, []);
    assert.equal(await readStatus(id), "pending");
  });

  /** A payment request's session metadata: its reservation and its request, no flow. */
  const paymentRequest = (reservationId: string) => ({
    metadata: { reservationId, paymentRequestId: nextId("prq") },
  });

  test("a payment request's session, which no payment row names: its payment_expired row on its store's reservation, nothing else", async () => {
    const id = await booking();
    const sessionId = nextId("cs");

    assert.deepEqual(await expire(id, sessionId, null, undefined, paymentRequest(id)), {
      status: 200,
      body: { received: true },
    });

    assert.deepEqual(await readWrites(id), ["1: reservation_activity + payment_expired"]);
    assert.deepEqual(calls, [expiredLog(id, sessionId, false)]);
    assert.equal(await readStatus(id), "pending");
    assert.deepEqual(await readActivity(id), [paymentExpired(sessionId)]);
  });

  test("a payment request's session expiry delivered again writes nothing: one payment_expired row", async () => {
    const id = await booking();
    const sessionId = nextId("cs");
    const eventId = nextId("evt");
    const metadata = paymentRequest(id);
    await expire(id, sessionId, null, eventId, metadata);
    calls.length = 0;
    await raw.query("TRUNCATE TABLE test_writes");

    assert.deepEqual(await expire(id, sessionId, null, eventId, metadata), {
      status: 200,
      body: { received: true },
    });

    assert.deepEqual(await readWrites(id), []);
    assert.deepEqual(calls, [expiredLog(id, sessionId, false)]);
    assert.deepEqual(await readActivity(id), [paymentExpired(sessionId)]);
  });

  test("a payment request's session expiry delivered twice at once: one payment_expired row", async () => {
    const id = await booking();
    const sessionId = nextId("cs");
    const eventId = nextId("evt");
    const metadata = paymentRequest(id);

    // Both deliveries have read the reservation, then wait on its row.
    const answers = await raceOnLockedRow(database, { table: "reservations", id }, [
      () => expire(id, sessionId, null, eventId, metadata),
      () => expire(id, sessionId, null, eventId, metadata),
    ]);

    assert.deepEqual(answers, [
      { status: 200, body: { received: true } },
      { status: 200, body: { received: true } },
    ]);
    assert.deepEqual(await readWrites(id), ["1: reservation_activity + payment_expired"]);
    assert.deepEqual(await readActivity(id), [paymentExpired(sessionId)]);
  });

  test("two expired sessions of a payment request's reservation: a payment_expired row each", async () => {
    const id = await booking();
    const first = nextId("cs");
    const second = nextId("cs");

    await expire(id, first, null, undefined, paymentRequest(id));
    await expire(id, second, null, undefined, paymentRequest(id));

    assert.deepEqual(await readWrites(id), [
      "1: reservation_activity + payment_expired",
      "2: reservation_activity + payment_expired",
    ]);
    const sessions = (await readActivity(id)).map(
      (line) => (line.metadata as { checkoutSessionId: string }).checkoutSessionId,
    );
    assert.deepEqual(sessions.sort(), [first, second].sort());
  });

  test("a session no payment row and no payment request names: nothing written", async () => {
    const id = await booking();
    const sessionId = nextId("cs");

    assert.deepEqual(await expire(id, sessionId, null), { status: 200, body: { received: true } });

    assert.deepEqual(await readWrites(id), []);
    assert.deepEqual(calls, [expiredLog(id, sessionId, false)]);
    assert.equal(await readStatus(id), "pending");
  });

  test("a payment request's session, which no payment row names, leaves a marketplace booking and its attempt as they are", async () => {
    const id = await booking("marketplace");
    // The booking's own checkout, still open.
    await sessionPayment(id);
    await raw.query(
      `INSERT INTO marketplace_booking_attempts
         (id, booking_attempt_id, store_id, quote_token_hash, reservation_id, status, expires_at)
       VALUES (?, ?, ?, ?, ?, 'checkout_pending', ?)`,
      [nextId("att"), `attempt-${id}`, STORE, "0".repeat(64), id, new Date("2030-01-01T00:00:00Z")],
    );
    const otherSession = nextId("cs");

    assert.deepEqual(await expire(id, otherSession, null, undefined, paymentRequest(id)), {
      status: 200,
      body: { received: true },
    });

    assert.deepEqual(await readWrites(id), ["1: reservation_activity + payment_expired"]);
    assert.deepEqual(calls, [expiredLog(id, otherSession, false)]);
    assert.equal(await readStatus(id), "pending");
  });

  test("a session no payment row names, whose reservation is not of its account's store: logged, nothing written", async () => {
    const named = await booking("online", OTHER_STORE);
    const sessionId = nextId("cs");

    assert.deepEqual(await expire(named, sessionId), { status: 200, body: { received: true } });

    assert.deepEqual(await readWrites(named), []);
    assert.deepEqual(calls, [accountMismatch(sessionId, named, OTHER_ACCOUNT, ACCOUNT)]);
    assert.equal(await readStatus(named), "pending");
  });

  test("a session no payment row names, sent with no account: logged, nothing written", async () => {
    const id = await booking();
    const sessionId = nextId("cs");

    assert.deepEqual(await expire(id, sessionId, undefined, undefined, { account: null }), {
      status: 200,
      body: { received: true },
    });

    assert.deepEqual(await readWrites(id), []);
    assert.deepEqual(calls, [
      [
        "log.error",
        {
          stripeWebhook: {
            event: "checkout.session.expired",
            issue: "connected_account_missing",
            sessionId,
          },
        },
      ],
    ]);
    assert.equal(await readStatus(id), "pending");
  });

  test("a store that reconnected: a session its payment records under the previous account is read, one its payment records under none is refused", async () => {
    const recorded = await booking("online", RECONNECTED_STORE);
    const recordedSession = await sessionPayment(recorded, "pending", PREVIOUS_ACCOUNT);

    await expire(recorded, recordedSession, undefined, undefined, { account: PREVIOUS_ACCOUNT });

    assert.deepEqual(await readWrites(recorded), [
      "1: payments pending > cancelled",
      "1: reservation_activity + payment_expired",
      "2: reservations status pending > cancelled",
      "2: reservation_activity + cancelled",
    ]);
    assert.deepEqual(calls.at(-1), expiredLog(recorded, recordedSession, true));

    calls.length = 0;
    const unrecorded = await booking("online", RECONNECTED_STORE);
    const unrecordedSession = await sessionPayment(unrecorded);

    await expire(unrecorded, unrecordedSession, undefined, undefined, {
      account: PREVIOUS_ACCOUNT,
    });

    assert.deepEqual(await readWrites(unrecorded), []);
    assert.deepEqual(calls, [
      accountMismatch(
        unrecordedSession,
        unrecorded,
        "acct_checkout_expired_today",
        PREVIOUS_ACCOUNT,
      ),
    ]);
    assert.equal(await readStatus(unrecorded), "pending");
  });

  test("a store that reconnected: a session its payment records under the previous account is heard from that account only", async () => {
    const recorded = await booking("online", RECONNECTED_STORE);
    const recordedSession = await sessionPayment(recorded, "pending", PREVIOUS_ACCOUNT);

    // The store's account of today did not create the session.
    assert.deepEqual(
      await expire(recorded, recordedSession, undefined, undefined, {
        account: "acct_checkout_expired_today",
      }),
      { status: 200, body: { received: true } },
    );

    assert.deepEqual(await readWrites(recorded), []);
    assert.deepEqual(calls, [
      accountMismatch(recordedSession, recorded, PREVIOUS_ACCOUNT, "acct_checkout_expired_today"),
    ]);
    assert.equal(await readStatus(recorded), "pending");

    // The account it was created on: cancelled.
    calls.length = 0;
    await expire(recorded, recordedSession, undefined, undefined, { account: PREVIOUS_ACCOUNT });

    assert.deepEqual(await readWrites(recorded), [
      "1: payments pending > cancelled",
      "1: reservation_activity + payment_expired",
      "2: reservations status pending > cancelled",
      "2: reservation_activity + cancelled",
    ]);
    assert.deepEqual(calls.at(-1), expiredLog(recorded, recordedSession, true));
  });

  test("a session its payment row names, sent with no account: connected_account_missing logged, nothing written", async () => {
    for (const stripeAccountId of [ACCOUNT, null]) {
      const id = await booking();
      const sessionId = await sessionPayment(id, "pending", stripeAccountId);

      assert.deepEqual(await expire(id, sessionId, undefined, undefined, { account: null }), {
        status: 200,
        body: { received: true },
      });

      assert.deepEqual(await readWrites(id), []);
      assert.deepEqual(calls, [
        [
          "log.error",
          {
            stripeWebhook: {
              event: "checkout.session.expired",
              issue: "connected_account_missing",
              sessionId,
            },
          },
        ],
      ]);
      assert.equal(await readStatus(id), "pending");
      calls.length = 0;
    }
  });
  /** "committed", or the driver's error, such as a deadlock. */
  const settle = (promise: Promise<unknown>) =>
    promise.then(
      () => "committed",
      (error: unknown) => {
        const cause = error instanceof Error ? error.cause : undefined;
        if (cause instanceof Error) return cause.message;
        return error instanceof Error ? error.message : String(error);
      },
    );

  test("a payment request's expiry and the deletion of its store's account, at once: one after the other, no deadlock, nothing left of the reservation", async () => {
    const userId = nextId("user");
    const storeId = nextId("store_del");
    const accountId = nextId("acct_del");
    await louezDb.db.insert(louezDb.users).values({ id: userId, email: `${userId}@example.test` });
    await louezDb.db.insert(louezDb.stores).values({
      id: storeId,
      userId,
      name: "Deleted",
      slug: storeId.replace(/_/g, "-"),
      stripeAccountId: accountId,
    });
    await louezDb.db.insert(louezDb.storeMembers).values({ storeId, userId, role: "owner" });
    const id = await booking("online", storeId);
    const sessionId = nextId("cs");
    const context = await deletion.accountDeletionRepository.getContext(userId);
    assert.ok(context, "the user exists");

    // The expiry's answer and the deletion's outcome.
    const [expiry, purge] = await raceOnOpenTransaction<unknown>(
      database,
      async (holder) => {
        await holder.query("SELECT id FROM reservations WHERE id = ? FOR UPDATE", [id]);
      },
      [
        // The expiry waits on the reservation's row first, then the deletion starts.
        () =>
          expire(id, sessionId, null, undefined, { ...paymentRequest(id), account: accountId }),
        async () => {
          await waitForLockWaits(raw, database.name, 1);
          return settle(
            deletion.accountDeletionRepository.purgeOwnedData(context, {
              beforePurge: async () => undefined,
            }),
          );
        },
      ],
    );

    assert.deepEqual(
      calls.filter(([name]) => name === "log.error"),
      [],
      "no deadlock, nor any other failure",
    );
    assert.deepEqual(
      { expiry, purge },
      { expiry: { status: 200, body: { received: true } }, purge: "committed" },
    );
    assert.equal(await readStatus(id), undefined, "the reservation went with its store");
    assert.deepEqual(await readActivity(id), [], "no history line outlives its reservation");
  });

  test("an expiry whose reservation is deleted before its lock writes nothing and answers 200", async () => {
    for (const kind of ["payment request", "storefront checkout"] as const) {
      const id = await booking();
      const sessionId = kind === "payment request" ? nextId("cs") : await sessionPayment(id);

      // The expiry reads the reservation, then waits on its row, which goes.
      const [answer] = await raceOnOpenTransaction(
        database,
        async (holder) => {
          await holder.query("DELETE FROM reservations WHERE id = ?", [id]);
        },
        [
          () =>
            kind === "payment request"
              ? expire(id, sessionId, null, undefined, paymentRequest(id))
              : expire(id, sessionId),
        ],
      );

      assert.deepEqual(answer, { status: 200, body: { received: true } }, kind);
      assert.deepEqual(await readWrites(id), [], kind);
      assert.deepEqual(await readActivity(id), [], kind);
      calls.length = 0;
    }
  });
});
