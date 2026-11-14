import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";
import type Stripe from "stripe";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// The Connect webhook's `checkout.session.completed` on a migrated database, its
// POST run whole, for the account it hears (docs/domain/reservation-changes.md,
// 6a-W2): a session whose payment row records the account it was created on is
// heard from that account only, and its PaymentIntent is read on it; a row that
// records none is heard from the store's connected account of the moment; a
// session with no payment row keeps the store's account. An event of the other mode
// than the deployment's key is refused before it is read. A refused event writes
// nothing and is answered 2xx. A resumed payment whose replaced session was paid
// gets no second session, and that session's completion records it. The
// signature check, the log, the fee runner, the platform's fees, the senders,
// the invoicing and Stripe are replaced; the webhook's Stripe answers the
// PaymentIntent and fails on any other call.

const directory = mkdtempSync(join(tmpdir(), "louez-checkout-completed-"));
const stubsPath = join(directory, "stubs.cjs");
writeFileSync(stubsPath, "module.exports = globalThis.__louezCheckoutCompletedStubs;");
after(() => rmSync(directory, { recursive: true }));

/** What each module of the completion has replaced, by the module that imports it. */
const STUBBED: Record<string, ReadonlySet<string>> = {
  "/api/webhooks/stripe/connect/route.ts": new Set([
    "next/headers",
    "@/lib/stripe/client",
    "@/lib/evlog",
    "@/lib/billing/reservation-effects",
    "@/lib/discord/platform-notifications",
    "@/lib/pay-as-you-go",
  ]),
  "/lib/reservations/complete-checkout-payment.ts": new Set([
    "@/lib/billing/reservation-effects",
    "@/lib/discord/platform-notifications",
    "@/lib/evlog",
    "@/lib/integrations/calendar/sync",
    "@/lib/invoicing/delivery",
    "@/lib/invoicing/service",
    "@/lib/notifications/customer-dispatcher",
    "@/lib/notifications/dispatcher",
    "@/lib/product-analytics/analytics",
    "@/lib/stripe/client",
  ]),
};

type Call = [name: string, ...args: unknown[]];
const calls: Call[] = [];
const record =
  (name: string, answer: () => unknown = () => undefined) =>
  (...args: unknown[]) => {
    calls.push([name, ...structuredClone(args)]);
    return answer();
  };
const unexpected = (name: string) => () => {
  throw new Error(`Unexpected Stripe call: ${name}`);
};

Reflect.set(globalThis, "__louezCheckoutCompletedStubs", {
  headers: async () => new Headers({ "stripe-signature": "t=1,v1=test" }),
  stripe: {
    webhooks: {
      // The signature is not checked: the body is the event.
      constructEvent: (body: string) => JSON.parse(body),
    },
    paymentIntents: {
      // The account it is read on, and the PaymentIntent of a paid card.
      retrieve: async (
        id: string,
        _params: unknown,
        options: { stripeAccount?: string } | undefined,
      ) => {
        calls.push(["stripe.paymentIntents.retrieve", id, options?.stripeAccount]);
        return {
          id,
          customer: "cus_stripe_ada",
          payment_method: "pm_card_ada",
          application_fee_amount: 0,
          metadata: {},
          latest_charge: { id: `ch_${id}`, created: 1_800_000_000, application_fee: null },
        };
      },
    },
    checkout: { sessions: { retrieve: unexpected("checkout.sessions.retrieve") } },
  },
  log: { error: record("log.error"), warn: record("log.warn"), info: record("log.info") },
  runReservationEffects: record("runReservationEffects"),
  notifyStripeConnected: unexpected("notifyStripeConnected"),
  notifyPaymentReceived: record("notifyPaymentReceived", async () => {}),
  notifyReservationConfirmed: record("notifyReservationConfirmed", async () => {}),
  // A store on a subscription, whose online payment carries no platform fee.
  getStoreBilling: async () => ({ billingMode: "subscription" }),
  parseFeeMetadata: () => ({ reservationFeeCents: 0, marketplaceFeeCents: 0, hasBreakdown: false }),
  recordReservationFee: record("recordReservationFee"),
  recordMarketplaceFee: record("recordMarketplaceFee"),
  markReservationForCalendarSync: record("markReservationForCalendarSync"),
  tryPrepareInitialInvoiceEmailDelivery: async () => ({
    attachments: [],
    contractSignatureUrl: null,
  }),
  tryGenerateInvoiceForPayment: async () => ({ success: true }),
  dispatchCustomerNotification: async () => ({}),
  dispatchNotification: async () => ({}),
  captureProductServerEvent: async () => {},
  toAnalyticsAmountCents: () => null,
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
    for (const [module, replaced] of Object.entries(STUBBED)) {
      if (parent.endsWith(module) && replaced.has(specifier)) {
        return { url: pathToFileURL(stubsPath).href, shortCircuit: true };
      }
    }
    return next(specifier, context);
  },
});

/** A store that left PREVIOUS_ACCOUNT for TODAY_ACCOUNT. */
const STORE = "store_chk_completed";
const PREVIOUS_ACCOUNT = "acct_checkout_completed_previous";
const TODAY_ACCOUNT = "acct_checkout_completed_today";

describe("checkout.session.completed (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let route: typeof import("./route");
  let paymentSession: typeof import("@/lib/reservations/payment-session");
  /** The payment session's calls to Stripe, with the account each was made on. */
  const resumeCalls: [string, string, string | undefined][] = [];
  let counter = 0;

  before(async () => {
    database = await createTestDatabase("checkout_completed");
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = "whsec_test";
    // The deployment's key: a test one, so it hears test events.
    process.env.STRIPE_SECRET_KEY = "sk_test_checkout_completed";
    louezDb = await import("@louez/db");
    route = await import("./route");
    paymentSession = await import("@/lib/reservations/payment-session");
    // The payment session's Stripe: a replaced session was paid, so Stripe no
    // longer expires it, and reads it complete.
    const { getStripe } = await import("@/lib/stripe/client");
    const sessionsApi = getStripe().checkout.sessions;
    Reflect.set(
      sessionsApi,
      "create",
      async (_params: unknown, options?: Stripe.RequestOptions) => {
        resumeCalls.push(["create", "", options?.stripeAccount]);
        throw new Error("No session is created here");
      },
    );
    Reflect.set(sessionsApi, "expire", async (id: string, options?: Stripe.RequestOptions) => {
      resumeCalls.push(["expire", id, options?.stripeAccount]);
      throw new Error("This Checkout Session is not in an expireable state.");
    });
    Reflect.set(sessionsApi, "retrieve", async (id: string, options?: Stripe.RequestOptions) => {
      resumeCalls.push(["retrieve", id, options?.stripeAccount]);
      return { id, status: "complete", payment_status: "paid" };
    });

    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: "owner",
      name: "Completed",
      slug: "checkout-completed",
      email: "shop@completed.test",
      stripeAccountId: TODAY_ACCOUNT,
      stripeChargesEnabled: true,
      settings: { reservationMode: "payment", currency: "EUR", advanceNoticeMinutes: 0 },
    });
    await louezDb.db.insert(louezDb.customers).values({
      id: "cus_completed",
      storeId: STORE,
      email: "ada@completed.test",
      firstName: "Ada",
      lastName: "Customer",
    });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(() => {
    calls.length = 0;
    resumeCalls.length = 0;
  });

  // A reservation id of Louez's shape: 21 characters.
  const nextId = (prefix: string) =>
    `${prefix}_${String(++counter).padStart(20 - prefix.length, "0")}`;

  /** A storefront checkout's pending booking; its session's row records `stripeAccountId`. */
  async function checkout(stripeAccountId: string | null, { row = true } = {}) {
    const id = nextId("res");
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId: STORE,
      customerId: "cus_completed",
      number: id,
      status: "pending",
      startDate: new Date("2030-06-01T09:00:00Z"),
      endDate: new Date("2030-06-03T09:00:00Z"),
      subtotalAmount: "10.00",
      depositAmount: "0.00",
      totalAmount: "10.00",
      currency: "EUR",
      source: "online",
    });
    const sessionId = `cs_${id}`;
    if (row) {
      await louezDb.db.insert(louezDb.payments).values({
        id: nextId("pay"),
        reservationId: id,
        amount: "10.00",
        type: "rental",
        method: "stripe",
        status: "pending",
        stripeCheckoutSessionId: sessionId,
        origin: "checkout",
        currency: "EUR",
        stripeAccountId,
      });
    }
    return { id, sessionId };
  }

  /** The event, sent by `account`; null: an event that names no account. */
  const complete = async (
    booking: { id: string; sessionId: string },
    account: string | null,
    metadata: Record<string, string> = {
      reservationId: booking.id,
      checkoutFlow: "storefront_checkout",
    },
    // The event's mode, and its id when a case reads it back.
    { livemode = false, eventId = nextId("evt") }: { livemode?: boolean; eventId?: string } = {},
  ) => {
    const event = {
      id: eventId,
      type: "checkout.session.completed",
      livemode,
      ...(account !== null && { account }),
      data: {
        object: {
          id: booking.sessionId,
          object: "checkout.session",
          mode: "payment",
          payment_status: "paid",
          payment_intent: `pi_${booking.id}`,
          customer: "cus_stripe_ada",
          currency: "eur",
          amount_total: 1000,
          metadata,
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

  /** How many lines the reservation's history holds: none after a refused event. */
  async function historyLines(id: string) {
    const lines = await louezDb.db
      .select({ id: louezDb.reservationActivity.id })
      .from(louezDb.reservationActivity)
      .where(eq(louezDb.reservationActivity.reservationId, id));
    return lines.length;
  }

  /** The reservation's status and its payment rows. */
  async function stateOf(id: string) {
    const [reservation] = await louezDb.db
      .select({ status: louezDb.reservations.status })
      .from(louezDb.reservations)
      .where(eq(louezDb.reservations.id, id));
    const payments = await louezDb.db
      .select({
        status: louezDb.payments.status,
        stripeAccountId: louezDb.payments.stripeAccountId,
        stripePaymentIntentId: louezDb.payments.stripePaymentIntentId,
      })
      .from(louezDb.payments)
      .where(eq(louezDb.payments.reservationId, id));
    return { status: reservation?.status, payments };
  }

  const stripeReads = () => calls.filter(([name]) => name.startsWith("stripe."));
  /** The webhook's log of a completion it ran on the reservation. */
  const completedLog = (id: string) =>
    calls.find(([name, logged]) => {
      const entry = (logged as { stripeWebhook?: { event?: string; reservationId?: string } })
        .stripeWebhook;
      return (
        name === "log.info" &&
        entry?.event === "checkout_session_completed" &&
        entry.reservationId === id
      );
    });

  const accountMismatch = (
    booking: { id: string; sessionId: string },
    expected: string,
    received: string,
  ) => [
    "log.error",
    {
      stripeWebhook: {
        event: "checkout.session.completed",
        issue: "connected_account_mismatch",
        expected,
        received,
        reservationId: booking.id,
        sessionId: booking.sessionId,
      },
    },
  ];

  test("a storefront checkout paid on the account its row records, the store reconnected since: recorded and confirmed, the PaymentIntent read on that account", async () => {
    const booking = await checkout(PREVIOUS_ACCOUNT);

    assert.deepEqual(await complete(booking, PREVIOUS_ACCOUNT), {
      status: 200,
      body: { received: true },
    });

    assert.deepEqual(stripeReads(), [
      ["stripe.paymentIntents.retrieve", `pi_${booking.id}`, PREVIOUS_ACCOUNT],
    ]);
    assert.deepEqual(await stateOf(booking.id), {
      status: "confirmed",
      payments: [
        {
          status: "completed",
          stripeAccountId: PREVIOUS_ACCOUNT,
          stripePaymentIntentId: `pi_${booking.id}`,
        },
      ],
    });
    assert.ok(completedLog(booking.id), JSON.stringify(calls));
  });

  test("a session paid after a resumed checkout cancelled its row: recorded and confirmed", async () => {
    const booking = await checkout(TODAY_ACCOUNT);
    // The resume cancels the open row before it expires the session at Stripe;
    // the customer paid it meanwhile.
    await louezDb.db
      .update(louezDb.payments)
      .set({ status: "cancelled" })
      .where(eq(louezDb.payments.stripeCheckoutSessionId, booking.sessionId));

    assert.deepEqual(await complete(booking, TODAY_ACCOUNT), {
      status: 200,
      body: { received: true },
    });

    assert.deepEqual(await stateOf(booking.id), {
      status: "confirmed",
      payments: [
        {
          status: "completed",
          stripeAccountId: TODAY_ACCOUNT,
          stripePaymentIntentId: `pi_${booking.id}`,
        },
      ],
    });
    assert.ok(completedLog(booking.id), JSON.stringify(calls));
  });

  test("a resume whose replaced session was paid at Stripe, its completion not yet delivered: no second session, errors.alreadyPaid; then the completion records it and confirms", async () => {
    // The session was created on the account the store has left since.
    const booking = await checkout(PREVIOUS_ACCOUNT);

    const result = await paymentSession.createReservationPaymentSessionForCustomer(
      "checkout-completed",
      booking.id,
      "cus_completed",
      "checkout_resume",
      { allowPendingReservation: true, chargeAmount: 10 },
    );

    assert.deepEqual(result, { error: "errors.alreadyPaid" });
    // Expired, then read, on the account its row records; no session created.
    assert.deepEqual(resumeCalls, [
      ["expire", booking.sessionId, PREVIOUS_ACCOUNT],
      ["retrieve", booking.sessionId, PREVIOUS_ACCOUNT],
    ]);
    // Its row as before the resume: pending, nothing else.
    assert.deepEqual(await stateOf(booking.id), {
      status: "pending",
      payments: [
        { status: "pending", stripeAccountId: PREVIOUS_ACCOUNT, stripePaymentIntentId: null },
      ],
    });

    assert.deepEqual(await complete(booking, PREVIOUS_ACCOUNT), {
      status: 200,
      body: { received: true },
    });

    assert.deepEqual(await stateOf(booking.id), {
      status: "confirmed",
      payments: [
        {
          status: "completed",
          stripeAccountId: PREVIOUS_ACCOUNT,
          stripePaymentIntentId: `pi_${booking.id}`,
        },
      ],
    });
  });

  test("a session paid before its deadline and not yet recorded, older than its lifetime: two resumes in a row each answer errors.alreadyPaid and leave its row pending; then its completion records it", async () => {
    const booking = await checkout(TODAY_ACCOUNT);
    // Created forty minutes ago: past a session's lifetime and the clocks' margin.
    await louezDb.db
      .update(louezDb.payments)
      .set({ createdAt: new Date(Date.now() - 40 * 60 * 1000) })
      .where(eq(louezDb.payments.stripeCheckoutSessionId, booking.sessionId));
    const resume = () =>
      paymentSession.createReservationPaymentSessionForCustomer(
        "checkout-completed",
        booking.id,
        "cus_completed",
        "checkout_resume",
        { allowPendingReservation: true, chargeAmount: 10 },
      );

    for (const run of ["first", "second"]) {
      assert.deepEqual(await resume(), { error: "errors.alreadyPaid" }, run);
      assert.deepEqual(
        (await stateOf(booking.id)).payments.map((payment) => payment.status),
        ["pending"],
        `${run}: the row back to pending`,
      );
    }
    assert.ok(
      resumeCalls.every(([call]) => call !== "create"),
      `no session created: ${JSON.stringify(resumeCalls)}`,
    );

    assert.deepEqual(await complete(booking, TODAY_ACCOUNT), {
      status: 200,
      body: { received: true },
    });

    assert.deepEqual(await stateOf(booking.id), {
      status: "confirmed",
      payments: [
        {
          status: "completed",
          stripeAccountId: TODAY_ACCOUNT,
          stripePaymentIntentId: `pi_${booking.id}`,
        },
      ],
    });
  });

  test("a session its row records under the previous account, sent by the store's account of today: connected_account_mismatch logged, nothing written", async () => {
    const booking = await checkout(PREVIOUS_ACCOUNT);

    assert.deepEqual(await complete(booking, TODAY_ACCOUNT), {
      status: 200,
      body: { received: true },
    });

    assert.deepEqual(calls, [accountMismatch(booking, PREVIOUS_ACCOUNT, TODAY_ACCOUNT)]);
    assert.deepEqual(await stateOf(booking.id), {
      status: "pending",
      payments: [
        { status: "pending", stripeAccountId: PREVIOUS_ACCOUNT, stripePaymentIntentId: null },
      ],
    });
    assert.equal(await historyLines(booking.id), 0);
  });

  test("a row that records no account, sent by the store's account: recorded and confirmed, the PaymentIntent read on it", async () => {
    const booking = await checkout(null);

    assert.deepEqual(await complete(booking, TODAY_ACCOUNT), {
      status: 200,
      body: { received: true },
    });

    assert.deepEqual(stripeReads(), [
      ["stripe.paymentIntents.retrieve", `pi_${booking.id}`, TODAY_ACCOUNT],
    ]);
    assert.deepEqual(await stateOf(booking.id), {
      status: "confirmed",
      payments: [
        {
          status: "completed",
          stripeAccountId: TODAY_ACCOUNT,
          stripePaymentIntentId: `pi_${booking.id}`,
        },
      ],
    });
  });

  test("a row that records no account, sent by the account the store left: connected_account_mismatch logged, nothing written", async () => {
    const booking = await checkout(null);

    assert.deepEqual(await complete(booking, PREVIOUS_ACCOUNT), {
      status: 200,
      body: { received: true },
    });

    assert.deepEqual(calls, [accountMismatch(booking, TODAY_ACCOUNT, PREVIOUS_ACCOUNT)]);
    assert.deepEqual(await stateOf(booking.id), {
      status: "pending",
      payments: [{ status: "pending", stripeAccountId: null, stripePaymentIntentId: null }],
    });
    assert.equal(await historyLines(booking.id), 0);
  });

  test("a session its row names, sent with no account: connected_account_missing logged, nothing written", async () => {
    const booking = await checkout(PREVIOUS_ACCOUNT);

    assert.deepEqual(await complete(booking, null), { status: 200, body: { received: true } });

    assert.deepEqual(calls, [
      [
        "log.error",
        {
          stripeWebhook: {
            event: "checkout.session.completed",
            issue: "connected_account_missing",
            reservationId: booking.id,
            sessionId: booking.sessionId,
          },
        },
      ],
    ]);
    assert.deepEqual(await stateOf(booking.id), {
      status: "pending",
      payments: [
        { status: "pending", stripeAccountId: PREVIOUS_ACCOUNT, stripePaymentIntentId: null },
      ],
    });
    assert.equal(await historyLines(booking.id), 0);
  });

  test("a live event under the deployment's test key: livemode_mismatch logged, nothing read, written or sent", async () => {
    const booking = await checkout(TODAY_ACCOUNT);
    const eventId = nextId("evt");

    assert.deepEqual(
      await complete(
        booking,
        TODAY_ACCOUNT,
        { reservationId: booking.id, checkoutFlow: "storefront_checkout" },
        { livemode: true, eventId },
      ),
      { status: 200, body: { received: true } },
    );

    assert.deepEqual(calls, [
      [
        "log.error",
        {
          stripeWebhook: {
            event: "checkout.session.completed",
            issue: "livemode_mismatch",
            stripeEventId: eventId,
            objectId: booking.sessionId,
            accountId: TODAY_ACCOUNT,
            livemode: true,
          },
        },
      ],
    ]);
    assert.deepEqual(await stateOf(booking.id), {
      status: "pending",
      payments: [
        { status: "pending", stripeAccountId: TODAY_ACCOUNT, stripePaymentIntentId: null },
      ],
    });
    assert.equal(await historyLines(booking.id), 0);
  });

  test("a session with no payment row (a payment request's) keeps the store's account: the account the store left is refused", async () => {
    const booking = await checkout(null, { row: false });

    assert.deepEqual(
      await complete(booking, PREVIOUS_ACCOUNT, {
        reservationId: booking.id,
        paymentRequestId: nextId("prq"),
      }),
      { status: 200, body: { received: true } },
    );

    assert.deepEqual(calls, [accountMismatch(booking, TODAY_ACCOUNT, PREVIOUS_ACCOUNT)]);
    assert.deepEqual(await stateOf(booking.id), { status: "pending", payments: [] });
    assert.equal(await historyLines(booking.id), 0);
  });
});
