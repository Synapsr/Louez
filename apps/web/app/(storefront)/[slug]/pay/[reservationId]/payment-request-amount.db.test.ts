import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// A rental payment request never collects more than the rental still owed:
// the page and the session read the request against the reservation. A
// request written before the total went down, or before a payment was
// recorded, is no longer current; nothing is charged and it is left as it is.

const SESSIONS_KEY = "__louezPayRequestSessions";
const STRIPE_SCHEME = "louez-pay-request-stripe:";
// Stripe, as the action sees it: never the real API. A session asked for is noted.
const STRIPE_STUB = `export function toStripeCents(amount) { return Math.round(amount * 100); }
export function toStripeChargeCents(amount) { return Math.round(amount * 100); }
export function fromStripeCents(cents) { return cents / 100; }
export async function createPaymentRequestSession(params) {
  (globalThis[${JSON.stringify(SESSIONS_KEY)}] ??= []).push(params);
  throw new Error("no Stripe in tests");
}\n`;
Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: { parentURL?: string },
    next: (specifier: string, context: unknown) => unknown,
  ) {
    // Next.js-only guards and the file storage SDK.
    if (specifier === "server-only" || specifier === "@/lib/storage/files") {
      return { url: "node:module", shortCircuit: true };
    }
    const parent = context.parentURL ? decodeURIComponent(context.parentURL) : "";
    if (parent.endsWith("/pay/[reservationId]/actions.ts") && specifier === "@/lib/stripe") {
      return { shortCircuit: true, url: `${STRIPE_SCHEME}stripe` };
    }
    return next(specifier, context);
  },
  load(url: string, context: unknown, next: (url: string, context: unknown) => unknown) {
    if (!url.startsWith(STRIPE_SCHEME)) return next(url, context);
    return { shortCircuit: true, format: "module", source: STRIPE_STUB };
  },
});

const STORE = "store_pay_request";
const SLUG = "pay-request";

describe(
  "a rental payment request against what is owed (database)",
  {
    skip: skipWithoutTestDatabase(),
  },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let pay: typeof import("./actions");
    let counter = 0;
    const nextId = (prefix: string) => `${prefix}_${++counter}`;

    before(async () => {
      database = await createTestDatabase("pay_request_amount");
      louezDb = await import("@louez/db");
      pay = await import("./actions");
      await louezDb.db.insert(louezDb.stores).values({
        id: STORE,
        userId: "owner_pay",
        name: "Pay",
        slug: SLUG,
        stripeAccountId: "acct_pay_request",
        stripeChargesEnabled: true,
        onboardingCompleted: true,
        settings: { reservationMode: "request", currency: "EUR", advanceNoticeMinutes: 0 },
      });
      await louezDb.db.insert(louezDb.customers).values({
        id: "customer_pay",
        storeId: STORE,
        email: "renter@example.test",
        firstName: "Renter",
        lastName: "Test",
      });
    });

    after(async () => {
      Reflect.deleteProperty(globalThis, SESSIONS_KEY);
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    /** A signed reservation of `total`, with a rental request of `requested`. */
    async function requested(
      total: string,
      requestedAmount: string,
      paid?: string,
      requestCurrency = "EUR",
    ) {
      const id = nextId("res");
      await louezDb.db.insert(louezDb.reservations).values({
        id,
        storeId: STORE,
        customerId: "customer_pay",
        number: id,
        status: "confirmed",
        startDate: new Date("2031-06-10T09:00:00Z"),
        endDate: new Date("2031-06-12T09:00:00Z"),
        subtotalAmount: total,
        depositAmount: "0.00",
        totalAmount: total,
        currency: "EUR",
        signedAt: new Date("2031-06-01T09:00:00Z"),
      });
      const token = nextId("token");
      const requestId = nextId("req");
      await louezDb.db.insert(louezDb.paymentRequests).values({
        id: requestId,
        storeId: STORE,
        reservationId: id,
        token,
        amount: requestedAmount,
        currency: requestCurrency,
        description: "Rental",
        type: "rental",
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      if (paid) {
        await louezDb.db.insert(louezDb.payments).values({
          id: nextId("pay"),
          reservationId: id,
          amount: paid,
          type: "rental",
          method: "cash",
          status: "completed",
          currency: "EUR",
        });
      }
      return { id, token, requestId };
    }

    const load = (request: { id: string; token: string }) =>
      pay.getPaymentRequestData({ slug: SLUG, reservationId: request.id, token: request.token });

    const open = (request: { id: string; token: string; requestId: string }) =>
      pay.initiatePayment({
        slug: SLUG,
        reservationId: request.id,
        token: request.token,
        paymentRequestId: request.requestId,
      });

    async function requestRow(requestId: string) {
      const [row] = await louezDb.db
        .select({ amount: louezDb.paymentRequests.amount, status: louezDb.paymentRequests.status })
        .from(louezDb.paymentRequests)
        .where(eq(louezDb.paymentRequests.id, requestId));
      return row;
    }

    test("the total went down below the request: no longer current, nothing charged, the request kept", async () => {
      // The total is 50 now; the request was written for 80.
      const request = await requested("50.00", "80.00");

      assert.deepEqual(await load(request), { ok: false, error: "no_longer_current" });
      assert.deepEqual(await open(request), { ok: false, error: "no_longer_current" });
      assert.equal(Reflect.get(globalThis, SESSIONS_KEY), undefined, "no session asked for");
      assert.deepEqual(await requestRow(request.requestId), { amount: "80.00", status: "pending" });
    });

    test("a payment recorded after the request: what remains is less than asked, no longer current", async () => {
      const request = await requested("80.00", "80.00", "30.00");

      assert.deepEqual(await load(request), { ok: false, error: "no_longer_current" });
      assert.deepEqual(await open(request), { ok: false, error: "no_longer_current" });
    });

    test("a request in another currency than the reservation's: no longer current, no session", async () => {
      // A euro reservation owes 100; an older request asks 100 dollars.
      const request = await requested("100.00", "100.00", undefined, "USD");

      assert.deepEqual(await load(request), { ok: false, error: "no_longer_current" });
      assert.deepEqual(await open(request), { ok: false, error: "no_longer_current" });
      assert.equal(Reflect.get(globalThis, SESSIONS_KEY), undefined, "no session asked for");
      assert.deepEqual(await requestRow(request.requestId), { amount: "100.00", status: "pending" });
    });

    test("nothing left to pay: already paid", async () => {
      const request = await requested("80.00", "80.00", "80.00");

      assert.deepEqual(await load(request), { ok: false, error: "already_paid" });
    });

    test("a request equal to what is owed is shown as asked", async () => {
      const request = await requested("80.00", "50.00", "30.00");

      const data = await load(request);
      assert.ok(data.ok, JSON.stringify(data));
      assert.equal(data.paymentRequest.amount, 50);
    });
  },
);
