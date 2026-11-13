import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";
import type Stripe from "stripe";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// The customer's online payment of a reservation: charged in the reservation's
// currency, frozen when it was made, whatever the store's is now, and only a
// payment in that currency has paid it (invariants M2 and M6). Stripe is a fake
// that notes the session it is asked for: no network. The database is real.

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
        return {
          id: `cs_pay_${sessions.length}`,
          url: "https://checkout.stripe.test/pay",
          expires_at: 1_900_000_000,
        };
      },
    );

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
});
