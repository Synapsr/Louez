import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

import { asc, eq } from "drizzle-orm";
import type Stripe from "stripe";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { STORE_KEY } from "./actions-test-stubs";

// The money the dashboard moves on an existing reservation is in the reservation's
// currency, frozen when it was made, whatever the store's is now (invariant M2):
// the deposit hold, its capture, and the refund of a card payment. Stripe is a
// fake that notes what it is asked: no network. The database is real.

// The Stripe client is built from this key the first time it is used, then its
// methods are replaced below: nothing reaches Stripe.
process.env.STRIPE_SECRET_KEY = "sk_test_stub";

const STORE = "store_deposit";
const ACCOUNT = "acct_deposit_currency";
const START = new Date("2031-04-10T09:00:00.000Z");
const END = new Date("2031-04-12T09:00:00.000Z");

type StripeCall =
  | { method: "paymentIntents.create"; amount: number; currency: string; account?: string }
  | { method: "paymentIntents.capture"; intent: string; amount?: number; account?: string }
  | { method: "refunds.create"; charge?: string; amount?: number; account?: string };

describe(
  "the currency of a reservation's Stripe money (database)",
  {
    skip: skipWithoutTestDatabase(),
  },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let actions: typeof import("./actions");
    let counter = 0;
    const calls: StripeCall[] = [];
    /** What the fake charge of a refund still holds, and in which currency. */
    let charge = { amount: 0, currency: "eur" };

    /** The store has moved to this currency since its reservations were booked. */
    const useStore = (currency: string) =>
      Reflect.set(globalThis, STORE_KEY, {
        id: STORE,
        // No user id: analytics skips the event.
        userId: "",
        name: "Deposit currency",
        slug: "deposit-currency",
        settings: { currency },
        stripeAccountId: ACCOUNT,
        stripeChargesEnabled: true,
      });

    before(async () => {
      database = await createTestDatabase("deposit_currency");
      // DATABASE_URL now points at the test database.
      louezDb = await import("@louez/db");
      actions = await import("./actions");

      const { getStripe } = await import("@/lib/stripe/client");
      const stripe = getStripe();
      Reflect.set(
        stripe.paymentIntents,
        "create",
        async (params: Stripe.PaymentIntentCreateParams, options?: Stripe.RequestOptions) => {
          calls.push({
            method: "paymentIntents.create",
            amount: params.amount,
            currency: params.currency,
            account: options?.stripeAccount,
          });
          return { id: `pi_hold_${calls.length}`, status: "requires_capture" };
        },
      );
      Reflect.set(
        stripe.paymentIntents,
        "capture",
        async (
          intent: string,
          params: Stripe.PaymentIntentCaptureParams,
          options?: Stripe.RequestOptions,
        ) => {
          calls.push({
            method: "paymentIntents.capture",
            intent,
            amount: params.amount_to_capture,
            account: options?.stripeAccount,
          });
          return {
            id: intent,
            status: "succeeded",
            amount_received: params.amount_to_capture,
            currency: "jpy",
            latest_charge: "ch_capture",
          };
        },
      );
      Reflect.set(stripe.charges, "retrieve", async () => ({
        refunded: false,
        amount: charge.amount,
        amount_refunded: 0,
      }));
      Reflect.set(
        stripe.refunds,
        "create",
        async (params: Stripe.RefundCreateParams, options?: Stripe.RequestOptions) => {
          calls.push({
            method: "refunds.create",
            charge: params.charge,
            amount: params.amount,
            account: options?.stripeAccount,
          });
          return {
            id: `re_${calls.length}`,
            amount: params.amount,
            status: "succeeded",
            currency: charge.currency,
          };
        },
      );

      await louezDb.db
        .insert(louezDb.stores)
        .values({ id: STORE, userId: "owner_deposit", name: "Deposit currency", slug: "deposit" });
      await louezDb.db.insert(louezDb.customers).values({
        id: "customer_deposit",
        storeId: STORE,
        email: "renter@example.test",
        firstName: "Renter",
        lastName: "Test",
      });
    });

    after(async () => {
      Reflect.deleteProperty(globalThis, STORE_KEY);
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    beforeEach(() => {
      calls.length = 0;
    });

    /** A confirmed reservation with a saved card and its deposit to hold. */
    async function createReservation(options: {
      currency: string | null;
      depositAmount: string;
      depositStatus?: "card_saved" | "authorized";
    }) {
      const id = `res_${++counter}`;
      const held = options.depositStatus === "authorized";
      await louezDb.db.insert(louezDb.reservations).values({
        id,
        storeId: STORE,
        customerId: "customer_deposit",
        number: id,
        status: "confirmed",
        startDate: START,
        endDate: END,
        subtotalAmount: "100.00",
        depositAmount: options.depositAmount,
        totalAmount: "100.00",
        currency: options.currency,
        depositStatus: options.depositStatus ?? "card_saved",
        depositPaymentIntentId: held ? `pi_${id}` : null,
        stripeCustomerId: "cus_deposit",
        stripePaymentMethodId: "pm_deposit",
        source: "manual",
      });
      return id;
    }

    const readPayments = (reservationId: string) =>
      louezDb.db
        .select({
          type: louezDb.payments.type,
          status: louezDb.payments.status,
          amount: louezDb.payments.amount,
          currency: louezDb.payments.currency,
          grossMinor: louezDb.payments.grossMinor,
        })
        .from(louezDb.payments)
        .where(eq(louezDb.payments.reservationId, reservationId))
        .orderBy(asc(louezDb.payments.createdAt), asc(louezDb.payments.type));

    test("a hold is authorized in the reservation's currency, not the store's of today", async () => {
      // Booked in euros; the store has moved to dollars since.
      useStore("USD");
      const frozen = await createReservation({ currency: "EUR", depositAmount: "300.00" });
      // Booked before a reservation had its own currency: the store's.
      const legacy = await createReservation({ currency: null, depositAmount: "300.00" });

      for (const reservationId of [frozen, legacy]) {
        const result = await actions.createDepositHold(reservationId);
        assert.equal(result.error, undefined, reservationId);
      }

      assert.deepEqual(calls, [
        { method: "paymentIntents.create", amount: 30_000, currency: "eur", account: ACCOUNT },
        { method: "paymentIntents.create", amount: 30_000, currency: "usd", account: ACCOUNT },
      ]);
      assert.deepEqual(await readPayments(frozen), [
        {
          type: "deposit_hold",
          status: "authorized",
          amount: "300.00",
          currency: "EUR",
          grossMinor: 30_000,
        },
      ]);
      assert.equal((await readPayments(legacy))[0]?.currency, "USD");
    });

    test("the amount sent has the decimals of the reservation's currency", async () => {
      // Booked in yen, which has no decimals; the store counts in euros now.
      useStore("EUR");
      const reservationId = await createReservation({ currency: "JPY", depositAmount: "30000.00" });

      const result = await actions.createDepositHold(reservationId);

      assert.equal(result.error, undefined);
      // 30 000 yen, not the 3 000 000 a two-decimal currency would send.
      assert.deepEqual(calls, [
        { method: "paymentIntents.create", amount: 30_000, currency: "jpy", account: ACCOUNT },
      ]);
    });

    test("a capture is counted in the reservation's currency", async () => {
      useStore("EUR");
      const reservationId = await createReservation({
        currency: "JPY",
        depositAmount: "30000.00",
        depositStatus: "authorized",
      });

      const result = await actions.captureDepositHold(reservationId, {
        amount: 12_000,
        reason: "Broken wheel",
      });

      assert.equal(result.error, undefined);
      assert.deepEqual(calls, [
        {
          method: "paymentIntents.capture",
          intent: `pi_${reservationId}`,
          amount: 12_000,
          account: ACCOUNT,
        },
      ]);
    });

    test("a card payment is refunded in its own currency, else the reservation's", async () => {
      useStore("EUR");
      const refund = async (paymentCurrency: string | null, reservationCurrency: string | null) => {
        const reservationId = await createReservation({
          currency: reservationCurrency,
          depositAmount: "0.00",
        });
        const paymentId = `pay_${reservationId}`;
        await louezDb.db.insert(louezDb.payments).values({
          id: paymentId,
          reservationId,
          amount: "30000.00",
          type: "rental",
          method: "stripe",
          status: "completed",
          stripeChargeId: `ch_${reservationId}`,
          stripePaymentIntentId: `pi_charge_${reservationId}`,
          currency: paymentCurrency,
        });
        charge = { amount: 30_000, currency: "jpy" };
        calls.length = 0;
        const result = await actions.processStripeRefund(reservationId, {
          type: "rental_refund",
          amount: 12_000,
        });
        assert.equal(result.error, undefined, `${paymentCurrency} / ${reservationCurrency}`);
        const [call] = calls;
        return call?.method === "refunds.create" ? call.amount : null;
      };

      // 12 000 yen: a store on euros would have sent 1 200 000.
      assert.equal(await refund("JPY", "EUR"), 12_000);
      // A payment with no currency stored follows its reservation.
      assert.equal(await refund(null, "JPY"), 12_000);
    });
  },
);
