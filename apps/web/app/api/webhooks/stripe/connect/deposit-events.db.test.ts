import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, describe, test } from "node:test";

import { and, eq } from "drizzle-orm";

import type { ApiEffectSenders } from "@louez/api/platform/effects";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { DepositHoldDeps } from "@/lib/reservations/deposit-hold";
import {
  type FakeDepositStripe,
  fakeDepositStripe,
} from "@/lib/reservations/fake-deposit-stripe.fixtures";

import type { DepositEvent, DepositEventDeps } from "./deposit-events";
import type { PaymentFailureDeps } from "./payment-failure";

// The Connect webhook's deposit events on a migrated database, with Stripe faked:
// events delivered late, twice or out of order, next to the dashboard's own capture
// and release. What the rows say is what the fake Stripe holds, per connected account.

// The store's notifications import "server-only", which throws outside Next.
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

const STORE = "store_deposit_events";
const ACCOUNT = "acct_deposit_events";
/** A store that changes connected accounts. */
const MOVING_STORE = "store_deposit_moving";
const FIRST_ACCOUNT = "acct_deposit_first";
const NEXT_ACCOUNT = "acct_deposit_next";

type EventType = DepositEvent["type"];

describe("deposit hold events (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let hold: typeof import("@/lib/reservations/deposit-hold");
  let holdWrites: typeof import("@/lib/reservations/deposit-hold-writes");
  let events: typeof import("./deposit-events");
  let outbox: typeof import("@louez/api/platform/effects");
  let holdEffects: typeof import("@/lib/reservations/deposit-hold-effects");
  let counter = 0;
  /** The outbox rows the writes handed to the dispatcher, not run yet. */
  const handedOver: string[] = [];

  before(async () => {
    database = await createTestDatabase("deposit_events");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    hold = await import("@/lib/reservations/deposit-hold");
    holdWrites = await import("@/lib/reservations/deposit-hold-writes");
    events = await import("./deposit-events");
    outbox = await import("@louez/api/platform/effects");
    holdEffects = await import("@/lib/reservations/deposit-hold-effects");
    await louezDb.db.insert(louezDb.stores).values([
      {
        id: STORE,
        userId: "owner",
        name: "Deposit events",
        slug: "deposit-events",
        stripeAccountId: ACCOUNT,
      },
      {
        id: MOVING_STORE,
        userId: "owner",
        name: "Deposit moving",
        slug: "deposit-moving",
        stripeAccountId: FIRST_ACCOUNT,
      },
    ]);
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  /** A reservation whose customer saved a card; its id is 21 characters, as a nanoid is. */
  async function createReservation(
    options: { storeId?: string; depositStatus?: "card_saved" | "pending" } = {},
  ) {
    const id = `res_events_${String(++counter).padStart(10, "0")}`;
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId: options.storeId ?? STORE,
      customerId: "customer",
      number: `E-${counter}`,
      status: "confirmed",
      startDate: new Date("2026-03-12T09:00:00.000Z"),
      endDate: new Date("2026-03-14T09:00:00.000Z"),
      subtotalAmount: "100.00",
      depositAmount: "50.00",
      totalAmount: "100.00",
      depositStatus: options.depositStatus ?? "card_saved",
      currency: "EUR",
      stripeCustomerId: "cus_stripe",
      stripePaymentMethodId: "pm_card",
      source: "manual",
    });
    return id;
  }

  async function readDeposit(reservationId: string) {
    const r = louezDb.reservations;
    const [row] = await louezDb.db
      .select({ status: r.depositStatus, paymentIntentId: r.depositPaymentIntentId })
      .from(r)
      .where(eq(r.id, reservationId));
    return row;
  }

  /**
   * Each hold row as `[status, PaymentIntent, account]`, sorted; `release_owed` for an
   * authorization Louez decided against and Stripe has not confirmed released.
   */
  async function holdStates(reservationId: string) {
    const p = louezDb.payments;
    const rows = await louezDb.db
      .select({
        status: p.status,
        paymentIntentId: p.stripePaymentIntentId,
        accountId: p.stripeAccountId,
        releaseOwedAt: p.releaseOwedAt,
      })
      .from(p)
      .where(and(eq(p.reservationId, reservationId), eq(p.type, "deposit_hold")));
    return rows
      .map((row) => [
        row.releaseOwedAt ? "release_owed" : row.status,
        row.paymentIntentId,
        row.accountId,
      ])
      .sort();
  }

  async function readCaptures(reservationId: string) {
    const p = louezDb.payments;
    return louezDb.db
      .select({ paymentIntentId: p.stripePaymentIntentId, amount: p.amount })
      .from(p)
      .where(and(eq(p.reservationId, reservationId), eq(p.type, "deposit_capture")));
  }

  async function readActivity(reservationId: string) {
    const a = louezDb.reservationActivity;
    const rows = await louezDb.db
      .select({ type: a.activityType })
      .from(a)
      .where(eq(a.reservationId, reservationId));
    return rows.map((row) => row.type).sort();
  }

  /** Stripe, with the reservations' card saved on its customer on both accounts in use. */
  const stripeWithCard = () => {
    const stripe = fakeDepositStripe();
    stripe.saveCard(ACCOUNT, "pm_card", "cus_stripe");
    stripe.saveCard(FIRST_ACCOUNT, "pm_card", "cus_stripe");
    return stripe;
  };

  const holdDeps = (stripe: FakeDepositStripe): DepositHoldDeps => ({
    database: louezDb.db,
    stripe: stripe.port,
    dispatchEffects: (ids) => {
      handedOver.push(...ids);
    },
  });

  /** Runs the outbox rows handed over so far, as the app does once it has answered. */
  const runHandedOver = (stripe: FakeDepositStripe) =>
    outbox.dispatchEffects(handedOver.splice(0), {
      ...holdEffects.createDepositHoldEffectSenders({
        database: louezDb.db,
        stripe: stripe.port,
      }),
    } as ApiEffectSenders);

  /** The owner's alerts of failed payments, by reservation number. */
  const alerts: string[] = [];
  /** The capture rows an invoice was asked for. */
  const invoiced: string[] = [];

  const counting: PaymentFailureDeps = {
    dispatchNotification: async (_type, context) => {
      alerts.push(context.reservation?.number ?? "");
      return {
        email: { sent: false },
        sms: { sent: false },
        discord: { sent: false },
        push: { sent: false },
      };
    },
    notifyPaymentFailed: async () => {},
  };

  const eventDeps = (stripe: FakeDepositStripe): DepositEventDeps => ({
    ...holdDeps(stripe),
    generateInvoice: async (capturePaymentId) => {
      invoiced.push(capturePaymentId);
    },
    paymentFailure: counting,
  });

  /** The event Stripe sends about a PaymentIntent, from the account that holds it. */
  const eventOf = (
    type: EventType,
    stripe: FakeDepositStripe,
    accountId: string,
    paymentIntentId: string,
  ): DepositEvent => {
    const intent = stripe.intentOf(accountId, paymentIntentId);
    return {
      type,
      stripeEventId: `evt_${++counter}`,
      accountId,
      paymentIntent: {
        id: intent.id,
        amount: intent.amountMinor,
        currency: intent.currency.toLowerCase(),
        metadata: {
          type: "deposit_hold",
          ...(intent.reservationId ? { reservationId: intent.reservationId } : {}),
          ...(intent.attemptId ? { depositHoldAttemptId: intent.attemptId } : {}),
        },
        last_payment_error: null,
      },
    };
  };

  const deliver = (
    type: EventType,
    stripe: FakeDepositStripe,
    paymentIntentId: string,
    accountId = ACCOUNT,
    deps: DepositEventDeps = eventDeps(stripe),
  ) => events.handleDepositEvent(eventOf(type, stripe, accountId, paymentIntentId), deps);

  const request = (reservationId: string, stripe: FakeDepositStripe, accountId = ACCOUNT) =>
    hold.authorizeDepositHold(
      {
        reservationId,
        storeId: accountId === ACCOUNT ? STORE : MOVING_STORE,
        stripeAccountId: accountId,
        storeSettings: { currency: "EUR" },
        actorUserId: null,
      },
      holdDeps(stripe),
    );

  const settlement = (reservationId: string) => ({
    reservationId,
    storeId: STORE,
    fallbackAccountId: ACCOUNT,
    storeSettings: { currency: "EUR" },
    actorUserId: null,
  });

  /** The customer authorizes the deposit on the storefront; Stripe tells the webhook. */
  async function customerAuthorizes(reservationId: string, stripe: FakeDepositStripe) {
    const intent = stripe.customerAuthorizes({ accountId: ACCOUNT, reservationId });
    return {
      id: intent.id,
      outcome: await deliver("payment_intent.amount_capturable_updated", stripe, intent.id),
    };
  }

  test("each event records the PaymentIntent as Stripe has it, once, however often it is delivered", async () => {
    const reservationId = await createReservation({ depositStatus: "pending" });
    const stripe = stripeWithCard();

    const authorized = await customerAuthorizes(reservationId, stripe);
    assert.equal(authorized.outcome, "authorized");
    assert.deepEqual(await readDeposit(reservationId), {
      status: "authorized",
      paymentIntentId: authorized.id,
    });
    // Stripe delivers the event again: nothing is added.
    assert.equal(
      await deliver("payment_intent.amount_capturable_updated", stripe, authorized.id),
      "authorized",
    );
    assert.deepEqual(await readActivity(reservationId), ["deposit_authorized"]);

    await stripe.port.capture(ACCOUNT, authorized.id, 2000);
    for (let delivery = 0; delivery < 3; delivery++) {
      assert.equal(await deliver("payment_intent.succeeded", stripe, authorized.id), "captured");
    }

    assert.equal((await readDeposit(reservationId))?.status, "captured");
    assert.deepEqual(await holdStates(reservationId), [["completed", authorized.id, ACCOUNT]]);
    assert.deepEqual(await readCaptures(reservationId), [
      { paymentIntentId: authorized.id, amount: "20.00" },
    ]);
    // One line per PaymentIntent and change, whatever the number of deliveries.
    assert.deepEqual(await readActivity(reservationId), ["deposit_authorized", "deposit_captured"]);
  });

  test("a release answered late does not cancel the hold the customer gave meanwhile", async () => {
    const reservationId = await createReservation();
    const stripe = stripeWithCard();
    assert.equal((await request(reservationId, stripe)).ok, true);
    const first = stripe.held()[0].id;
    let second = "";

    // The dashboard cancels the first hold at Stripe, and stalls. Stripe's event
    // releases the deposit; the customer authorizes again.
    const stalled: DepositHoldDeps = {
      ...holdDeps(stripe),
      stripe: {
        ...stripe.port,
        release: async (accountId, paymentIntentId) => {
          const intent = await stripe.port.release(accountId, paymentIntentId);
          assert.equal(await deliver("payment_intent.canceled", stripe, first), "released");
          assert.equal((await readDeposit(reservationId))?.status, "released");
          const authorized = await customerAuthorizes(reservationId, stripe);
          assert.equal(authorized.outcome, "authorized");
          second = authorized.id;
          return intent;
        },
      },
    };
    // The dashboard comes back and records its release.
    const released = await hold.releaseDepositHold(settlement(reservationId), stalled);

    assert.equal(released.ok, true);
    assert.deepEqual(await readDeposit(reservationId), {
      status: "authorized",
      paymentIntentId: second,
    });
    assert.deepEqual(await holdStates(reservationId), [
      ["authorized", second, ACCOUNT],
      ["cancelled", first, ACCOUNT],
    ]);
    assert.deepEqual(
      stripe.held().map((intent) => intent.id),
      [second],
    );
    assert.deepEqual(await readActivity(reservationId), [
      "deposit_authorized",
      "deposit_authorized",
      "deposit_released",
    ]);

    // A further authorization is decided against, and the outbox releases it: one
    // hold stays live.
    const third = await customerAuthorizes(reservationId, stripe);
    assert.equal(third.outcome, "superseded");
    assert.deepEqual(await holdStates(reservationId), [
      ["authorized", second, ACCOUNT],
      ["cancelled", first, ACCOUNT],
      ["release_owed", third.id, ACCOUNT],
    ]);
    assert.equal((await runHandedOver(stripe)).sent, 1);
    assert.deepEqual(
      stripe.held().map((intent) => intent.id),
      [second],
    );
    assert.equal((await readDeposit(reservationId))?.paymentIntentId, second);
  });

  test("an authorization decided against is never taken as the hold, whatever comes before its release", async () => {
    const reservationId = await createReservation({ depositStatus: "pending" });
    const stripe = stripeWithCard();
    const first = (await customerAuthorizes(reservationId, stripe)).id;
    const second = stripe.customerAuthorizes({ accountId: ACCOUNT, reservationId }).id;

    // The second authorization is decided against. Before the outbox cancels it at
    // Stripe, the first hold is released, and Stripe delivers the second
    // authorization's event again.
    assert.equal(
      await deliver("payment_intent.amount_capturable_updated", stripe, second),
      "superseded",
    );
    assert.equal(
      (await hold.releaseDepositHold(settlement(reservationId), holdDeps(stripe))).ok,
      true,
    );
    assert.equal(
      await deliver("payment_intent.amount_capturable_updated", stripe, second),
      "superseded",
    );
    assert.deepEqual(await readDeposit(reservationId), {
      status: "released",
      paymentIntentId: first,
    });

    // One release was asked for, however many times the event came.
    assert.deepEqual(await runHandedOver(stripe), { sent: 1, failed: 0, skipped: 0 });

    // Stripe holds nothing, and the reservation says so: it does not name the second.
    assert.deepEqual(stripe.held(), []);
    assert.deepEqual(await readDeposit(reservationId), {
      status: "released",
      paymentIntentId: first,
    });
    assert.deepEqual(await holdStates(reservationId), [
      ["cancelled", first, ACCOUNT],
      ["cancelled", second, ACCOUNT],
    ]);
  });

  describe("a cancellation delivered before the authorization", () => {
    test("of the store's attempt: the attempt's row is cancelled, and the late authorization is not recorded", async () => {
      const reservationId = await createReservation();
      const stripe = stripeWithCard();
      // Stripe authorizes; the answer is lost, and Louez has a pending attempt only.
      stripe.next.push(stripe.stillRunning);
      assert.equal((await request(reservationId, stripe)).ok, false);
      stripe.finishRunning();
      const [intent] = stripe.held();
      // The authorization is cancelled at Stripe, and its events come in that order.
      stripe.cancel(ACCOUNT, intent.id);

      assert.equal(await deliver("payment_intent.canceled", stripe, intent.id), "released");
      assert.deepEqual(await holdStates(reservationId), [["cancelled", intent.id, ACCOUNT]]);
      const late = await deliver("payment_intent.amount_capturable_updated", stripe, intent.id);

      assert.equal(late, "released");
      assert.deepEqual(await readDeposit(reservationId), {
        status: "card_saved",
        paymentIntentId: null,
      });
      assert.deepEqual(await holdStates(reservationId), [["cancelled", intent.id, ACCOUNT]]);
      assert.deepEqual(await readActivity(reservationId), []);

      // The store asks again: a new attempt, with a new key, and one hold.
      const again = await request(reservationId, stripe);
      assert.equal(again.ok, true);
      assert.notEqual(stripe.calls[1].key, stripe.calls[0].key);
      assert.equal(stripe.held().length, 1);
      assert.equal((await readDeposit(reservationId))?.paymentIntentId, stripe.held()[0].id);
    });

    test("of an authorization Louez had no row for: it keeps one, cancelled, and never adopts it", async () => {
      const reservationId = await createReservation({ depositStatus: "pending" });
      const stripe = stripeWithCard();
      const intent = stripe.customerAuthorizes({ accountId: ACCOUNT, reservationId });
      const authorized = stripe.toIntent(intent);
      stripe.cancel(ACCOUNT, intent.id);

      assert.equal(await deliver("payment_intent.canceled", stripe, intent.id), "released");
      // A writer that still believes the authorization, as one that read Stripe just
      // before the cancellation does, finds the PaymentIntent dead.
      const adopted = await holdWrites.settleDepositIntent(louezDb.db, {
        reservationId,
        accountId: ACCOUNT,
        intent: authorized,
        actorUserId: null,
      });

      assert.equal(adopted.status === "settled" && adopted.outcome, "stale");
      assert.deepEqual(await readDeposit(reservationId), {
        status: "pending",
        paymentIntentId: null,
      });
      assert.deepEqual(await holdStates(reservationId), [["cancelled", intent.id, ACCOUNT]]);
    });
  });

  describe("a capture delivered before the authorization was recorded", () => {
    test("of the store's attempt: it settles the attempt onto the reservation, which takes no other authorization", async () => {
      const reservationId = await createReservation();
      const stripe = stripeWithCard();
      // Stripe authorizes; the answer is lost, and Louez has a pending attempt only.
      stripe.next.push(stripe.stillRunning);
      assert.equal((await request(reservationId, stripe)).ok, false);
      stripe.finishRunning();
      const [intent] = stripe.held();
      // The store captures it from Stripe's dashboard before Louez recorded it.
      stripe.captureAtStripe(ACCOUNT, intent.id, 5000);

      assert.equal(await deliver("payment_intent.succeeded", stripe, intent.id), "captured");

      assert.deepEqual(await readDeposit(reservationId), {
        status: "captured",
        paymentIntentId: intent.id,
      });
      assert.deepEqual(await holdStates(reservationId), [["completed", intent.id, ACCOUNT]]);
      assert.deepEqual(await readCaptures(reservationId), [
        { paymentIntentId: intent.id, amount: "50.00" },
      ]);
      assert.equal(invoiced.length > 0, true);
      // The deposit was captured: nobody can hold the card a second time.
      const calls = stripe.calls.length;
      assert.deepEqual(await request(reservationId, stripe), {
        ok: false,
        error: "errors.stripe.invalidDepositStatus",
      });
      assert.equal(stripe.calls.length, calls);
      assert.deepEqual(stripe.held(), []);
      // The authorization's own event, late: the captured hold is not reopened.
      assert.equal(
        await deliver("payment_intent.amount_capturable_updated", stripe, intent.id),
        "captured",
      );
      assert.equal((await readDeposit(reservationId))?.status, "captured");
    });

    test("of an authorization Louez had no row for: it leaves a final hold row, which an older snapshot cannot reopen", async () => {
      const reservationId = await createReservation({ depositStatus: "pending" });
      const stripe = stripeWithCard();
      const intent = stripe.customerAuthorizes({ accountId: ACCOUNT, reservationId });
      const authorized = stripe.toIntent(intent);
      stripe.captureAtStripe(ACCOUNT, intent.id, 3000);

      assert.equal(await deliver("payment_intent.succeeded", stripe, intent.id), "captured");

      assert.deepEqual(await readDeposit(reservationId), {
        status: "captured",
        paymentIntentId: intent.id,
      });
      assert.deepEqual(await holdStates(reservationId), [["completed", intent.id, ACCOUNT]]);
      // A writer that read Stripe before the capture still holds `requires_capture`.
      const late = await holdWrites.settleDepositIntent(louezDb.db, {
        reservationId,
        accountId: ACCOUNT,
        intent: authorized,
        actorUserId: null,
      });
      assert.equal(late.status === "settled" && late.outcome, "stale");
      assert.deepEqual(await holdStates(reservationId), [["completed", intent.id, ACCOUNT]]);
      assert.equal((await readDeposit(reservationId))?.status, "captured");
      assert.deepEqual(await readCaptures(reservationId), [
        { paymentIntentId: intent.id, amount: "30.00" },
      ]);
    });
  });

  describe("a store that changed connected accounts", () => {
    const moveStore = (accountId: string | null) =>
      louezDb.db
        .update(louezDb.stores)
        .set({ stripeAccountId: accountId })
        .where(eq(louezDb.stores.id, MOVING_STORE));

    /** A PaymentIntent someone makes on an account, naming a reservation and an attempt. */
    const forge = (
      stripe: FakeDepositStripe,
      values: {
        accountId: string;
        reservationId: string;
        attemptId: string | null;
        amountMinor?: number;
        paymentMethodId?: string;
        customerId?: string;
      },
    ) =>
      stripe.createIntent({
        customerId: "cus_stripe",
        paymentMethodId: "pm_card",
        amountMinor: 5000,
        currency: "EUR",
        status: "requires_capture",
        ...values,
      });

    test("still gets the events of the attempt it left on the first account", async () => {
      await moveStore(FIRST_ACCOUNT);
      const reservationId = await createReservation({ storeId: MOVING_STORE });
      const stripe = stripeWithCard();
      stripe.next.push(stripe.stillRunning);
      assert.equal((await request(reservationId, stripe, FIRST_ACCOUNT)).ok, false);
      stripe.finishRunning();
      const [intent] = stripe.held(FIRST_ACCOUNT);

      await moveStore(NEXT_ACCOUNT);
      const outcome = await deliver(
        "payment_intent.amount_capturable_updated",
        stripe,
        intent.id,
        FIRST_ACCOUNT,
      );

      assert.equal(outcome, "authorized");
      assert.deepEqual(await readDeposit(reservationId), {
        status: "authorized",
        paymentIntentId: intent.id,
      });
      assert.deepEqual(await holdStates(reservationId), [["authorized", intent.id, FIRST_ACCOUNT]]);
    });

    test("the account it left cannot write a second PaymentIntent on a hold's attempt", async () => {
      await moveStore(FIRST_ACCOUNT);
      const reservationId = await createReservation({ storeId: MOVING_STORE });
      const stripe = stripeWithCard();
      assert.equal((await request(reservationId, stripe, FIRST_ACCOUNT)).ok, true);
      const [held] = stripe.held(FIRST_ACCOUNT);
      await moveStore(NEXT_ACCOUNT);
      invoiced.length = 0;

      // Whoever holds the first account makes a PaymentIntent there that names the
      // reservation and the attempt of its hold, with the very same facts.
      const forged = forge(stripe, {
        accountId: FIRST_ACCOUNT,
        reservationId,
        attemptId: held.attemptId,
      });
      const asHold = await deliver(
        "payment_intent.amount_capturable_updated",
        stripe,
        forged.id,
        FIRST_ACCOUNT,
      );
      // Then captures it, to pass it for the deposit's capture.
      stripe.captureAtStripe(FIRST_ACCOUNT, forged.id);
      const asCapture = await deliver(
        "payment_intent.succeeded",
        stripe,
        forged.id,
        FIRST_ACCOUNT,
      );

      assert.deepEqual([asHold, asCapture], ["rejected", "rejected"]);
      assert.deepEqual(await readDeposit(reservationId), {
        status: "authorized",
        paymentIntentId: held.id,
      });
      assert.deepEqual(await holdStates(reservationId), [["authorized", held.id, FIRST_ACCOUNT]]);
      assert.deepEqual(await readCaptures(reservationId), []);
      assert.deepEqual(invoiced, []);
      assert.deepEqual(await readActivity(reservationId), ["deposit_authorized"]);

      // The hold's own events are still its own: Stripe cancels it on the first account.
      stripe.cancel(FIRST_ACCOUNT, held.id);
      assert.equal(
        await deliver("payment_intent.canceled", stripe, held.id, FIRST_ACCOUNT),
        "released",
      );
      assert.equal((await readDeposit(reservationId))?.status, "released");
    });

    test("a pending attempt it left there takes its own PaymentIntent, and no other", async () => {
      await moveStore(FIRST_ACCOUNT);
      const reservationId = await createReservation({ storeId: MOVING_STORE });
      const stripe = stripeWithCard();
      stripe.next.push(stripe.stillRunning);
      assert.equal((await request(reservationId, stripe, FIRST_ACCOUNT)).ok, false);
      const { attemptId } = stripe.calls[0].request;
      await moveStore(NEXT_ACCOUNT);
      const authorization = "payment_intent.amount_capturable_updated";

      // PaymentIntents that name the pending attempt, and are not what it was sent
      // with: another amount, another card.
      const wrong = [
        forge(stripe, { accountId: FIRST_ACCOUNT, reservationId, attemptId, amountMinor: 90_000 }),
        forge(stripe, {
          accountId: FIRST_ACCOUNT,
          reservationId,
          attemptId,
          paymentMethodId: "pm_stranger",
          customerId: "cus_stranger",
        }),
      ];
      for (const intent of wrong) {
        assert.equal(await deliver(authorization, stripe, intent.id, FIRST_ACCOUNT), "rejected");
      }
      assert.deepEqual(await holdStates(reservationId), [["pending", null, FIRST_ACCOUNT]]);
      assert.equal((await readDeposit(reservationId))?.status, "card_saved");

      // The attempt's own PaymentIntent, once Stripe is done with the request.
      stripe.finishRunning();
      const genuine = stripe
        .held(FIRST_ACCOUNT)
        .find((intent) => !wrong.some((forged) => forged.id === intent.id));
      assert.ok(genuine);
      assert.equal(await deliver(authorization, stripe, genuine.id, FIRST_ACCOUNT), "authorized");
      assert.deepEqual(await holdStates(reservationId), [["authorized", genuine.id, FIRST_ACCOUNT]]);

      // The attempt has its PaymentIntent: a later one that names it is nobody's.
      const late = forge(stripe, { accountId: FIRST_ACCOUNT, reservationId, attemptId });
      assert.equal(await deliver(authorization, stripe, late.id, FIRST_ACCOUNT), "rejected");
      assert.deepEqual(await readDeposit(reservationId), {
        status: "authorized",
        paymentIntentId: genuine.id,
      });
    });

    test("keeps the attempt of the first account when a failure comes from the next", async () => {
      await moveStore(FIRST_ACCOUNT);
      const reservationId = await createReservation({ storeId: MOVING_STORE });
      const stripe = stripeWithCard();
      stripe.next.push(stripe.stillRunning);
      assert.equal((await request(reservationId, stripe, FIRST_ACCOUNT)).ok, false);
      stripe.finishRunning();
      const [held] = stripe.held(FIRST_ACCOUNT);

      // A PaymentIntent of the next account names that attempt, and failed there.
      await moveStore(NEXT_ACCOUNT);
      const refused = stripe.createIntent({
        accountId: NEXT_ACCOUNT,
        customerId: null,
        paymentMethodId: null,
        amountMinor: 5000,
        currency: "EUR",
        status: "requires_payment_method",
        attemptId: held.attemptId,
        reservationId,
      });
      const outcome = await deliver(
        "payment_intent.payment_failed",
        stripe,
        refused.id,
        NEXT_ACCOUNT,
      );

      // The attempt was sent to the first account, where it may hold an
      // authorization: nothing of another account is written on it.
      assert.equal(outcome, "rejected");
      assert.deepEqual(await holdStates(reservationId), [["pending", null, FIRST_ACCOUNT]]);
      assert.equal((await readDeposit(reservationId))?.status, "card_saved");
      assert.equal(stripe.held(FIRST_ACCOUNT).length, 1);
    });

    test("takes no event from an account that has no claim on the reservation", async () => {
      await moveStore(NEXT_ACCOUNT);
      const reservationId = await createReservation({ storeId: MOVING_STORE });
      const stripe = stripeWithCard();
      const foreign = stripe.createIntent({
        accountId: "acct_stranger",
        customerId: null,
        paymentMethodId: "pm_stranger",
        amountMinor: 5000,
        currency: "EUR",
        status: "requires_capture",
        attemptId: null,
        reservationId,
      });

      const outcome = await deliver(
        "payment_intent.amount_capturable_updated",
        stripe,
        foreign.id,
        "acct_stranger",
      );

      assert.equal(outcome, "rejected");
      assert.deepEqual(await holdStates(reservationId), []);
      assert.equal((await readDeposit(reservationId))?.status, "card_saved");
    });
  });

  test("on the store's own account too, a PaymentIntent that is not what its attempt was sent with is refused", async () => {
    const reservationId = await createReservation();
    const stripe = stripeWithCard();
    stripe.next.push(stripe.stillRunning);
    assert.equal((await request(reservationId, stripe)).ok, false);
    const { attemptId } = stripe.calls[0].request;
    const authorization = "payment_intent.amount_capturable_updated";

    const wrong = stripe.createIntent({
      accountId: ACCOUNT,
      customerId: "cus_stripe",
      paymentMethodId: "pm_card",
      amountMinor: 90_000,
      currency: "EUR",
      status: "requires_capture",
      attemptId,
      reservationId,
    });
    assert.equal(await deliver(authorization, stripe, wrong.id), "rejected");
    assert.deepEqual(await holdStates(reservationId), [["pending", null, ACCOUNT]]);
    assert.equal((await readDeposit(reservationId))?.status, "card_saved");

    stripe.finishRunning();
    const genuine = stripe.held().find((intent) => intent.id !== wrong.id);
    assert.ok(genuine);
    assert.equal(await deliver(authorization, stripe, genuine.id), "authorized");
    // Its attempt has its PaymentIntent: the other one still is nobody's.
    assert.equal(await deliver(authorization, stripe, wrong.id), "rejected");
    assert.deepEqual(await holdStates(reservationId), [["authorized", genuine.id, ACCOUNT]]);
  });

  test("a failed attempt of the store keeps its row, failed, and fails the deposit", async () => {
    const reservationId = await createReservation();
    const stripe = stripeWithCard();
    // The card is declined, and the request never hears of it.
    stripe.next.push(async (authorization, key) => {
      await stripe.declined(authorization, key);
      return { kind: "indeterminate", replayed: false, message: "socket hang up" };
    });
    const first = await request(reservationId, stripe);
    // The lookup already saw the declined PaymentIntent.
    assert.deepEqual(first, { ok: false, error: "errors.stripe.authorizationFailed" });
    const [firstDeclined] = stripe.intents;
    assert.deepEqual(await holdStates(reservationId), [["failed", firstDeclined.id, ACCOUNT]]);

    // A second attempt, declined too, of which only the webhook hears.
    await louezDb.db
      .update(louezDb.reservations)
      .set({ depositStatus: "card_saved" })
      .where(eq(louezDb.reservations.id, reservationId));
    stripe.next.push(stripe.stillRunning);
    assert.equal((await request(reservationId, stripe)).ok, false);
    const attemptId = stripe.calls[1].request.attemptId;
    const declined = stripe.createIntent({
      accountId: ACCOUNT,
      customerId: "cus_stripe",
      paymentMethodId: "pm_card",
      amountMinor: 5000,
      currency: "EUR",
      status: "requires_payment_method",
      attemptId,
      reservationId,
    });

    assert.equal(await deliver("payment_intent.payment_failed", stripe, declined.id), "failed");

    assert.deepEqual(await holdStates(reservationId), [
      ["failed", firstDeclined.id, ACCOUNT],
      ["failed", declined.id, ACCOUNT],
    ]);
    assert.equal((await readDeposit(reservationId))?.status, "failed");
    assert.deepEqual(stripe.held(), []);
  });

  describe("a failure event", () => {
    test("that the PaymentIntent still shows is told to the owner once, however often Stripe delivers it", async () => {
      const reservationId = await createReservation({ depositStatus: "pending" });
      const stripe = stripeWithCard();
      // The customer's card was declined on the storefront.
      const declined = stripe.createIntent({
        accountId: ACCOUNT,
        customerId: null,
        paymentMethodId: null,
        amountMinor: 5000,
        currency: "EUR",
        status: "requires_payment_method",
        attemptId: null,
        reservationId,
      });
      const event = eventOf("payment_intent.payment_failed", stripe, ACCOUNT, declined.id);
      alerts.length = 0;

      for (let delivery = 0; delivery < 3; delivery++) {
        assert.equal(await events.handleDepositEvent(event, eventDeps(stripe)), "failed");
      }

      assert.equal(alerts.length, 1);
      assert.equal((await readDeposit(reservationId))?.status, "failed");
      assert.deepEqual(await readActivity(reservationId), ["deposit_failed"]);
      // No hold row: the PaymentIntent holds nothing and is not over.
      assert.deepEqual(await holdStates(reservationId), []);
    });

    test("of a PaymentIntent that went through since tells nobody, and fails nothing", async () => {
      const authorized = await createReservation({ depositStatus: "pending" });
      const captured = await createReservation({ depositStatus: "pending" });
      const stripe = stripeWithCard();
      // The first try was declined, the second went through: Stripe delivers the
      // failure after the authorization, or after its capture.
      const held = stripe.customerAuthorizes({ accountId: ACCOUNT, reservationId: authorized });
      const taken = stripe.customerAuthorizes({ accountId: ACCOUNT, reservationId: captured });
      stripe.captureAtStripe(ACCOUNT, taken.id);
      alerts.length = 0;

      assert.equal(await deliver("payment_intent.payment_failed", stripe, held.id), "authorized");
      assert.equal(await deliver("payment_intent.payment_failed", stripe, taken.id), "captured");

      assert.deepEqual(alerts, []);
      assert.deepEqual(await readDeposit(authorized), {
        status: "authorized",
        paymentIntentId: held.id,
      });
      assert.deepEqual(await readDeposit(captured), {
        status: "captured",
        paymentIntentId: taken.id,
      });
      // The read is what was recorded: the hold, and the capture. No failure.
      assert.deepEqual(await readActivity(authorized), ["deposit_authorized"]);
      assert.deepEqual(await readActivity(captured), ["deposit_captured"]);
    });

    test("of a PaymentIntent that failed while another holds the deposit tells nobody", async () => {
      const authorized = await createReservation({ depositStatus: "pending" });
      const captured = await createReservation({ depositStatus: "pending" });
      const stripe = stripeWithCard();
      // A first PaymentIntent fails; a second authorizes the deposit, captured on one
      // reservation; the first one's failure arrives last.
      const failedOf = (reservationId: string) =>
        stripe.createIntent({
          accountId: ACCOUNT,
          customerId: null,
          paymentMethodId: "pm_declined",
          amountMinor: 5000,
          currency: "EUR",
          status: "requires_payment_method",
          attemptId: null,
          reservationId,
        });
      const firstOfAuthorized = failedOf(authorized);
      const firstOfCaptured = failedOf(captured);
      assert.equal((await customerAuthorizes(authorized, stripe)).outcome, "authorized");
      const taken = await customerAuthorizes(captured, stripe);
      stripe.captureAtStripe(ACCOUNT, taken.id);
      assert.equal(await deliver("payment_intent.succeeded", stripe, taken.id), "captured");
      alerts.length = 0;

      assert.equal(
        await deliver("payment_intent.payment_failed", stripe, firstOfAuthorized.id),
        "failed",
      );
      assert.equal(
        await deliver("payment_intent.payment_failed", stripe, firstOfCaptured.id),
        "failed",
      );

      assert.deepEqual(alerts, []);
      assert.equal((await readDeposit(authorized))?.status, "authorized");
      assert.equal((await readDeposit(captured))?.status, "captured");
      assert.deepEqual(await readActivity(authorized), ["deposit_authorized"]);
    });
  });

  test("a capture of a PaymentIntent the reservation does not reference records the money and leaves its hold", async () => {
    const reservationId = await createReservation({ depositStatus: "pending" });
    const stripe = stripeWithCard();
    const first = (await customerAuthorizes(reservationId, stripe)).id;
    // A second authorization, captured in Stripe before Louez released it.
    const second = stripe.customerAuthorizes({ accountId: ACCOUNT, reservationId }).id;
    await stripe.port.capture(ACCOUNT, second, 5000);

    assert.equal(await deliver("payment_intent.succeeded", stripe, second), "captured");

    // The reservation's hold is the first, still live at Stripe.
    assert.deepEqual(await readDeposit(reservationId), {
      status: "authorized",
      paymentIntentId: first,
    });
    assert.deepEqual(
      stripe.held().map((intent) => intent.id),
      [first],
    );
    // The captured PaymentIntent has its row, final: nothing takes it as a hold.
    assert.deepEqual(await holdStates(reservationId), [
      ["authorized", first, ACCOUNT],
      ["completed", second, ACCOUNT],
    ]);
    assert.deepEqual(await readCaptures(reservationId), [
      { paymentIntentId: second, amount: "50.00" },
    ]);
  });

  test("an event that is not a deposit hold's, or names no reservation of Louez, writes nothing", async () => {
    const reservationId = await createReservation({ depositStatus: "pending" });
    const stripe = stripeWithCard();
    const intent = stripe.customerAuthorizes({ accountId: ACCOUNT, reservationId });
    const event = eventOf("payment_intent.amount_capturable_updated", stripe, ACCOUNT, intent.id);
    const withMetadata = (metadata: Record<string, string>): DepositEvent => ({
      ...event,
      paymentIntent: { ...event.paymentIntent, metadata },
    });

    assert.equal(
      await events.handleDepositEvent(withMetadata({ reservationId }), eventDeps(stripe)),
      "ignored",
    );
    for (const unknown of ["short", "res_events_unknown_00"]) {
      assert.equal(
        await events.handleDepositEvent(
          withMetadata({ type: "deposit_hold", reservationId: unknown }),
          eventDeps(stripe),
        ),
        "rejected",
      );
    }
    assert.deepEqual(await holdStates(reservationId), []);
  });

  test("an event whose body names another reservation than its PaymentIntent does is refused", async () => {
    const named = await createReservation({ depositStatus: "pending" });
    const other = await createReservation({ depositStatus: "pending" });
    const stripe = stripeWithCard();
    // At Stripe, the PaymentIntent is the other reservation's.
    const intent = stripe.customerAuthorizes({ accountId: ACCOUNT, reservationId: other });
    const event = eventOf("payment_intent.amount_capturable_updated", stripe, ACCOUNT, intent.id);

    const outcome = await events.handleDepositEvent(
      {
        ...event,
        paymentIntent: {
          ...event.paymentIntent,
          metadata: { type: "deposit_hold", reservationId: named },
        },
      },
      eventDeps(stripe),
    );

    assert.equal(outcome, "rejected");
    assert.deepEqual(await holdStates(named), []);
    assert.equal((await readDeposit(named))?.status, "pending");
  });
});
