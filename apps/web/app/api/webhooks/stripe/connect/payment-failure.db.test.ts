import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type {
  FailedPaymentIntent,
  FailedPaymentReservation,
  PaymentFailureDeps,
} from "./payment-failure";

// `payment_intent.payment_failed` on a migrated database: each Stripe event is
// recorded, and tells the owner, once. A redelivered event changes nothing and
// notifies nobody; each failed attempt of one PaymentIntent is its own event. The
// senders are fakes.

// The email logo helper imports "server-only", which throws outside Next.
Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: unknown,
    next: (specifier: string, context: unknown) => unknown,
  ) {
    return specifier === "server-only"
      ? { url: "node:module", shortCircuit: true }
      : next(specifier, context);
  },
});

const STORE = "store_pay_failure";

describe("payment_intent.payment_failed (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let failure: typeof import("./payment-failure");
  let counter = 0;

  before(async () => {
    database = await createTestDatabase("payment_failure");
    louezDb = await import("@louez/db");
    failure = await import("./payment-failure");
    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: "owner",
      name: "Payment failures",
      slug: "payment-failures",
    });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  const createReservation = async (source: "online" | "marketplace" = "online") => {
    const id = `res_pf_${++counter}`;
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId: STORE,
      customerId: "customer",
      number: id,
      status: "pending",
      source,
      startDate: new Date("2027-05-01T09:00:00Z"),
      endDate: new Date("2027-05-03T09:00:00Z"),
      subtotalAmount: "120.00",
      depositAmount: "0.00",
      totalAmount: "120.00",
      currency: "EUR",
    });
    const reservation: FailedPaymentReservation = {
      id,
      number: id,
      source,
      startDate: new Date("2027-05-01T09:00:00Z"),
      endDate: new Date("2027-05-03T09:00:00Z"),
      totalAmount: "120.00",
      currency: "EUR",
      store: {
        id: STORE,
        name: "Payment failures",
        slug: "payment-failures",
        email: "owner@failures.test",
        discordWebhookUrl: null,
        ownerPhone: null,
        notificationSettings: null,
        settings: null,
      },
      customer: { firstName: "Léa", lastName: "Martin", email: "lea@example.test", phone: null },
    };
    return reservation;
  };

  const intent = (
    reservationId: string,
    paymentIntentId: string,
    type: "rental" | "deposit_hold" = "rental",
  ): FailedPaymentIntent => ({
    id: paymentIntentId,
    amount: 8_000,
    currency: "usd",
    metadata: { reservationId, type },
    last_payment_error: null,
  });

  const fakeDeps = () => {
    const sent: { owner: number; platform: number; marketplace: number; currencies: string[] } = {
      owner: 0,
      platform: 0,
      marketplace: 0,
      currencies: [],
    };
    const deps: PaymentFailureDeps = {
      dispatchNotification: async (_event, ctx) => {
        sent.owner += 1;
        if (ctx.payment?.currency) sent.currencies.push(ctx.payment.currency);
        return {
          email: { sent: true },
          sms: { sent: false },
          discord: { sent: false },
          push: { sent: false },
        };
      },
      notifyPaymentFailed: async () => {
        sent.platform += 1;
      },
      failMarketplaceBookingAttempt: async () => {
        sent.marketplace += 1;
      },
    };
    return { deps, sent };
  };

  const activities = async (reservationId: string) =>
    louezDb.db
      .select({ type: louezDb.reservationActivity.activityType })
      .from(louezDb.reservationActivity)
      .where(eq(louezDb.reservationActivity.reservationId, reservationId));

  test("a redelivered event emails the owner once, a second failed attempt again", async () => {
    const reservation = await createReservation();
    const paymentIntent = intent(reservation.id, `pi_pf_${counter}`);
    const { deps, sent } = fakeDeps();
    const handle = (stripeEventId: string) =>
      failure.handlePaymentFailure({ reservation, stripeEventId, paymentIntent }, deps);

    await handle("evt_first_attempt");
    await handle("evt_first_attempt");
    assert.equal(sent.owner, 1);
    assert.equal(sent.platform, 1);
    assert.equal((await activities(reservation.id)).length, 1);

    // The customer tries again and the card is declined again: a new event.
    await handle("evt_second_attempt");
    assert.equal(sent.owner, 2);
    assert.equal((await activities(reservation.id)).length, 2);
    assert.deepEqual(sent.currencies, ["USD", "USD"]);
  });

  test("two deliveries of one event at the same time record and notify once", async () => {
    const reservation = await createReservation();
    const paymentIntent = intent(reservation.id, `pi_pf_${counter}`);
    const { deps, sent } = fakeDeps();
    await Promise.all(
      [1, 2].map(() =>
        failure.handlePaymentFailure(
          { reservation, stripeEventId: "evt_concurrent", paymentIntent },
          deps,
        ),
      ),
    );
    assert.equal(sent.owner, 1);
    assert.equal((await activities(reservation.id)).length, 1);
  });

  test("a payment row is marked failed once", async () => {
    const reservation = await createReservation();
    const paymentIntentId = `pi_pf_${counter}`;
    await louezDb.db.insert(louezDb.payments).values({
      id: `pay_pf_${counter}`,
      reservationId: reservation.id,
      amount: "80.00",
      type: "rental",
      method: "stripe",
      status: "pending",
      stripePaymentIntentId: paymentIntentId,
      currency: "USD",
    });
    const { deps, sent } = fakeDeps();
    const paymentIntent = intent(reservation.id, paymentIntentId);
    await failure.handlePaymentFailure(
      { reservation, stripeEventId: "evt_row", paymentIntent },
      deps,
    );
    await failure.handlePaymentFailure(
      { reservation, stripeEventId: "evt_row", paymentIntent },
      deps,
    );

    const [row] = await louezDb.db
      .select({ status: louezDb.payments.status })
      .from(louezDb.payments)
      .where(eq(louezDb.payments.stripePaymentIntentId, paymentIntentId));
    assert.equal(row?.status, "failed");
    assert.equal(sent.owner, 1);
  });

  test("a failed event of a payment that later went through is ignored", async () => {
    const reservation = await createReservation("marketplace");
    const paymentIntentId = `pi_pf_${counter}`;
    await louezDb.db.insert(louezDb.payments).values({
      id: `pay_pf_${counter}`,
      reservationId: reservation.id,
      amount: "80.00",
      type: "rental",
      method: "stripe",
      status: "completed",
      stripePaymentIntentId: paymentIntentId,
      currency: "USD",
    });
    const { deps, sent } = fakeDeps();
    await failure.handlePaymentFailure(
      {
        reservation,
        stripeEventId: "evt_stale",
        paymentIntent: intent(reservation.id, paymentIntentId),
      },
      deps,
    );
    assert.deepEqual(sent, { owner: 0, platform: 0, marketplace: 0, currencies: [] });
    assert.equal((await activities(reservation.id)).length, 0);
  });

  test("a failed deposit hold is recorded and notified once", async () => {
    const reservation = await createReservation();
    const paymentIntent = intent(reservation.id, `pi_pf_${counter}`, "deposit_hold");
    const { deps, sent } = fakeDeps();
    for (const _delivery of [1, 2]) {
      await failure.handlePaymentFailure(
        { reservation, stripeEventId: "evt_deposit", paymentIntent },
        deps,
      );
    }
    const [row] = await louezDb.db
      .select({ depositStatus: louezDb.reservations.depositStatus })
      .from(louezDb.reservations)
      .where(eq(louezDb.reservations.id, reservation.id));
    assert.equal(row?.depositStatus, "failed");
    assert.deepEqual(await activities(reservation.id), [{ type: "deposit_failed" }]);
    assert.equal(sent.owner, 1);
  });

  test("a marketplace attempt is expired on every delivery, the owner told once", async () => {
    const reservation = await createReservation("marketplace");
    const paymentIntent = intent(reservation.id, `pi_pf_${counter}`);
    const { deps, sent } = fakeDeps();
    for (const _delivery of [1, 2]) {
      await failure.handlePaymentFailure(
        { reservation, stripeEventId: "evt_marketplace", paymentIntent },
        deps,
      );
    }
    assert.equal(sent.marketplace, 2);
    assert.equal(sent.owner, 1);
  });
});
