import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { and, eq } from "drizzle-orm";
import type Stripe from "stripe";

import {
  createTestDatabase,
  raceOnLockedRow,
  skipWithoutTestDatabase,
  type TestDatabase,
  waitForLockWaits,
} from "@louez/db/testing";

import { closeNetworkForSuite } from "@/lib/testing/network-guard";

// The customer's online payment of a reservation: charged in the reservation's
// currency, frozen when it was made, whatever the store's is now, and only a
// payment in that currency has paid it (invariants M2 and M6). A resumed
// checkout cancels the rental's open payments, then expires their sessions, then
// creates its own, and installs it only on a reservation that, under its lock,
// is still payable, has no other open or paid rental payment and no unsettled
// session; otherwise it expires the session it created. Each unsettled rental
// session (the ones it replaces, and the `cancelled` ones Stripe has not said
// are over, whatever their age) is expired, or read when Stripe no longer
// expires it, and marked settled once Stripe says it is over; a marked one is
// never read again. When one's state is unknown, no session is created, the
// rows stay `cancelled`, and the next call asks again
// (docs/domain/reservation-changes.md). A session found
// paid is recorded through the completion, whose suite covers it. Stripe is a
// fake that notes the sessions it is asked to create, expire and read: no
// network. The database is real.

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
type AtStripe = "expirable" | "open" | "expired" | "unreachable";

const STORE = "store_pay_session";
const SLUG = "pay-session";
const CUSTOMER = "customer_pay_session";

describe("the customer's payment session (database)", { skip: skipWithoutTestDatabase() }, () => {
  // No test of this suite reaches a provider: Stripe is a fake.
  closeNetworkForSuite();

  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let paymentSession: typeof import("./payment-session");
  let resumeModule: typeof import("./resume-checkout-payment");
  let rentalSessions: typeof import("@louez/api/services/rental-sessions");
  let effects: typeof import("@louez/api/platform/effects");
  let sessionSenders: typeof import("./rental-session-effects");
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
  /** Runs after a session is created, before its payment is installed: a test's moment. */
  let afterCreate: (() => Promise<void>) | null = null;
  /**
   * The sessions Stripe has taken payment for, which its webhook has not
   * delivered yet: Stripe no longer expires them, and reads them paid.
   */
  const paidAtStripe = new Map<string, { reservationId: string; amountMinor: number }>();

  before(async () => {
    database = await createTestDatabase("payment_session");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    paymentSession = await import("./payment-session");
    resumeModule = await import("./resume-checkout-payment");
    rentalSessions = await import("@louez/api/services/rental-sessions");
    effects = await import("@louez/api/platform/effects");
    sessionSenders = await import("./rental-session-effects");
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
      if (paidAtStripe.has(id) || (!created(id) && replacedAtStripe !== "expirable")) {
        throw new Error("This Checkout Session is not in an expireable state.");
      }
      expired.push(id);
      return { id, status: "expired" };
    });
    Reflect.set(getStripe().checkout.sessions, "retrieve", async (id: string) => {
      retrieved.push(id);
      const paid = paidAtStripe.get(id);
      if (paid) {
        return {
          id,
          status: "complete",
          payment_status: "paid",
          payment_intent: `pi_${id}`,
          customer: null,
          amount_total: paid.amountMinor,
          currency: "eur",
          metadata: { reservationId: paid.reservationId },
          url: null,
          expires_at: 1_900_000_000,
        };
      }
      if (replacedAtStripe === "unreachable") throw new Error("Stripe not reached");
      return {
        id,
        status: replacedAtStripe,
        payment_status: "unpaid",
        url: `https://checkout.stripe.test/${id}`,
        expires_at: 1_900_000_000,
      };
    });
    // The PaymentIntent of a session found paid, as its completion reads it.
    Reflect.set(getStripe().paymentIntents, "retrieve", async (id: string) => ({
      id,
      customer: null,
      payment_method: null,
      metadata: {},
      latest_charge: null,
    }));

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
    afterCreate = null;
    paidAtStripe.clear();
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

  /**
   * A storefront checkout of 100.00 EUR, pending, with its session's payment open:
   * the whole total, or the part a partial deposit charges.
   */
  async function openCheckout(charge = "100.00") {
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
      amount: charge,
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

  /** The checkout's payment resumed, as the cancelled page asks for it: its own charge. */
  const resume = (reservationId: string, chargeAmount = 100) =>
    paymentSession.createReservationPaymentSessionForCustomer(
      SLUG,
      reservationId,
      CUSTOMER,
      "checkout_resume",
      { allowPendingReservation: true, chargeAmount },
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

  /** The sessions of the reservation whose rows are marked settled, sorted. */
  async function settledOf(reservationId: string) {
    const rows = await louezDb.db
      .select({
        session: louezDb.payments.stripeCheckoutSessionId,
        settledAt: louezDb.payments.sessionSettledAt,
      })
      .from(louezDb.payments)
      .where(eq(louezDb.payments.reservationId, reservationId));
    return rows.flatMap(({ session, settledAt }) => (settledAt ? [String(session)] : [])).sort();
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

  test("a replaced session neither expired nor read: no new session, its row left cancelled, errors.paymentSessionError", async () => {
    for (const state of ["unreachable", "open"] as const) {
      const { id, openSession } = await openCheckout();
      replacedAtStripe = state;

      const result = await resume(id);

      assert.deepEqual(result, { error: "errors.paymentSessionError" }, state);
      assert.deepEqual(retrieved, [openSession], state);
      assert.equal(sessions.length, 0, `${state}: no session created`);
      assert.deepEqual(
        await stateOf(id),
        { status: "pending", payments: [{ status: "cancelled", session: openSession }] },
        state,
      );
      retrieved.length = 0;
    }
  });

  /** A rental payment of the reservation, cancelled, whose session was created `ageMs` ago. */
  async function earlierSession(
    reservationId: string,
    ageMs: number,
    { settled = false }: { settled?: boolean } = {},
  ) {
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
      sessionSettledAt: settled ? new Date(Date.now() - ageMs) : null,
      createdAt: new Date(Date.now() - ageMs),
    });
    return session;
  }

  test("a resume refused for an unknown session leaves its row cancelled: the next one asks Stripe again", async () => {
    const outcomes = [
      ["unreachable", { error: "errors.paymentSessionError" }],
      ["expired", null],
    ] as const;
    for (const [state, refusal] of outcomes) {
      const { id, openSession } = await openCheckout();
      replacedAtStripe = "unreachable";
      assert.deepEqual(await resume(id), { error: "errors.paymentSessionError" }, state);
      assert.deepEqual(
        await stateOf(id),
        { status: "pending", payments: [{ status: "cancelled", session: openSession }] },
        `${state}: its row stays cancelled`,
      );
      expireAsked.length = 0;
      retrieved.length = 0;

      // Stripe now answers about the first session: still unread, or expired.
      replacedAtStripe = state;
      const result = await resume(id);

      assert.deepEqual(expireAsked, [openSession], state);
      assert.deepEqual(retrieved, [openSession], state);
      if (refusal) {
        assert.deepEqual(result, refusal, state);
        assert.equal(sessions.length, 0, `${state}: no session created`);
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

  test("an unsettled session is read at Stripe whatever its age, and marked once Stripe says it is over; a settled one is never read", async () => {
    const { id, openSession } = await openCheckout();
    // Two hours old: past any session's lifetime.
    const unsettled = await earlierSession(id, 2 * 60 * 60 * 1000);
    const settled = await earlierSession(id, 2 * 60 * 60 * 1000, { settled: true });
    // Stripe no longer expires an earlier session, and reads it expired.
    replacedAtStripe = "expired";

    const result = await resume(id);

    assert.ok(!("error" in result), JSON.stringify(result));
    assert.deepEqual(expireAsked.sort(), [openSession, unsettled].sort());
    assert.deepEqual(retrieved.sort(), [openSession, unsettled].sort());
    assert.ok(!expireAsked.includes(settled) && !retrieved.includes(settled));
    assert.equal(sessions.length, 1);
    assert.deepEqual(await settledOf(id), [openSession, settled, unsettled].sort());
  });

  test("four resumes in a row: once earlier sessions are marked, each asks Stripe about its predecessor alone, then creates its own", async () => {
    const { id, openSession } = await openCheckout();
    let previous = openSession;
    for (let run = 1; run <= 4; run += 1) {
      expireAsked.length = 0;
      retrieved.length = 0;
      const before = sessions.length;

      const result = await resume(id);

      assert.ok(!("error" in result), `${run}: ${JSON.stringify(result)}`);
      assert.deepEqual(expireAsked, [previous], `resume ${run}: its predecessor expired`);
      assert.deepEqual(retrieved, [], `resume ${run}: nothing read`);
      assert.equal(sessions.length, before + 1, `resume ${run}: one session created`);
      previous = String(result.sessionId);
    }
  });

  // What remains of the rental is what the customer's session charges, in the
  // reservation's currency (`getRentalBalance`); `errors.alreadyPaid` means
  // nothing remains, and only that.
  describe("the balance", () => {
    let paymentCounter = 0;

    /** A rental payment of the reservation, completed by card in euros unless said otherwise. */
    const addPayment = async (
      reservationId: string,
      amount: string,
      overrides: Partial<typeof louezDb.payments.$inferInsert> = {},
    ) => {
      const id = `pay_part_${++paymentCounter}`;
      await louezDb.db.insert(louezDb.payments).values({
        id,
        reservationId,
        amount,
        type: "rental",
        method: "stripe",
        status: "completed",
        stripePaymentIntentId: `pi_${id}`,
        currency: "EUR",
        ...overrides,
      });
      return id;
    };

    /** The reservation's rental payments still open: their amount and session. */
    const openPayments = async (reservationId: string) =>
      (
        await louezDb.db
          .select({
            amount: louezDb.payments.amount,
            status: louezDb.payments.status,
            session: louezDb.payments.stripeCheckoutSessionId,
          })
          .from(louezDb.payments)
          .where(eq(louezDb.payments.reservationId, reservationId))
      ).filter((row) => row.status === "pending");

    test("after 9 paid on 30, the portal session charges 21 (2100 cents), never 30", async () => {
      const id = await createReservation("EUR", "30.00", "0.00");
      await addPayment(id, "9.00");

      const result = await start(id);

      assert.ok(!("error" in result), JSON.stringify(result));
      assert.deepEqual(asked(), [["eur", 2100]]);
      assert.deepEqual(await openPayments(id), [
        { amount: "21.00", status: "pending", session: "cs_pay_1" },
      ]);
    });

    test("deposit then balance: once the balance is paid, nothing remains and errors.alreadyPaid", async () => {
      const id = await createReservation("EUR", "30.00", "0.00");
      await addPayment(id, "9.00");
      const first = await start(id);
      assert.ok(!("error" in first), JSON.stringify(first));
      // The balance's session paid, as its completion records it.
      await louezDb.db
        .update(louezDb.payments)
        .set({ status: "completed", stripePaymentIntentId: "pi_balance" })
        .where(eq(louezDb.payments.stripeCheckoutSessionId, String(first.sessionId)));

      const second = await start(id);

      assert.deepEqual(second, { error: "errors.alreadyPaid" });
      assert.equal(sessions.length, 1, "no session for a settled rental");
    });

    test("several partial payments: the session charges what they leave", async () => {
      const id = await createReservation("EUR", "30.00", "0.00");
      await addPayment(id, "10.00");
      await addPayment(id, "5.00", { method: "cash", stripePaymentIntentId: null });

      const result = await start(id);

      assert.ok(!("error" in result), JSON.stringify(result));
      assert.deepEqual(asked(), [["eur", 1500]]);
    });

    test("a refunded part is owed again, recorded by hand or through Stripe", async () => {
      // The store gave 10 back by hand on a payment of 30.
      const byHand = await createReservation("EUR", "30.00", "0.00");
      const paid = await addPayment(byHand, "30.00");
      await addPayment(byHand, "10.00", {
        method: "cash",
        stripePaymentIntentId: null,
        refundOfPaymentId: paid,
      });
      // Stripe refunded 10: the webhook brought the charge down to 20, and wrote the
      // refund as its own row.
      const throughStripe = await createReservation("EUR", "30.00", "0.00");
      const charge = await addPayment(throughStripe, "20.00");
      await addPayment(throughStripe, "10.00", {
        stripePaymentIntentId: null,
        stripeRefundId: "re_balance",
        refundOfPaymentId: charge,
      });

      for (const id of [byHand, throughStripe]) {
        const result = await start(id);
        assert.ok(!("error" in result), JSON.stringify(result));
      }

      assert.deepEqual(asked(), [
        ["eur", 1000],
        ["eur", 1000],
      ]);
    });

    test("in another currency: a card payment in dollars settles nothing of euros; yen are charged in yen", async () => {
      const euros = await createReservation("EUR", "30.00", "0.00");
      await addPayment(euros, "9.00", { currency: "USD" });
      const yen = await createReservation("JPY", "10000.00", "0.00");
      await addPayment(yen, "3000.00", { currency: "JPY" });

      for (const id of [euros, yen]) {
        const result = await start(id);
        assert.ok(!("error" in result), JSON.stringify(result));
      }

      assert.deepEqual(asked(), [
        ["eur", 3000],
        ["jpy", 7000],
      ]);
    });

    test("a balance payment in progress is replaced, and the new session charges the balance", async () => {
      const id = await createReservation("EUR", "30.00", "0.00");
      await addPayment(id, "9.00");
      // A session for the balance still open (3DS, webhook lag): it pays nothing yet.
      await addPayment(id, "21.00", {
        status: "pending",
        stripePaymentIntentId: null,
        stripeCheckoutSessionId: "cs_in_progress",
        stripeAccountId: "acct_pay_session",
        origin: "customer_session",
      });

      const result = await start(id);

      assert.ok(!("error" in result), JSON.stringify(result));
      assert.deepEqual(expired, ["cs_in_progress"]);
      assert.deepEqual(asked(), [["eur", 2100]]);
      assert.deepEqual(await openPayments(id), [
        { amount: "21.00", status: "pending", session: "cs_pay_1" },
      ]);
    });

    test("overpaid, the total lowered after payment: nothing is asked, errors.alreadyPaid", async () => {
      const id = await createReservation("EUR", "20.00", "0.00");
      await addPayment(id, "30.00");

      const result = await start(id);

      assert.deepEqual(result, { error: "errors.alreadyPaid" });
      assert.equal(sessions.length, 0);
      assert.deepEqual(await openPayments(id), []);
    });

    test("a balance below Stripe's minimum: the checkout's refusal and its message, no session", async () => {
      const id = await createReservation("EUR", "30.00", "0.00");
      await addPayment(id, "29.70");

      const result = await start(id);

      assert.deepEqual(result, {
        error: "errors.paymentAmountTooSmall",
        errorParams: { minimumAmount: 0.5, currency: "EUR" },
      });
      assert.equal(sessions.length, 0);
      assert.deepEqual(await openPayments(id), []);
    });

    /** A payment of the reservation recorded on another connection, holding its row first. */
    const recordedMeanwhile = (reservationId: string, amount: string, method: string) =>
      commitOnceWaitedOn([
        ["SELECT id FROM reservations WHERE id = ? FOR UPDATE", [reservationId]],
        [
          "INSERT INTO payments (id, reservation_id, amount, payment_type, payment_method, payment_status, currency) VALUES (?, ?, ?, 'rental', ?, 'completed', 'EUR')",
          [`pm_${reservationId}`, reservationId, amount, method],
        ],
      ]);

    test("the balance paid while the session is created: nothing installed, the new session expired, errors.alreadyPaid", async () => {
      const id = await createReservation("EUR", "30.00", "0.00");
      await addPayment(id, "9.00");
      let payment: { committed: Promise<void> } | undefined;
      afterCreate = async () => {
        payment = await recordedMeanwhile(id, "21.00", "cash");
      };

      const result = await start(id);
      await payment?.committed;

      assert.deepEqual(result, { error: "errors.alreadyPaid" });
      assert.deepEqual(expired, ["cs_pay_1"]);
      assert.deepEqual(await openPayments(id), []);
    });

    test("part of the balance paid while the session is created: nothing installed, the new session expired, errors.reservationChangedMeanwhile", async () => {
      const id = await createReservation("EUR", "30.00", "0.00");
      await addPayment(id, "9.00");
      let payment: { committed: Promise<void> } | undefined;
      afterCreate = async () => {
        payment = await recordedMeanwhile(id, "5.00", "cash");
      };

      const result = await start(id);
      await payment?.committed;

      assert.deepEqual(result, { error: "errors.reservationChangedMeanwhile" });
      assert.deepEqual(expired, ["cs_pay_1"]);
      assert.deepEqual(await openPayments(id), []);
      // The next call charges what is left.
      afterCreate = null;
      const again = await start(id);
      assert.ok(!("error" in again), JSON.stringify(again));
      assert.deepEqual(asked().at(-1), ["eur", 1600]);
    });

    test("two tabs pay the balance at once: one session installed for the balance, the other refused; one payment open", async () => {
      const id = await createReservation("EUR", "30.00", "0.00");
      await addPayment(id, "9.00");

      // Both have read the reservation, then wait on its row.
      const answers = await raceOnLockedRow(database, { table: "reservations", id }, [
        () => start(id),
        () => start(id),
      ]);

      const installed = answers.flatMap((answer) => ("sessionId" in answer ? [answer] : []));
      assert.equal(installed.length, 1, JSON.stringify(answers));
      assert.deepEqual(
        answers.filter((answer) => "error" in answer),
        [{ error: "errors.paymentSessionError" }],
      );
      assert.ok(
        asked().every(([, amount]) => amount === 2100),
        JSON.stringify(asked()),
      );
      assert.deepEqual(await openPayments(id), [
        { amount: "21.00", status: "pending", session: String(installed[0]?.sessionId) },
      ]);
    });

    test("a completed rental pays the balance it still owes", async () => {
      const id = await createReservation("EUR", "30.00", "0.00");
      await louezDb.db
        .update(louezDb.reservations)
        .set({ status: "completed" })
        .where(eq(louezDb.reservations.id, id));
      await addPayment(id, "9.00");

      const result = await start(id);

      assert.ok(!("error" in result), JSON.stringify(result));
      assert.deepEqual(asked(), [["eur", 2100]]);
    });

    /** A session for the balance, opened earlier: its row `pending`, on the store's account. */
    const balanceSession = (reservationId: string, amount: string) =>
      addPayment(reservationId, amount, {
        status: "pending",
        stripePaymentIntentId: null,
        stripeCheckoutSessionId: `cs_bal_${reservationId}`,
        stripeAccountId: "acct_pay_session",
        origin: "customer_session",
      }).then(() => `cs_bal_${reservationId}`);

    /** The reservation's rental rows: amount and status, by session. */
    const rowsBySession = async (reservationId: string) =>
      Object.fromEntries(
        (
          await louezDb.db
            .select({
              session: louezDb.payments.stripeCheckoutSessionId,
              amount: louezDb.payments.amount,
              status: louezDb.payments.status,
            })
            .from(louezDb.payments)
            .where(eq(louezDb.payments.reservationId, reservationId))
        ).map((row) => [String(row.session), [row.amount, row.status]]),
      );

    test("the balance's session already paid at Stripe when the customer pays again: recorded, nothing new, errors.alreadyPaid", async () => {
      const id = await createReservation("EUR", "30.00", "0.00");
      await addPayment(id, "9.00");
      const session = await balanceSession(id, "21.00");
      paidAtStripe.set(session, { reservationId: id, amountMinor: 2100 });

      const result = await start(id);

      assert.deepEqual(result, { error: "errors.alreadyPaid" });
      assert.equal(sessions.length, 0, "nothing is charged again");
      assert.deepEqual((await rowsBySession(id))[session], ["21.00", "completed"]);
    });

    test("an earlier session found paid for part of the balance: recorded, nothing new, errors.reservationChangedMeanwhile", async () => {
      const id = await createReservation("EUR", "30.00", "0.00");
      await addPayment(id, "9.00");
      const session = await balanceSession(id, "10.00");
      paidAtStripe.set(session, { reservationId: id, amountMinor: 1000 });

      const result = await start(id);

      assert.deepEqual(result, { error: "errors.reservationChangedMeanwhile" });
      assert.equal(sessions.length, 0);
      assert.deepEqual((await rowsBySession(id))[session], ["10.00", "completed"]);
      // The reload asks for what is left.
      const again = await start(id);
      assert.ok(!("error" in again), JSON.stringify(again));
      assert.deepEqual(asked(), [["eur", 1100]]);
    });

    // --- The checkout's resume, through its own entry point ---------------------

    const resumeCheckout = (reservationId: string) =>
      resumeModule.resumeCheckoutPayment({
        store: {
          id: STORE,
          slug: SLUG,
          stripeAccountId: "acct_pay_session",
          stripeChargesEnabled: true,
          settings: { currency: "USD" },
        },
        reservationId,
      });

    test("resume: the checkout's open session that still fits the balance is handed back as it is", async () => {
      const { id, openSession } = await openCheckout("30.00");
      replacedAtStripe = "open";

      const result = await resumeCheckout(id);

      assert.deepEqual(result, { ok: true, url: `https://checkout.stripe.test/${openSession}` });
      assert.equal(sessions.length, 0);
    });

    test("resume: an open session above what remains, the total lowered since, is never handed back: reservation_changed", async () => {
      const { id, openSession } = await openCheckout("100.00");
      await louezDb.db
        .update(louezDb.reservations)
        .set({ totalAmount: "80.00", subtotalAmount: "80.00" })
        .where(eq(louezDb.reservations.id, id));
      replacedAtStripe = "open";

      const result = await resumeCheckout(id);

      assert.deepEqual(result, { ok: false, error: "reservation_changed" });
      assert.ok(!retrieved.includes(openSession), "the open session is not read to be handed back");
      assert.equal(sessions.length, 0);
    });

    test("resume: a deposit paid since, a balance still due: reservation_changed, never already_paid", async () => {
      const { id } = await openCheckout("30.00");
      await addPayment(id, "30.00");
      replacedAtStripe = "open";

      assert.deepEqual(await resumeCheckout(id), { ok: false, error: "reservation_changed" });
      assert.equal(sessions.length, 0, "the deposit is never charged twice");
    });

    test("resume: a charge below the card minimum keeps the checkout's refusal and its parameters", async () => {
      const { id } = await openCheckout("0.30");
      await louezDb.db
        .update(louezDb.payments)
        .set({ status: "cancelled", sessionSettledAt: new Date() })
        .where(eq(louezDb.payments.reservationId, id));

      assert.deepEqual(await resumeCheckout(id), {
        ok: false,
        error: "amount_too_small",
        minimumAmount: 0.5,
        currency: "EUR",
      });
      assert.equal(sessions.length, 0);
    });

    // --- A write that lowers the balance expires the sessions it leaves open ----

    /** The expiry a lowering write queues in its transaction, as it queues it. */
    const queueExpiry = (reservationId: string) =>
      louezDb.db.transaction((tx) =>
        rentalSessions.enqueueRentalSessionsExpiry(tx, STORE, reservationId),
      );

    /** The outbox sends those rows with the app's sender. */
    const sendQueued = (ids: readonly string[]) =>
      effects.dispatchEffects(
        ids,
        sessionSenders.createRentalSessionEffectSenders() as unknown as Parameters<
          typeof effects.dispatchEffects
        >[1],
      );

    const effectStatus = async (id: string) => {
      const [row] = await louezDb.db
        .select({ status: louezDb.apiEffects.status, payload: louezDb.apiEffects.payload })
        .from(louezDb.apiEffects)
        .where(eq(louezDb.apiEffects.id, id));
      return row;
    };

    test("a payment recorded after the portal's session was issued: the queued job cancels its row and expires it; the next session charges the new balance", async () => {
      const id = await createReservation("EUR", "30.00", "0.00");
      await addPayment(id, "9.00");
      const first = await start(id);
      assert.ok(!("error" in first), JSON.stringify(first));
      // The store records €5 in cash: the open session still charges €21.
      await addPayment(id, "5.00", { method: "cash", stripePaymentIntentId: null });

      const ids = await queueExpiry(id);
      const [open] = await louezDb.db
        .select({ id: louezDb.payments.id })
        .from(louezDb.payments)
        .where(
          and(
            eq(louezDb.payments.reservationId, id),
            eq(louezDb.payments.stripeCheckoutSessionId, String(first.sessionId)),
          ),
        );
      assert.equal(ids.length, 1);
      assert.deepEqual((await effectStatus(ids[0] ?? ""))?.payload, {
        reservationId: id,
        paymentIds: [open?.id],
      });
      await sendQueued(ids);

      assert.equal((await effectStatus(ids[0] ?? ""))?.status, "sent");
      assert.deepEqual(expired, [first.sessionId]);
      assert.deepEqual((await rowsBySession(id))[String(first.sessionId)], ["21.00", "cancelled"]);
      assert.deepEqual(await settledOf(id), [String(first.sessionId)]);
      const again = await start(id);
      assert.ok(!("error" in again), JSON.stringify(again));
      assert.deepEqual(asked().at(-1), ["eur", 1600]);
    });

    test("the session Stripe took before the job ran is recorded as it is, beyond the lowered total; nothing more is asked", async () => {
      const id = await createReservation("EUR", "30.00", "0.00");
      await addPayment(id, "9.00");
      const session = await balanceSession(id, "21.00");
      // The store lowers the total to €20; the customer pays the €21 session meanwhile.
      await louezDb.db
        .update(louezDb.reservations)
        .set({ totalAmount: "20.00", subtotalAmount: "20.00" })
        .where(eq(louezDb.reservations.id, id));
      const ids = await queueExpiry(id);
      paidAtStripe.set(session, { reservationId: id, amountMinor: 2100 });

      await sendQueued(ids);

      assert.equal((await effectStatus(ids[0] ?? ""))?.status, "sent");
      assert.deepEqual((await rowsBySession(id))[session], ["21.00", "completed"]);
      // €30 paid on €20: the rental is settled, and the portal asks nothing.
      assert.deepEqual(await start(id), { error: "errors.alreadyPaid" });
    });

    test("Stripe not reached: the job fails and is tried again; its row stays cancelled and unsettled", async () => {
      const id = await createReservation("EUR", "30.00", "0.00");
      await addPayment(id, "9.00");
      const session = await balanceSession(id, "21.00");
      replacedAtStripe = "unreachable";
      const ids = await queueExpiry(id);

      await sendQueued(ids);

      assert.equal((await effectStatus(ids[0] ?? ""))?.status, "failed");
      assert.deepEqual((await rowsBySession(id))[session], ["21.00", "cancelled"]);
      assert.deepEqual(await settledOf(id), []);
    });

    test("a session opened after the write is not the job's: it stays open", async () => {
      const id = await createReservation("EUR", "30.00", "0.00");
      await addPayment(id, "9.00");
      const before = await balanceSession(id, "21.00");
      const ids = await queueExpiry(id);
      // Opened since, on the balance the write left.
      await addPayment(id, "21.00", {
        status: "pending",
        stripePaymentIntentId: null,
        stripeCheckoutSessionId: "cs_after_the_write",
        stripeAccountId: "acct_pay_session",
        origin: "customer_session",
      });

      await sendQueued(ids);

      assert.deepEqual(expired, [before]);
      assert.deepEqual((await rowsBySession(id))["cs_after_the_write"], ["21.00", "pending"]);
    });

    test("no session open: a lowering write queues nothing", async () => {
      const id = await createReservation("EUR", "30.00", "0.00");
      await addPayment(id, "9.00");

      assert.deepEqual(await queueExpiry(id), []);
    });

    test("a resumed checkout of a deposit already paid, a balance still due: errors.reservationChangedMeanwhile, never alreadyPaid", async () => {
      const { id } = await openCheckout("30.00");
      await addPayment(id, "30.00");

      const result = await resume(id, 30);

      assert.deepEqual(result, { error: "errors.reservationChangedMeanwhile" });
      assert.equal(sessions.length, 0, "the deposit is never charged twice");
    });

    test("a resumed checkout whose deposit session is paid while the new one is created: nothing installed, the new session expired, errors.reservationChangedMeanwhile", async () => {
      const { id, openSession } = await openCheckout("30.00");
      let completion: { committed: Promise<void> } | undefined;
      // The completion of the replaced session, as checkout.session.completed writes it.
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

      const result = await resume(id, 30);
      await completion?.committed;

      assert.deepEqual(result, { error: "errors.reservationChangedMeanwhile" });
      assert.deepEqual(expired, [openSession, "cs_pay_1"]);
      assert.deepEqual(await stateOf(id), {
        status: "confirmed",
        payments: [{ status: "completed", session: openSession }],
      });
    });
  });
});
