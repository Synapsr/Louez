import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// The Connect webhook's `checkout.session.completed` on a migrated database, its
// POST run whole, for the account it hears (docs/domain/reservation-changes.md,
// 6a-W2): a session whose payment row records the account it was created on is
// heard from that account only, and its PaymentIntent is read on it; a row that
// records none is heard from the store's connected account of the moment; a
// session with no payment row keeps the store's account. A refused event writes
// nothing and is answered 2xx. The signature check, the log, the fee runner, the
// platform's fees, the senders, the invoicing and Stripe are replaced; Stripe
// answers the PaymentIntent and fails on any other call.

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
  let counter = 0;

  before(async () => {
    database = await createTestDatabase("checkout_completed");
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = "whsec_test";
    louezDb = await import("@louez/db");
    route = await import("./route");

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
  ) => {
    const event = {
      id: nextId("evt"),
      type: "checkout.session.completed",
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
