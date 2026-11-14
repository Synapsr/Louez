import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";
import type Stripe from "stripe";

import {
  createTestDatabase,
  raceOnLockedRow,
  skipWithoutTestDatabase,
  type TestDatabase,
  waitForLockWaits,
} from "@louez/db/testing";

// The customer's online payment of a reservation: charged in the reservation's
// currency, frozen when it was made, whatever the store's is now, and only a
// payment in that currency has paid it (invariants M2 and M6). A resumed
// checkout cancels the rental's open payments, then expires their sessions, then
// creates its own, and installs it only on a reservation that, under its lock,
// is still payable and has no other open or paid rental payment; otherwise it
// expires the session it created. Each earlier session it settles (the ones it
// replaces, and those cancelled within a session's lifetime) is expired, or read
// when Stripe no longer expires it; when one was paid, or its state is unknown,
// no session is created and the rows whose sessions are not known to be expired
// go back to pending (docs/domain/reservation-changes.md). Stripe is a fake that
// notes the sessions it is asked to create, expire and read: no network. The
// database is real.

process.env.SKIP_ENV_VALIDATION = "true";
// The Stripe client is built from this key, then its session creation is replaced.
process.env.STRIPE_SECRET_KEY = "sk_test_stub";
delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
// The store is billed by nobody here: no fee is planned, and none is asked of a service.
delete process.env.LOUEZ_BILLING;
delete process.env.BILLING_SERVICE_URL;

const FILES_SDK = new URL("../../node_modules/files-sdk/dist/", import.meta.url);
const registerHooks = Reflect.get(nodeModule, "registerHooks");
if (typeof registerHooks !== "function") {
  throw new Error("This test requires node:module registerHooks");
}
registerHooks({
  resolve(
    specifier: string,
    context: unknown,
    next: (specifier: string, context: unknown) => unknown,
  ) {
    // The payment session imports "server-only", which throws outside Next.
    if (specifier === "server-only") return { url: "node:module", shortCircuit: true };
    // files-sdk, which it loads too, exports ESM only, through an "import" condition the
    // test's require misses.
    if (specifier === "files-sdk" || specifier.startsWith("files-sdk/")) {
      const entry = specifier === "files-sdk" ? "index.js" : `${specifier.slice(10)}/index.js`;
      return { url: new URL(entry, FILES_SDK).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

/** What Stripe answers about an earlier session (see `replacedAtStripe`). */
type AtStripe = "expirable" | "open" | "complete" | "expired" | "unreachable";

const STORE = "store_pay_session";
const SLUG = "pay-session";
const CUSTOMER = "customer_pay_session";

describe("the customer's payment session (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let paymentSession: typeof import("./payment-session");
  let counter = 0;
  const sessions: Stripe.Checkout.SessionCreateParams[] = [];
  /** The account each session was created on, in order. */
  const accounts: (string | undefined)[] = [];
  /** The sessions expired at Stripe, in order. */
  const expired: string[] = [];
  /** The sessions Stripe was asked to expire, expired or not, in order. */
  const expireAsked: string[] = [];
  /** The sessions read at Stripe, in order. */
  const retrieved: string[] = [];
  /**
   * What Stripe answers about a replaced session: by default it expires it. Else
   * the expire fails, and the retrieve answers that state, or fails too.
   */
  let replacedAtStripe: AtStripe = "expirable";
  /** What Stripe answers about one session, over `replacedAtStripe`. */
  const atStripe = new Map<string, AtStripe>();
  /** Runs as an earlier session is read at Stripe: a test's moment, before the restore. */
  let onRetrieve: ((id: string) => Promise<void>) | null = null;
  /** Runs after a session is created, before its payment is installed: a test's moment. */
  let afterCreate: (() => Promise<void>) | null = null;

  before(async () => {
    database = await createTestDatabase("payment_session");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    paymentSession = await import("./payment-session");
    const { getStripe } = await import("@/lib/stripe/client");
    Reflect.set(
      getStripe().checkout.sessions,
      "create",
      async (params: Stripe.Checkout.SessionCreateParams, options?: Stripe.RequestOptions) => {
        sessions.push(params);
        accounts.push(options?.stripeAccount);
        const id = `cs_pay_${sessions.length}`;
        await afterCreate?.();
        return { id, url: `https://checkout.stripe.test/${id}`, expires_at: 1_900_000_000 };
      },
    );
    // A session this test created is open; another is the replaced one.
    const created = (id: string) => sessions.some((_, index) => id === `cs_pay_${index + 1}`);
    Reflect.set(getStripe().checkout.sessions, "expire", async (id: string) => {
      expireAsked.push(id);
      if (!created(id) && (atStripe.get(id) ?? replacedAtStripe) !== "expirable") {
        throw new Error("This Checkout Session is not in an expireable state.");
      }
      expired.push(id);
      return { id, status: "expired" };
    });
    Reflect.set(getStripe().checkout.sessions, "retrieve", async (id: string) => {
      retrieved.push(id);
      await onRetrieve?.(id);
      const state = atStripe.get(id) ?? replacedAtStripe;
      if (state === "unreachable") throw new Error("Stripe not reached");
      return { id, status: state, payment_status: state === "complete" ? "paid" : "unpaid" };
    });

    // The store has moved to dollars since its reservations were booked.
    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: "owner_pay_session",
      name: "Pay session",
      slug: SLUG,
      settings: { reservationMode: "request", advanceNoticeMinutes: 0, currency: "USD" },
      stripeAccountId: "acct_pay_session",
      stripeChargesEnabled: true,
    });
    await louezDb.db.insert(louezDb.customers).values({
      id: CUSTOMER,
      storeId: STORE,
      email: "renter@example.test",
      firstName: "Renter",
      lastName: "Test",
    });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(() => {
    sessions.length = 0;
    accounts.length = 0;
    expired.length = 0;
    expireAsked.length = 0;
    retrieved.length = 0;
    replacedAtStripe = "expirable";
    atStripe.clear();
    onRetrieve = null;
    afterCreate = null;
  });

  /** A confirmed reservation of 100.00, with a deposit of 300.00. */
  async function createReservation(currency: string | null, total = "100.00", deposit = "300.00") {
    const id = `res_pay_${++counter}`;
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId: STORE,
      customerId: CUSTOMER,
      number: id,
      status: "confirmed",
      startDate: new Date("2031-04-10T09:00:00.000Z"),
      endDate: new Date("2031-04-12T09:00:00.000Z"),
      subtotalAmount: total,
      depositAmount: deposit,
      totalAmount: total,
      currency,
    });
    return id;
  }

  /** A completed card payment of the whole rental, in that currency. */
  const payByCard = (reservationId: string, currency: string) =>
    louezDb.db.insert(louezDb.payments).values({
      id: `pay_${reservationId}`,
      reservationId,
      amount: "100.00",
      type: "rental",
      method: "stripe",
      status: "completed",
      stripePaymentIntentId: `pi_${reservationId}`,
      currency,
    });

  const start = (reservationId: string) =>
    paymentSession.createReservationPaymentSessionForCustomer(
      SLUG,
      reservationId,
      CUSTOMER,
      "account_page",
    );

  /** What Stripe was asked for: the currency and the amount of the line to pay. */
  const asked = () =>
    sessions.map((params) => {
      const price = params.line_items?.[0]?.price_data;
      return [price?.currency, price?.unit_amount];
    });

  const pendingPayment = async (reservationId: string) => {
    const [row] = await louezDb.db
      .select({
        amount: louezDb.payments.amount,
        currency: louezDb.payments.currency,
        status: louezDb.payments.status,
      })
      .from(louezDb.payments)
      .where(eq(louezDb.payments.reservationId, reservationId));
    return row;
  };

  test("the session charges the reservation's currency, not the store's of today", async () => {
    // Booked in euros before the store moved to dollars.
    const frozen = await createReservation("EUR");
    // Booked before a reservation had its own currency: the store's.
    const legacy = await createReservation(null);

    for (const reservationId of [frozen, legacy]) {
      const result = await start(reservationId);
      assert.ok(!("error" in result), JSON.stringify(result));
    }

    assert.deepEqual(asked(), [
      ["eur", 10_000],
      ["usd", 10_000],
    ]);
    assert.deepEqual(await pendingPayment(frozen), {
      amount: "100.00",
      currency: "EUR",
      status: "pending",
    });
    assert.equal((await pendingPayment(legacy))?.currency, "USD");
  });

  test("the amount has the decimals of the reservation's currency", async () => {
    // Booked in yen, which has no decimals.
    const reservationId = await createReservation("JPY", "10000.00", "0.00");

    const result = await start(reservationId);

    assert.ok(!("error" in result), JSON.stringify(result));
    assert.deepEqual(asked(), [["jpy", 10_000]]);
  });

  test("a card payment in another currency has not paid the reservation", async () => {
    // 100 dollars taken while the store was on dollars are not the 100 euros owed.
    const owed = await createReservation("EUR");
    await payByCard(owed, "USD");
    const paid = await createReservation("EUR");
    await payByCard(paid, "EUR");

    const stillOwed = await start(owed);
    const alreadyPaid = await start(paid);

    assert.ok(!("error" in stillOwed), JSON.stringify(stillOwed));
    assert.deepEqual(asked(), [["eur", 10_000]]);
    assert.deepEqual(alreadyPaid, { error: "errors.alreadyPaid" });
  });

  test("the pending payment records the account its session was created on", async () => {
    const reservationId = await createReservation("EUR");

    const result = await start(reservationId);

    assert.ok(!("error" in result), JSON.stringify(result));
    assert.deepEqual(accounts, ["acct_pay_session"]);
    const rows = await louezDb.db
      .select({
        status: louezDb.payments.status,
        origin: louezDb.payments.origin,
        stripeCheckoutSessionId: louezDb.payments.stripeCheckoutSessionId,
        stripeAccountId: louezDb.payments.stripeAccountId,
      })
      .from(louezDb.payments)
      .where(eq(louezDb.payments.reservationId, reservationId));
    assert.deepEqual(rows, [
      {
        status: "pending",
        origin: "customer_session",
        stripeCheckoutSessionId: result.sessionId,
        stripeAccountId: "acct_pay_session",
      },
    ]);
  });

  /** A storefront checkout of 100.00 EUR, pending, with its session's payment open. */
  async function openCheckout() {
    const id = `res_pay_${++counter}`;
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId: STORE,
      customerId: CUSTOMER,
      number: id,
      status: "pending",
      startDate: new Date("2031-04-10T09:00:00.000Z"),
      endDate: new Date("2031-04-12T09:00:00.000Z"),
      subtotalAmount: "100.00",
      depositAmount: "0.00",
      totalAmount: "100.00",
      currency: "EUR",
      source: "online",
    });
    const openSession = `cs_open_${id}`;
    await louezDb.db.insert(louezDb.payments).values({
      id: `pay_open_${id}`,
      reservationId: id,
      amount: "100.00",
      type: "rental",
      method: "stripe",
      status: "pending",
      stripeCheckoutSessionId: openSession,
      stripeAccountId: "acct_pay_session",
      origin: "checkout",
      currency: "EUR",
    });
    return { id, openSession };
  }

  /** The checkout's payment resumed, as the cancelled page asks for it. */
  const resume = (reservationId: string) =>
    paymentSession.createReservationPaymentSessionForCustomer(
      SLUG,
      reservationId,
      CUSTOMER,
      "checkout_resume",
      { allowPendingReservation: true, chargeAmount: 100 },
    );

  /** The reservation's status, and its rental payments: their status and session. */
  async function stateOf(reservationId: string) {
    const [reservation] = await louezDb.db
      .select({ status: louezDb.reservations.status })
      .from(louezDb.reservations)
      .where(eq(louezDb.reservations.id, reservationId));
    const rows = await louezDb.db
      .select({
        status: louezDb.payments.status,
        session: louezDb.payments.stripeCheckoutSessionId,
      })
      .from(louezDb.payments)
      .where(eq(louezDb.payments.reservationId, reservationId));
    rows.sort((a, b) => String(a.session).localeCompare(String(b.session)));
    return { status: reservation?.status, payments: rows };
  }

  /**
   * Runs `statements` in a transaction on another connection, which keeps their
   * locks until a transaction waits on one of them, then commits. Resolves once
   * the locks are held, with the commit to wait for.
   */
  async function commitOnceWaitedOn(statements: ReadonlyArray<[string, unknown[]]>) {
    const holder = await database.connect();
    await holder.beginTransaction();
    for (const [statement, values] of statements) await holder.query(statement, values);
    const committed = (async () => {
      try {
        await waitForLockWaits(holder, database.name, 1);
      } finally {
        await holder.commit();
        await holder.end();
      }
    })();
    return { committed };
  }

  test("a resumed checkout replaces the open payment: its row cancelled, its session expired, the new one installed", async () => {
    const { id, openSession } = await openCheckout();

    const result = await resume(id);

    assert.ok(!("error" in result), JSON.stringify(result));
    assert.equal(result.sessionId, "cs_pay_1");
    assert.deepEqual(expired, [openSession]);
    assert.deepEqual(await stateOf(id), {
      status: "pending",
      payments: [
        { status: "cancelled", session: openSession },
        { status: "pending", session: "cs_pay_1" },
      ],
    });
  });

  test("a reservation the store cancels while the new session is created: nothing installed, the new session expired, errors.invalidStatus", async () => {
    const { id, openSession } = await openCheckout();
    let cancellation: { committed: Promise<void> } | undefined;
    // The store's cancellation holds the reservation's row when the new payment
    // comes to be installed, and commits once the install waits on it.
    afterCreate = async () => {
      cancellation = await commitOnceWaitedOn([
        ["UPDATE reservations SET reservation_status = 'cancelled' WHERE id = ?", [id]],
      ]);
    };

    const result = await resume(id);
    await cancellation?.committed;

    assert.deepEqual(result, { error: "errors.invalidStatus" });
    assert.deepEqual(expired, [openSession, "cs_pay_1"]);
    assert.deepEqual(await stateOf(id), {
      status: "cancelled",
      payments: [{ status: "cancelled", session: openSession }],
    });
  });

  test("the replaced session paid while the new one is created: nothing installed, the new session expired, errors.alreadyPaid", async () => {
    const { id, openSession } = await openCheckout();
    let completion: { committed: Promise<void> } | undefined;
    // The completion of the replaced session, as checkout.session.completed
    // writes it: the reservation's row, then the payment completed, then the
    // reservation confirmed. It commits once the install waits on it.
    afterCreate = async () => {
      completion = await commitOnceWaitedOn([
        ["SELECT id FROM reservations WHERE id = ? FOR UPDATE", [id]],
        [
          "UPDATE payments SET payment_status = 'completed' WHERE stripe_checkout_session_id = ?",
          [openSession],
        ],
        ["UPDATE reservations SET reservation_status = 'confirmed' WHERE id = ?", [id]],
      ]);
    };

    const result = await resume(id);
    await completion?.committed;

    assert.deepEqual(result, { error: "errors.alreadyPaid" });
    assert.deepEqual(expired, [openSession, "cs_pay_1"]);
    assert.deepEqual(await stateOf(id), {
      status: "confirmed",
      payments: [{ status: "completed", session: openSession }],
    });
  });

  test("two resumes at once: one installs its session, the other is refused and its session expired; one payment open", async () => {
    const { id, openSession } = await openCheckout();

    // Both have read the reservation, then wait on its row.
    const answers = await raceOnLockedRow(database, { table: "reservations", id }, [
      () => resume(id),
      () => resume(id),
    ]);

    const installed = answers.flatMap((answer) => ("sessionId" in answer ? [answer] : []));
    const refused = answers.filter((answer) => "error" in answer);
    assert.equal(installed.length, 1, JSON.stringify(answers));
    assert.deepEqual(refused, [{ error: "errors.paymentSessionError" }]);
    const winner = String(installed[0]?.sessionId);
    const loser = ["cs_pay_1", "cs_pay_2"].find((session) => session !== winner);
    // The open session is expired by the resume that cancelled its row, and again by the
    // other, which reads it as an earlier session still within its lifetime.
    assert.deepEqual([...new Set(expired)].sort(), [openSession, String(loser)].sort());
    assert.ok(expired.includes(String(loser)), "the loser's session expired");
    assert.deepEqual(await stateOf(id), {
      status: "pending",
      payments: [
        { status: "cancelled", session: openSession },
        { status: "pending", session: winner },
      ],
    });
  });

  test("a replaced session Stripe no longer expires, read as expired: a new session, as when it expires it", async () => {
    const { id, openSession } = await openCheckout();
    replacedAtStripe = "expired";

    const result = await resume(id);

    assert.ok(!("error" in result), JSON.stringify(result));
    assert.deepEqual(retrieved, [openSession]);
    assert.equal(sessions.length, 1);
    assert.deepEqual(await stateOf(id), {
      status: "pending",
      payments: [
        { status: "cancelled", session: openSession },
        { status: "pending", session: "cs_pay_1" },
      ],
    });
  });

  test("a replaced session neither expired nor read: no new session, its row back to pending, errors.paymentSessionError", async () => {
    for (const state of ["unreachable", "open"] as const) {
      const { id, openSession } = await openCheckout();
      replacedAtStripe = state;

      const result = await resume(id);

      assert.deepEqual(result, { error: "errors.paymentSessionError" }, state);
      assert.deepEqual(retrieved, [openSession], state);
      assert.equal(sessions.length, 0, `${state}: no session created`);
      assert.deepEqual(
        await stateOf(id),
        { status: "pending", payments: [{ status: "pending", session: openSession }] },
        state,
      );
      retrieved.length = 0;
    }
  });

  /** A rental payment of the reservation, cancelled, whose session was created `ageMs` ago. */
  async function earlierSession(reservationId: string, ageMs: number) {
    const session = `cs_earlier_${++counter}`;
    await louezDb.db.insert(louezDb.payments).values({
      id: `pay_${session}`,
      reservationId,
      amount: "100.00",
      type: "rental",
      method: "stripe",
      status: "cancelled",
      stripeCheckoutSessionId: session,
      stripeAccountId: "acct_pay_session",
      origin: "customer_session",
      currency: "EUR",
      createdAt: new Date(Date.now() - ageMs),
    });
    return session;
  }

  test("a resume refused for want of its replaced session's state puts its row back to pending: the next one asks Stripe again", async () => {
    const outcomes = [
      ["complete", { error: "errors.alreadyPaid" }],
      ["unreachable", { error: "errors.paymentSessionError" }],
      ["expired", null],
    ] as const;
    for (const [state, refusal] of outcomes) {
      const { id, openSession } = await openCheckout();
      replacedAtStripe = "unreachable";
      assert.deepEqual(await resume(id), { error: "errors.paymentSessionError" }, state);
      assert.deepEqual(
        await stateOf(id),
        { status: "pending", payments: [{ status: "pending", session: openSession }] },
        `${state}: the reservation as before the refused resume`,
      );
      expireAsked.length = 0;
      retrieved.length = 0;

      // Stripe now answers about the first session: paid, still unread, or expired.
      replacedAtStripe = state;
      const result = await resume(id);

      assert.deepEqual(expireAsked, [openSession], state);
      assert.deepEqual(retrieved, [openSession], state);
      if (refusal) {
        assert.deepEqual(result, refusal, state);
        assert.equal(sessions.length, 0, `${state}: no session created`);
        assert.deepEqual(
          await stateOf(id),
          { status: "pending", payments: [{ status: "pending", session: openSession }] },
          state,
        );
      } else {
        assert.ok(!("error" in result), `${state}: ${JSON.stringify(result)}`);
        assert.deepEqual(
          await stateOf(id),
          {
            status: "pending",
            payments: [
              { status: "cancelled", session: openSession },
              { status: "pending", session: "cs_pay_1" },
            ],
          },
          state,
        );
      }
      sessions.length = 0;
      expireAsked.length = 0;
      retrieved.length = 0;
    }
  });

  test("a cancelled session younger than a session's lifetime is settled at Stripe; an older one is never read there", async () => {
    const { id, openSession } = await openCheckout();
    // Cancelled a minute ago, and two hours ago.
    const young = await earlierSession(id, 60 * 1000);
    const old = await earlierSession(id, 2 * 60 * 60 * 1000);
    // Stripe no longer expires an earlier session, and reads it expired.
    replacedAtStripe = "expired";

    const result = await resume(id);

    assert.ok(!("error" in result), JSON.stringify(result));
    assert.deepEqual(expireAsked.sort(), [openSession, young].sort());
    assert.deepEqual(retrieved.sort(), [openSession, young].sort());
    assert.ok(
      !expireAsked.includes(old) && !retrieved.includes(old),
      "the old session is not read",
    );
    assert.equal(sessions.length, 1);
    assert.deepEqual(
      (await stateOf(id)).payments.filter((row) => row.status === "pending"),
      [{ status: "pending", session: "cs_pay_1" }],
    );
  });

  test("a refusal puts back to pending only the rows still cancelled: one its completion recorded meanwhile stays completed", async () => {
    const { id, openSession: paid } = await openCheckout();
    // A second open payment of the rental, whose session Stripe cannot be asked about.
    const unread = `cs_unread_${id}`;
    await louezDb.db.insert(louezDb.payments).values({
      id: `pay_unread_${++counter}`,
      reservationId: id,
      amount: "100.00",
      type: "rental",
      method: "stripe",
      status: "pending",
      stripeCheckoutSessionId: unread,
      stripeAccountId: "acct_pay_session",
      origin: "customer_session",
      currency: "EUR",
    });
    atStripe.set(paid, "complete");
    atStripe.set(unread, "unreachable");
    // The first session's completion is recorded while the resume reads it.
    onRetrieve = async (session) => {
      if (session !== paid) return;
      await louezDb.db
        .update(louezDb.payments)
        .set({ status: "completed" })
        .where(eq(louezDb.payments.stripeCheckoutSessionId, paid));
    };

    const result = await resume(id);

    assert.deepEqual(result, { error: "errors.alreadyPaid" });
    assert.equal(sessions.length, 0, "no session created");
    assert.deepEqual(
      (await stateOf(id)).payments.sort((a, b) => a.session!.localeCompare(b.session!)),
      [
        { status: "completed", session: paid },
        { status: "pending", session: unread },
      ],
    );
  });
});
