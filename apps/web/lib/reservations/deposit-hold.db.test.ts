import assert from "node:assert/strict";
import { after, before, describe, mock, test } from "node:test";

import { and, eq, sql } from "drizzle-orm";

import type { ApiEffectSenders } from "@louez/api/platform/effects";
import {
  createTestDatabase,
  raceOnLockedRow,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";

import type { DepositHoldDeps } from "./deposit-hold";
import {
  ATTEMPT_LOOKUP_MAX_PAGES,
  type DepositHoldStripe,
  depositHoldIdempotencyKey,
} from "./deposit-hold-stripe";
import {
  type FakeDepositStripe,
  type FakeIntent,
  fakeDepositStripe,
} from "./fake-deposit-stripe.fixtures";

// The store's deposit hold on a migrated database, with Stripe faked: whatever the
// interleaving of two requests, a retry, the customer's own authorization, a capture
// and a release, one authorization exists per attempt, the reservation references one
// hold, and what the rows say is what the fake Stripe holds. The Connect webhook's
// side is in app/api/webhooks/stripe/connect/deposit-events.db.test.ts, and a random
// walk over every event a hold can see in deposit-hold.model.db.test.ts.

const STORE = "store_deposit_hold";
const ACCOUNT = "acct_deposit_hold";
const NEXT_ACCOUNT = "acct_deposit_next";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("deposit hold (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let hold: typeof import("./deposit-hold");
  let holdWrites: typeof import("./deposit-hold-writes");
  let outbox: typeof import("@louez/api/platform/effects");
  let holdEffects: typeof import("./deposit-hold-effects");
  let counter = 0;
  /** The outbox rows the writes handed to the dispatcher, not run yet. */
  const handedOver: string[] = [];

  before(async () => {
    database = await createTestDatabase("deposit_hold");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    hold = await import("./deposit-hold");
    holdWrites = await import("./deposit-hold-writes");
    outbox = await import("@louez/api/platform/effects");
    holdEffects = await import("./deposit-hold-effects");
    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: "owner",
      name: "Deposit hold",
      slug: "deposit-hold",
      stripeAccountId: ACCOUNT,
    });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  type ReservationOptions = {
    depositStatus?: "pending" | "card_saved" | "failed";
    depositAmount?: string;
    currency?: string | null;
    customerId?: string | null;
    paymentMethodId?: string | null;
  };

  async function createReservation(options: ReservationOptions = {}) {
    const id = `res_${++counter}`;
    const customerId = `cus_${counter}`;
    await louezDb.db.insert(louezDb.customers).values({
      id: customerId,
      storeId: STORE,
      email: `${customerId}@example.test`,
      firstName: "Ada",
      lastName: "Lovelace",
    });
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId: STORE,
      customerId,
      number: `N-${counter}`,
      status: "confirmed",
      startDate: new Date("2026-03-12T09:00:00.000Z"),
      endDate: new Date("2026-03-14T09:00:00.000Z"),
      subtotalAmount: "100.00",
      depositAmount: options.depositAmount ?? "50.00",
      totalAmount: "100.00",
      depositStatus: options.depositStatus ?? "card_saved",
      currency: options.currency ?? null,
      stripeCustomerId: options.customerId === undefined ? "cus_stripe" : options.customerId,
      stripePaymentMethodId:
        options.paymentMethodId === undefined ? "pm_card" : options.paymentMethodId,
      source: "manual",
    });
    return id;
  }

  const setReservation = (
    reservationId: string,
    values: Partial<typeof louezDb.reservations.$inferInsert>,
  ) =>
    louezDb.db
      .update(louezDb.reservations)
      .set(values)
      .where(eq(louezDb.reservations.id, reservationId));

  async function readDeposit(reservationId: string) {
    const r = louezDb.reservations;
    const [row] = await louezDb.db
      .select({
        status: r.depositStatus,
        paymentIntentId: r.depositPaymentIntentId,
        paymentMethodId: r.stripePaymentMethodId,
      })
      .from(r)
      .where(eq(r.id, reservationId));
    return row;
  }

  async function readHolds(reservationId: string) {
    const p = louezDb.payments;
    return louezDb.db
      .select({
        id: p.id,
        status: p.status,
        paymentIntentId: p.stripePaymentIntentId,
        amount: p.amount,
        currency: p.currency,
        grossMinor: p.grossMinor,
        insuranceShareMinor: p.insuranceShareMinor,
        origin: p.origin,
        stripeAccountId: p.stripeAccountId,
        releaseOwedAt: p.releaseOwedAt,
      })
      .from(p)
      .where(and(eq(p.reservationId, reservationId), eq(p.type, "deposit_hold")))
      .orderBy(p.createdAt, p.id);
  }

  /**
   * Each hold row as `[status, PaymentIntent]`, sorted; `release_owed` for an
   * authorization Louez decided against and Stripe has not confirmed released.
   */
  const holdStates = async (reservationId: string) =>
    (await readHolds(reservationId))
      .map((row) => [row.releaseOwedAt ? "release_owed" : row.status, row.paymentIntentId])
      .sort();

  async function readCaptures(reservationId: string) {
    const p = louezDb.payments;
    return louezDb.db
      .select({ paymentIntentId: p.stripePaymentIntentId, amount: p.amount, status: p.status })
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

  /** The outbox rows that ask Stripe to release an authorization of the reservation. */
  async function readReleaseEffects(reservationId: string) {
    const e = louezDb.apiEffects;
    return louezDb.db
      .select({ id: e.id, status: e.status, attempts: e.attempts, payload: e.payload })
      .from(e)
      .where(
        and(
          eq(e.type, "deposit.holdRelease"),
          sql`JSON_UNQUOTE(JSON_EXTRACT(${e.payload}, '$.reservationId')) = ${reservationId}`,
        ),
      )
      .orderBy(e.seq);
  }

  /**
   * Makes the reservation's pending attempt that much older: its creation, its claim
   * and its last request to Stripe.
   */
  const ageAttempt = (reservationId: string, ms: number) => {
    const p = louezDb.payments;
    const seconds = sql.raw(String(Math.round(ms / 1000)));
    return louezDb.db
      .update(p)
      .set({
        createdAt: sql`${p.createdAt} - INTERVAL ${seconds} SECOND`,
        updatedAt: sql`${p.updatedAt} - INTERVAL ${seconds} SECOND`,
        claimedUntil: sql`${p.claimedUntil} - INTERVAL ${seconds} SECOND`,
        providerRequestedAt: sql`${p.providerRequestedAt} - INTERVAL ${seconds} SECOND`,
      })
      .where(
        and(
          eq(p.reservationId, reservationId),
          eq(p.type, "deposit_hold"),
          eq(p.status, "pending"),
        ),
      );
  };

  /** Stripe, with the card of `createReservation` saved on its customer. */
  const stripeWithCard = (options?: Parameters<typeof fakeDepositStripe>[0]) => {
    const stripe = fakeDepositStripe(options);
    stripe.saveCard(ACCOUNT, "pm_card", "cus_stripe");
    return stripe;
  };

  const depsOf = (stripe: FakeDepositStripe): DepositHoldDeps => ({
    database: louezDb.db,
    stripe: stripe.port,
    dispatchEffects: (ids) => {
      handedOver.push(...ids);
    },
  });

  /** The app's senders, as far as these tests queue rows: the release of a hold. */
  const sendersOf = (stripe: FakeDepositStripe) =>
    ({
      ...holdEffects.createDepositHoldEffectSenders({
        database: louezDb.db,
        stripe: stripe.port,
      }),
    }) as ApiEffectSenders;

  /** Runs the outbox rows handed over so far, as the app does once it has answered. */
  const runHandedOver = (stripe: FakeDepositStripe) =>
    outbox.dispatchEffects(handedOver.splice(0), sendersOf(stripe));

  /** The cron's pass, once every failed or untaken row of the reservation is due. */
  async function runCron(reservationId: string, stripe: FakeDepositStripe) {
    const e = louezDb.apiEffects;
    const ids = (await readReleaseEffects(reservationId)).map((row) => row.id);
    for (const id of ids) {
      await louezDb.db
        .update(e)
        .set({
          nextAttemptAt: sql`NOW(3) - INTERVAL 1 SECOND`,
          createdAt: sql`NOW(3) - INTERVAL 1 HOUR`,
        })
        .where(eq(e.id, id));
    }
    return outbox.retryDueEffects(sendersOf(stripe));
  }

  const request = (
    reservationId: string,
    stripe: FakeDepositStripe,
    options: { accountId?: string; storeSettings?: { currency: string } | null } = {},
  ) =>
    hold.authorizeDepositHold(
      {
        reservationId,
        storeId: STORE,
        stripeAccountId: options.accountId ?? ACCOUNT,
        storeSettings: options.storeSettings === undefined ? { currency: "EUR" } : null,
        actorUserId: null,
      },
      depsOf(stripe),
    );

  const settlement = (reservationId: string, fallbackAccountId: string | null = ACCOUNT) => ({
    reservationId,
    storeId: STORE,
    fallbackAccountId,
    storeSettings: { currency: "EUR" },
    actorUserId: null,
  });

  /**
   * What the Connect webhook or the customer's confirmation writes for a PaymentIntent
   * as Stripe has it now: its outcome, or why it was written nowhere.
   */
  async function settle(
    reservationId: string,
    stripe: FakeDepositStripe,
    paymentIntentId: string,
    accountId = ACCOUNT,
  ) {
    const settled = await holdWrites.settleDepositIntent(louezDb.db, {
      reservationId,
      accountId,
      intent: stripe.toIntent(stripe.intentOf(accountId, paymentIntentId)),
      actorUserId: null,
    });
    if (settled.status !== "settled") {
      return settled.status === "refused" ? settled.reason : settled.status;
    }
    handedOver.push(...settled.effectIds);
    return settled.outcome;
  }

  /** The customer authorizes the deposit on the storefront, and Louez records it. */
  async function customerAuthorizes(reservationId: string, stripe: FakeDepositStripe) {
    const intent = stripe.customerAuthorizes({ accountId: ACCOUNT, reservationId });
    return { intent, outcome: await settle(reservationId, stripe, intent.id) };
  }

  test("a hold is authorized once and recorded with its facts", async () => {
    const reservationId = await createReservation();
    const stripe = stripeWithCard();

    const result = await request(reservationId, stripe);

    assert.equal(stripe.calls.length, 1);
    const [{ key, request: sent }] = stripe.calls;
    const [row] = await readHolds(reservationId);
    assert.equal(key, depositHoldIdempotencyKey(row.id));
    assert.deepEqual(sent, {
      accountId: ACCOUNT,
      attemptId: row.id,
      customerId: "cus_stripe",
      paymentMethodId: "pm_card",
      amountMinor: 5000,
      currency: "EUR",
      reservationId,
      reservationNumber: `N-${counter}`,
      customerName: "Ada Lovelace",
    });
    const paymentIntentId = stripe.held()[0].id;
    assert.deepEqual(result, { ok: true, paymentIntentId, amount: 50, currency: "EUR" });
    assert.deepEqual(row, {
      id: row.id,
      status: "authorized",
      paymentIntentId,
      amount: "50.00",
      currency: "EUR",
      grossMinor: 5000,
      insuranceShareMinor: 0,
      origin: "deposit",
      stripeAccountId: ACCOUNT,
      releaseOwedAt: null,
    });
    assert.deepEqual(await readDeposit(reservationId), {
      status: "authorized",
      paymentIntentId,
      paymentMethodId: "pm_card",
    });
    assert.deepEqual(await readActivity(reservationId), ["deposit_authorized"]);
  });

  test("the hold is in the reservation's currency, not the store's of today", async () => {
    const stripe = stripeWithCard();
    // Booked in euros; the store has moved to dollars since.
    const frozen = await createReservation({ currency: "EUR", depositAmount: "300.00" });
    // Booked before a reservation had its own currency: the store's.
    const legacy = await createReservation({ currency: null, depositAmount: "300.00" });
    const send = (reservationId: string) =>
      hold.authorizeDepositHold(
        {
          reservationId,
          storeId: STORE,
          stripeAccountId: ACCOUNT,
          storeSettings: { currency: "USD" },
          actorUserId: null,
        },
        depsOf(stripe),
      );

    const results = [await send(frozen), await send(legacy)];

    assert.deepEqual(
      stripe.calls.map((call) => [call.request.currency, call.request.amountMinor]),
      [
        ["EUR", 30_000],
        ["USD", 30_000],
      ],
    );
    assert.deepEqual(
      results.map((result) => result.ok && result.currency),
      ["EUR", "USD"],
    );
    assert.equal((await readHolds(frozen))[0].currency, "EUR");
    assert.equal((await readHolds(legacy))[0].currency, "USD");
  });

  test("two requests at once: one calls Stripe, the other finds the attempt in progress", async () => {
    const reservationId = await createReservation();
    const stripe = stripeWithCard();
    // Stripe answers once one of the two requests is back: the other one.
    let back = () => {};
    const oneBack = new Promise<void>((resolve) => {
      back = resolve;
    });
    stripe.next.push(async (authorization, key) => {
      await Promise.race([oneBack, new Promise((resolve) => setTimeout(resolve, 3_000))]);
      return stripe.accept(authorization, key);
    });
    const send = async () => {
      const result = await request(reservationId, stripe);
      back();
      return result;
    };

    const results = await raceOnLockedRow(database, { table: "reservations", id: reservationId }, [
      send,
      send,
    ]);

    assert.equal(stripe.calls.length, 1);
    assert.equal(stripe.held().length, 1);
    assert.deepEqual(results.map((result) => (result.ok ? "authorized" : result.error)).sort(), [
      "authorized",
      "errors.stripe.authorizationInProgress",
    ]);
    const holds = await readHolds(reservationId);
    assert.equal(holds.length, 1);
    assert.equal(holds[0].status, "authorized");
    assert.equal(holds[0].paymentIntentId, stripe.held()[0].id);
    assert.equal((await readDeposit(reservationId))?.paymentIntentId, stripe.held()[0].id);
  });

  test("an answer lost on its way back is looked up at once: the hold is recorded", async () => {
    const reservationId = await createReservation();
    const stripe = stripeWithCard();
    stripe.next.push(stripe.lostAnswer);

    const result = await request(reservationId, stripe);

    assert.equal(stripe.calls.length, 1);
    assert.equal(stripe.held().length, 1);
    assert.equal(result.ok && result.paymentIntentId, stripe.held()[0].id);
    assert.deepEqual(await holdStates(reservationId), [["authorized", stripe.held()[0].id]]);
    assert.equal((await readDeposit(reservationId))?.paymentIntentId, stripe.held()[0].id);
  });

  test("a request Stripe is still running is kept, then sent again with its key: one hold", async () => {
    const reservationId = await createReservation();
    const stripe = stripeWithCard();
    stripe.next.push(stripe.stillRunning);

    const first = await request(reservationId, stripe);

    assert.deepEqual(first, { ok: false, error: "errors.stripe.authorizationUnconfirmed" });
    // Nothing is decided: the deposit did not fail, and the attempt is kept. Finding
    // no PaymentIntent proved nothing: Stripe had not made it yet.
    assert.equal((await readDeposit(reservationId))?.status, "card_saved");
    assert.deepEqual(await holdStates(reservationId), [["pending", null]]);
    assert.deepEqual(await readActivity(reservationId), []);

    stripe.finishRunning();
    const second = await request(reservationId, stripe);

    assert.equal(stripe.calls.length, 2);
    assert.equal(stripe.calls[1].key, stripe.calls[0].key);
    assert.deepEqual(stripe.calls[1].request, stripe.calls[0].request);
    assert.equal(stripe.held().length, 1);
    assert.equal(second.ok && second.paymentIntentId, stripe.held()[0].id);
    assert.deepEqual(await holdStates(reservationId), [["authorized", stripe.held()[0].id]]);
    assert.equal((await readDeposit(reservationId))?.paymentIntentId, stripe.held()[0].id);
  });

  test("a request that never reached Stripe is sent again with its key", async () => {
    const reservationId = await createReservation();
    const stripe = stripeWithCard();
    stripe.next.push(stripe.neverArrives);

    assert.deepEqual(await request(reservationId, stripe), {
      ok: false,
      error: "errors.stripe.authorizationUnconfirmed",
    });
    const second = await request(reservationId, stripe);

    assert.equal(second.ok, true);
    assert.equal(stripe.calls[1].key, stripe.calls[0].key);
    assert.equal(stripe.held().length, 1);
    assert.equal((await readHolds(reservationId)).length, 1);
  });

  test("an attempt whose request died is refused while it may still run, then taken over", async () => {
    const reservationId = await createReservation();
    const stripe = stripeWithCard();
    // The first request reaches Stripe and its process dies: nothing gives the attempt back.
    let died = () => {};
    const reachedStripe = new Promise<void>((resolve) => {
      died = resolve;
    });
    let answerLate = () => {};
    stripe.next.push(async (authorization, key) => {
      const answer = await stripe.accept(authorization, key);
      died();
      return new Promise((resolve) => {
        answerLate = () => resolve(answer);
      });
    });
    const slow = request(reservationId, stripe);
    await reachedStripe;

    await ageAttempt(reservationId, MINUTE);
    const early = await request(reservationId, stripe);
    assert.deepEqual(early, { ok: false, error: "errors.stripe.authorizationInProgress" });
    assert.equal(stripe.calls.length, 1);

    await ageAttempt(reservationId, hold.DEPOSIT_HOLD_CLAIM_SECONDS * 1000);
    const takeover = await request(reservationId, stripe);
    assert.equal(takeover.ok, true);
    assert.equal(stripe.calls.length, 2);
    assert.equal(stripe.calls[1].key, stripe.calls[0].key);

    // The first request was only slow: it comes back and finds its hold recorded.
    answerLate();
    assert.deepEqual(await slow, takeover);
    assert.equal(stripe.held().length, 1);
    assert.deepEqual(await holdStates(reservationId), [["authorized", stripe.held()[0].id]]);
    assert.deepEqual(await readActivity(reservationId), ["deposit_authorized"]);
  });

  test("the webhook records the attempt's PaymentIntent first: the request adds nothing", async () => {
    const reservationId = await createReservation();
    const stripe = stripeWithCard();
    stripe.next.push(async (authorization, key) => {
      const answer = await stripe.accept(authorization, key);
      assert.equal(answer.kind, "created");
      if (answer.kind === "created") {
        assert.equal(
          await settle(reservationId, stripe, answer.intent.paymentIntentId),
          "authorized",
        );
      }
      return answer;
    });

    const result = await request(reservationId, stripe);

    assert.equal(result.ok, true);
    const holds = await readHolds(reservationId);
    assert.equal(holds.length, 1);
    assert.equal(holds[0].status, "authorized");
    assert.equal(holds[0].id, stripe.calls[0].request.attemptId);
    assert.deepEqual(await readActivity(reservationId), ["deposit_authorized"]);
  });

  test("the webhook settles an attempt left without an answer: no request calls Stripe again", async () => {
    const reservationId = await createReservation();
    const stripe = stripeWithCard();
    stripe.next.push(stripe.stillRunning);
    assert.equal((await request(reservationId, stripe)).ok, false);
    stripe.finishRunning();
    const [intent] = stripe.held();

    assert.equal(await settle(reservationId, stripe, intent.id), "authorized");
    const again = await request(reservationId, stripe);

    assert.deepEqual(again, { ok: false, error: "errors.stripe.invalidDepositStatus" });
    assert.equal(stripe.calls.length, 1);
    const holds = await readHolds(reservationId);
    assert.equal(holds.length, 1);
    assert.equal(holds[0].id, intent.attemptId);
    assert.equal(holds[0].paymentIntentId, intent.id);
    assert.equal((await readDeposit(reservationId))?.paymentIntentId, intent.id);
  });

  test("a declined card fails the deposit; a later attempt has a new key", async () => {
    const reservationId = await createReservation();
    const stripe = stripeWithCard();
    stripe.next.push(stripe.declined);

    const refused = await request(reservationId, stripe);

    assert.deepEqual(refused, { ok: false, error: "errors.stripe.authorizationFailed" });
    assert.equal((await readDeposit(reservationId))?.status, "failed");
    // The attempt keeps its row, which names the PaymentIntent Stripe made and says
    // it holds nothing: no other PaymentIntent can pass for that attempt's.
    const declined = stripe.intents[0].id;
    assert.deepEqual(await holdStates(reservationId), [["failed", declined]]);
    assert.deepEqual(await readActivity(reservationId), ["deposit_failed"]);
    assert.deepEqual(stripe.held(), []);
    // A failed deposit takes the customer's card again before the store can retry.
    assert.deepEqual(await request(reservationId, stripe), {
      ok: false,
      error: "errors.stripe.invalidDepositStatus",
    });
    assert.equal(stripe.calls.length, 1);

    await setReservation(reservationId, { depositStatus: "card_saved" });
    const retried = await request(reservationId, stripe);

    assert.equal(retried.ok, true);
    assert.equal(stripe.calls.length, 2);
    assert.notEqual(stripe.calls[1].key, stripe.calls[0].key);
    assert.deepEqual(await holdStates(reservationId), [
      ["authorized", stripe.held()[0].id],
      ["failed", declined],
    ]);
  });

  test("a PaymentIntent that is not capturable holds nothing: the deposit failed", async () => {
    const reservationId = await createReservation();
    const stripe = stripeWithCard();
    stripe.next.push(stripe.needsCustomer);

    assert.deepEqual(await request(reservationId, stripe), {
      ok: false,
      error: "errors.stripe.authorizationFailed",
    });
    assert.equal((await readDeposit(reservationId))?.status, "failed");
    assert.deepEqual(await holdStates(reservationId), [["failed", stripe.intents[0].id]]);
    assert.deepEqual(stripe.held(), []);
  });

  test("a request Stripe refuses outright made nothing: the attempt is closed, the deposit failed", async () => {
    const reservationId = await createReservation();
    const stripe = stripeWithCard();
    // The card was detached at Stripe since the checkout.
    stripe.saveCard(ACCOUNT, "pm_card", "");

    assert.deepEqual(await request(reservationId, stripe), {
      ok: false,
      error: "errors.stripe.authorizationFailed",
    });
    assert.equal((await readDeposit(reservationId))?.status, "failed");
    // Kept, closed, with what it was sent with.
    assert.deepEqual(await holdStates(reservationId), [["failed", null]]);
    assert.equal((await readHolds(reservationId))[0].stripeAccountId, ACCOUNT);
    assert.deepEqual(await readActivity(reservationId), ["deposit_failed"]);
    assert.deepEqual(stripe.intents, []);
  });

  test("a hold released then created again is a new attempt with a new key", async () => {
    const reservationId = await createReservation();
    const stripe = stripeWithCard();
    const first = await request(reservationId, stripe);
    assert.equal(first.ok, true);

    assert.deepEqual(await hold.releaseDepositHold(settlement(reservationId), depsOf(stripe)), {
      ok: true,
      amount: 50,
    });
    assert.deepEqual(stripe.held(), []);
    assert.equal((await readDeposit(reservationId))?.status, "released");
    assert.deepEqual(await readActivity(reservationId), ["deposit_authorized", "deposit_released"]);

    await setReservation(reservationId, { depositStatus: "card_saved" });
    const second = await request(reservationId, stripe);

    assert.equal(second.ok, true);
    assert.equal(stripe.calls.length, 2);
    assert.notEqual(stripe.calls[1].key, stripe.calls[0].key);
    assert.notEqual(second.ok && second.paymentIntentId, first.ok && first.paymentIntentId);
    assert.deepEqual(await holdStates(reservationId), [
      ["authorized", second.ok && second.paymentIntentId],
      ["cancelled", first.ok && first.paymentIntentId],
    ]);
    assert.equal(
      (await readDeposit(reservationId))?.paymentIntentId,
      second.ok && second.paymentIntentId,
    );
    assert.deepEqual(
      stripe.held().map((intent) => intent.id),
      [second.ok && second.paymentIntentId],
    );
  });

  test("an attempt left without an answer is asked again as it was sent, whatever changed", async () => {
    const reservationId = await createReservation();
    const stripe = stripeWithCard();
    stripe.next.push(stripe.stillRunning);
    assert.equal((await request(reservationId, stripe)).ok, false);
    stripe.finishRunning();

    // The deposit and the saved card change before the retry.
    await setReservation(reservationId, {
      depositAmount: "80.00",
      stripePaymentMethodId: "pm_other",
    });
    const second = await request(reservationId, stripe);

    assert.equal(second.ok, true);
    assert.deepEqual(stripe.calls[1], stripe.calls[0]);
    assert.equal(stripe.held().length, 1);
    const [row] = await readHolds(reservationId);
    assert.equal(row.amount, "50.00");
    assert.equal(row.grossMinor, 5000);
    // The card that carries the hold.
    assert.equal((await readDeposit(reservationId))?.paymentMethodId, "pm_card");
  });

  test("an attempt is sent again with the customer it stored, whatever the reservation names now", async () => {
    const reservationId = await createReservation();
    const stripe = stripeWithCard();
    stripe.next.push(stripe.stillRunning);
    assert.equal((await request(reservationId, stripe)).ok, false);
    stripe.finishRunning();
    stripe.pagesRead.length = 0;

    await setReservation(reservationId, { stripeCustomerId: "cus_stripe_new" });
    const second = await request(reservationId, stripe);

    assert.equal(second.ok, true);
    assert.deepEqual(
      stripe.calls.map((call) => call.request.customerId),
      ["cus_stripe", "cus_stripe"],
    );
    assert.deepEqual(stripe.pagesRead, []);
    assert.equal(stripe.held().length, 1);
  });

  test("a key Stripe refuses for other parameters: the attempt is looked up, not sent anew", async () => {
    const reservationId = await createReservation();
    const stripe = stripeWithCard();
    stripe.next.push(stripe.stillRunning);
    assert.equal((await request(reservationId, stripe)).ok, false);
    stripe.finishRunning();
    stripe.pagesRead.length = 0;
    // An attempt claimed before its customer was stored is sent with the reservation's.
    await louezDb.db
      .update(louezDb.payments)
      .set({ stripeCustomerId: null })
      .where(eq(louezDb.payments.reservationId, reservationId));

    // The reservation names another Stripe customer: the same key now carries other
    // parameters. The PaymentIntent is still with the customer the card belongs to.
    await setReservation(reservationId, { stripeCustomerId: "cus_stripe_new" });
    const second = await request(reservationId, stripe);

    assert.equal(second.ok, true);
    assert.equal(stripe.calls.length, 2);
    assert.deepEqual(stripe.pagesRead, [{ accountId: ACCOUNT, customerId: "cus_stripe" }]);
    assert.equal(stripe.held().length, 1);
    assert.equal(second.ok && second.paymentIntentId, stripe.held()[0].id);
    assert.equal((await readHolds(reservationId)).length, 1);
  });

  test("once its key may have expired, an attempt is looked up and never sent again", async () => {
    const reservationId = await createReservation();
    const stripe = stripeWithCard();
    stripe.next.push(stripe.stillRunning);
    assert.equal((await request(reservationId, stripe)).ok, false);
    stripe.finishRunning();

    await ageAttempt(reservationId, 30 * HOUR);
    const second = await request(reservationId, stripe);

    assert.equal(second.ok, true);
    assert.equal(stripe.calls.length, 1);
    assert.equal(stripe.held().length, 1);
    assert.equal((await readHolds(reservationId))[0].paymentIntentId, stripe.held()[0].id);
  });

  test("an old attempt Stripe never saw is closed, its row kept, and the request starts a new one", async () => {
    const reservationId = await createReservation();
    const stripe = stripeWithCard();
    stripe.next.push(stripe.neverArrives);
    assert.equal((await request(reservationId, stripe)).ok, false);

    await ageAttempt(reservationId, 30 * HOUR);
    const second = await request(reservationId, stripe);

    assert.equal(second.ok, true);
    assert.equal(stripe.calls.length, 2);
    assert.notEqual(stripe.calls[1].key, stripe.calls[0].key);
    assert.equal(stripe.held().length, 1);
    const holds = await readHolds(reservationId);
    assert.deepEqual(
      holds.map((row) => [row.id, row.status]),
      [
        [stripe.calls[0].request.attemptId, "failed"],
        [stripe.calls[1].request.attemptId, "authorized"],
      ],
    );
  });

  test("an attempt whose hold was cancelled since keeps its row, cancelled, and a new one starts", async () => {
    const reservationId = await createReservation();
    const stripe = stripeWithCard();
    stripe.next.push(stripe.stillRunning);
    assert.equal((await request(reservationId, stripe)).ok, false);
    stripe.finishRunning();
    // Cancelled in Stripe: the replayed answer still says requires_capture.
    const cancelled = stripe.held()[0].id;
    stripe.cancel(ACCOUNT, cancelled);

    const second = await request(reservationId, stripe);

    assert.equal(second.ok, true);
    assert.equal(stripe.calls.length, 3);
    assert.equal(stripe.calls[1].key, stripe.calls[0].key);
    assert.notEqual(stripe.calls[2].key, stripe.calls[0].key);
    assert.equal(stripe.held().length, 1);
    // The cancelled PaymentIntent has a row: an event about it finds it dead.
    assert.deepEqual(await holdStates(reservationId), [
      ["authorized", stripe.held()[0].id],
      ["cancelled", cancelled],
    ]);
    assert.equal((await readDeposit(reservationId))?.paymentIntentId, stripe.held()[0].id);
  });

  test("the customer authorizes meanwhile: the store's authorization is released", async () => {
    const reservationId = await createReservation();
    const stripe = stripeWithCard();
    let customers = "";
    stripe.next.push(async (authorization, key) => {
      const { intent, outcome } = await customerAuthorizes(reservationId, stripe);
      assert.equal(outcome, "authorized");
      customers = intent.id;
      return stripe.accept(authorization, key);
    });

    const result = await request(reservationId, stripe);

    assert.deepEqual(result, { ok: false, error: "errors.stripe.invalidDepositStatus" });
    // The store's authorization has its row before anything cancels it at Stripe:
    // Stripe still holds it, and the row says its release is owed.
    const stores = stripe.held().find((intent) => intent.id !== customers)?.id;
    assert.ok(stores);
    assert.deepEqual(await holdStates(reservationId), [
      ["authorized", customers],
      ["release_owed", stores],
    ]);
    assert.deepEqual(stripe.released, []);

    // The request handed the release to the outbox, which runs once it has answered.
    assert.deepEqual(await runHandedOver(stripe), { sent: 1, failed: 0, skipped: 0 });

    // Stripe holds the customer's authorization and no other.
    assert.deepEqual(
      stripe.held().map((intent) => intent.id),
      [customers],
    );
    assert.deepEqual(stripe.released, [stores]);
    assert.deepEqual(await holdStates(reservationId), [
      ["authorized", customers],
      ["cancelled", stores],
    ]);
    assert.equal((await readDeposit(reservationId))?.paymentIntentId, customers);
  });

  test("the same PaymentIntent recorded twice at once is one hold", async () => {
    const reservationId = await createReservation({ depositStatus: "pending" });
    const stripe = stripeWithCard();
    const intent = stripe.customerAuthorizes({ accountId: ACCOUNT, reservationId });
    const record = () => settle(reservationId, stripe, intent.id);

    const outcomes = await raceOnLockedRow(database, { table: "reservations", id: reservationId }, [
      record,
      record,
    ]);

    assert.deepEqual(outcomes, ["authorized", "authorized"]);
    assert.equal((await readHolds(reservationId)).length, 1);
    assert.deepEqual(await readActivity(reservationId), ["deposit_authorized"]);
  });

  test("a second authorization never replaces the hold the reservation references", async () => {
    const reservationId = await createReservation({ depositStatus: "pending" });
    const stripe = stripeWithCard();
    const one = (await customerAuthorizes(reservationId, stripe)).intent.id;

    const two = await customerAuthorizes(reservationId, stripe);

    assert.equal(two.outcome, "superseded");
    assert.equal((await readDeposit(reservationId))?.paymentIntentId, one);
    // The second has its row before anything cancels it at Stripe: its release is owed,
    // and one outbox row asks for it.
    assert.deepEqual(await holdStates(reservationId), [
      ["authorized", one],
      ["release_owed", two.intent.id],
    ]);
    const [effect, ...others] = await readReleaseEffects(reservationId);
    assert.deepEqual(others, []);
    assert.equal(effect.status, "pending");
    assert.equal(effect.payload.paymentIntentId, two.intent.id);
    assert.equal(effect.payload.accountId, ACCOUNT);
    assert.equal((await runHandedOver(stripe)).sent, 1);
    assert.deepEqual(
      stripe.held().map((intent) => intent.id),
      [one],
    );
  });

  test("a superseded authorization is never taken as the hold, even once the first is gone", async () => {
    const reservationId = await createReservation({ depositStatus: "pending" });
    const stripe = stripeWithCard();
    const one = (await customerAuthorizes(reservationId, stripe)).intent.id;
    // The second authorization is decided against; its cancellation at Stripe has not
    // happened yet.
    const two = await customerAuthorizes(reservationId, stripe);
    assert.equal(two.outcome, "superseded");

    // The first hold is released.
    assert.equal(
      (await hold.releaseDepositHold(settlement(reservationId), depsOf(stripe))).ok,
      true,
    );
    // The second's authorization event is delivered again, twice: it is not adopted,
    // and its release is not asked for a second time.
    assert.equal(await settle(reservationId, stripe, two.intent.id), "superseded");
    assert.equal(await settle(reservationId, stripe, two.intent.id), "superseded");
    assert.equal((await readReleaseEffects(reservationId)).length, 1);
    assert.equal((await readDeposit(reservationId))?.status, "released");

    assert.deepEqual(await runHandedOver(stripe), { sent: 1, failed: 0, skipped: 0 });

    assert.deepEqual(stripe.held(), []);
    assert.equal((await readDeposit(reservationId))?.status, "released");
    assert.deepEqual(await holdStates(reservationId), [
      ["cancelled", one],
      ["cancelled", two.intent.id],
    ]);
  });

  describe("a release Louez owes is the outbox's work", () => {
    /** A reservation that holds the customer's authorization, and a second one decided against. */
    async function supersede(stripe: FakeDepositStripe) {
      const reservationId = await createReservation({ depositStatus: "pending" });
      const kept = (await customerAuthorizes(reservationId, stripe)).intent.id;
      const owed = await customerAuthorizes(reservationId, stripe);
      assert.equal(owed.outcome, "superseded");
      return { reservationId, kept, owed: owed.intent.id };
    }

    test("a release Stripe cannot take is tried again until it passes, and no request sweeps for it", async () => {
      const stripe = stripeWithCard();
      const { reservationId, kept, owed } = await supersede(stripe);
      stripe.failReleases(2);

      // The first run, right after the write: Stripe is down.
      assert.deepEqual(await runHandedOver(stripe), { sent: 0, failed: 1, skipped: 0 });
      assert.equal(stripe.held().length, 2);
      // The row does not say cancelled while Stripe holds the card.
      assert.deepEqual(await holdStates(reservationId), [
        ["authorized", kept],
        ["release_owed", owed],
      ]);
      const [failed] = await readReleaseEffects(reservationId);
      assert.deepEqual([failed.status, failed.attempts], ["failed", 1]);

      // Neither the store's next request nor an event about the hold retries it:
      // only the outbox does, on its own schedule.
      assert.deepEqual(await request(reservationId, stripe), {
        ok: false,
        error: "errors.stripe.invalidDepositStatus",
      });
      assert.equal(await settle(reservationId, stripe, owed), "superseded");
      assert.equal(stripe.releaseCalls.length, 1);
      assert.deepEqual(handedOver, []);

      // The cron's pass, once the retry is due: down again, then through.
      assert.equal((await runCron(reservationId, stripe)).failed, 1);
      assert.equal(stripe.held().length, 2);
      assert.equal((await runCron(reservationId, stripe)).sent, 1);

      assert.deepEqual(stripe.releaseCalls, [owed, owed, owed]);
      assert.deepEqual(
        stripe.held().map((intent) => intent.id),
        [kept],
      );
      assert.deepEqual(await holdStates(reservationId), [
        ["authorized", kept],
        ["cancelled", owed],
      ]);
      const [sent] = await readReleaseEffects(reservationId);
      assert.deepEqual([sent.status, sent.attempts], ["sent", 3]);
      // Released once: nothing is owed, and nothing runs again.
      assert.deepEqual(await runCron(reservationId, stripe), { sent: 0, failed: 0, skipped: 0 });
      assert.equal(stripe.releaseCalls.length, 3);
    });

    test("a process that dies right after recording the debt leaves it to the cron", async () => {
      const stripe = stripeWithCard();
      const { reservationId, kept, owed } = await supersede(stripe);
      // The request never reached its dispatcher.
      handedOver.length = 0;

      assert.equal((await runCron(reservationId, stripe)).sent, 1);

      assert.deepEqual(stripe.released, [owed]);
      assert.deepEqual(await holdStates(reservationId), [
        ["authorized", kept],
        ["cancelled", owed],
      ]);
    });

    test("an authorization Stripe cancelled or captured meanwhile is recorded as such, and the debt ends", async () => {
      const stripe = stripeWithCard();
      const expired = await supersede(stripe);
      const taken = await supersede(stripe);
      // Before the outbox ran: one authorization expired at Stripe, the other was
      // captured from Stripe's dashboard.
      stripe.cancel(ACCOUNT, expired.owed);
      stripe.captureAtStripe(ACCOUNT, taken.owed, 2000);

      assert.deepEqual(await runHandedOver(stripe), { sent: 2, failed: 0, skipped: 0 });

      assert.deepEqual(await holdStates(expired.reservationId), [
        ["authorized", expired.kept],
        ["cancelled", expired.owed],
      ]);
      // The money Stripe took is recorded; the reservation keeps the hold it has.
      assert.deepEqual(await holdStates(taken.reservationId), [
        ["authorized", taken.kept],
        ["completed", taken.owed],
      ]);
      assert.deepEqual(await readCaptures(taken.reservationId), [
        { paymentIntentId: taken.owed, amount: "20.00", status: "completed" },
      ]);
      assert.deepEqual(await readDeposit(taken.reservationId), {
        status: "authorized",
        paymentIntentId: taken.kept,
        paymentMethodId: "pm_customer",
      });
    });

    test("the webhook hears of the release first: the outbox row finds nothing owed", async () => {
      const stripe = stripeWithCard();
      const { reservationId, owed } = await supersede(stripe);
      const [effect] = await readReleaseEffects(reservationId);
      stripe.cancel(ACCOUNT, owed);
      assert.equal(await settle(reservationId, stripe, owed), "released");

      assert.deepEqual(await runHandedOver(stripe), { sent: 0, failed: 0, skipped: 1 });
      assert.deepEqual(stripe.releaseCalls, []);
      // Done, with nothing left to do: the cron never runs it again.
      assert.equal((await outbox.readEffects([effect.id]))[0].status, "cancelled");
    });

    test("the outbox gives up after its attempts: the row still says the release is owed", async () => {
      const stripe = stripeWithCard();
      const { reservationId, kept, owed } = await supersede(stripe);
      handedOver.length = 0;
      stripe.failReleases(Number.POSITIVE_INFINITY);

      for (let run = 0; run < outbox.EFFECT_MAX_ATTEMPTS + 2; run++) {
        await runCron(reservationId, stripe);
      }

      // Bounded: no call past the last attempt.
      assert.equal(stripe.releaseCalls.length, outbox.EFFECT_MAX_ATTEMPTS);
      const [effect] = await readReleaseEffects(reservationId);
      assert.deepEqual(
        [effect.status, effect.attempts],
        ["abandoned", outbox.EFFECT_MAX_ATTEMPTS],
      );
      // Stripe holds it, and Louez does not say otherwise: the inbox shows it
      // (packages/api services/inbox.ts, `deposit_release_failed`).
      assert.equal(stripe.held().length, 2);
      assert.deepEqual(await holdStates(reservationId), [
        ["authorized", kept],
        ["release_owed", owed],
      ]);
    });

    /** The cron's pass over the debts, as far as this reservation's go. */
    async function requeue(reservationId: string) {
      const ids = await holdWrites.requeueOwedReleases(louezDb.db, 1000);
      const ours = new Set((await readReleaseEffects(reservationId)).map((row) => row.id));
      return ids.filter((id) => ours.has(id));
    }

    test("a row an instance without its sender abandoned: the debt gets a new row a day later, and is released", async () => {
      const stripe = stripeWithCard();
      const { reservationId, kept, owed } = await supersede(stripe);
      handedOver.length = 0;
      // An instance still running the previous code claims the row and has no sender
      // for it, every time, until the outbox gives up.
      const [first] = await readReleaseEffects(reservationId);
      for (let run = 0; run < outbox.EFFECT_MAX_ATTEMPTS + 1; run++) {
        await louezDb.db
          .update(louezDb.apiEffects)
          .set({ nextAttemptAt: sql`NOW(3) - INTERVAL 1 SECOND` })
          .where(eq(louezDb.apiEffects.id, first.id));
        await outbox.dispatchEffects([first.id], {} as ApiEffectSenders);
      }
      assert.equal((await outbox.readEffects([first.id]))[0].status, "abandoned");
      assert.deepEqual(stripe.releaseCalls, []);

      // Within a day of the last row: nothing more.
      assert.deepEqual(await requeue(reservationId), []);

      await louezDb.db
        .update(louezDb.apiEffects)
        .set({ createdAt: sql`NOW(3) - INTERVAL 25 HOUR` })
        .where(eq(louezDb.apiEffects.id, first.id));
      const added = await requeue(reservationId);
      assert.equal(added.length, 1);
      // One row per debt: the next pass finds it waiting.
      assert.deepEqual(await requeue(reservationId), []);

      assert.deepEqual(await outbox.dispatchEffects(added, sendersOf(stripe)), {
        sent: 1,
        failed: 0,
        skipped: 0,
      });
      assert.deepEqual(stripe.released, [owed]);
      assert.deepEqual(await holdStates(reservationId), [
        ["authorized", kept],
        ["cancelled", owed],
      ]);
      // Nothing is owed any more: nothing is added again.
      assert.deepEqual(await requeue(reservationId), []);
    });

    test("a debt whose outbox row the retention deleted gets a new one", async () => {
      const stripe = stripeWithCard();
      const { reservationId, kept, owed } = await supersede(stripe);
      handedOver.length = 0;
      const [first] = await readReleaseEffects(reservationId);
      await louezDb.db.delete(louezDb.apiEffects).where(eq(louezDb.apiEffects.id, first.id));

      const added = await requeue(reservationId);

      assert.equal(added.length, 1);
      assert.deepEqual(
        (await readReleaseEffects(reservationId)).map((row) => row.payload),
        [{ reservationId, paymentId: first.payload.paymentId, accountId: ACCOUNT, paymentIntentId: owed }],
      );
      await outbox.dispatchEffects(added, sendersOf(stripe));
      assert.deepEqual(await holdStates(reservationId), [
        ["authorized", kept],
        ["cancelled", owed],
      ]);
    });
  });

  test("a reservation that cannot take a hold is refused before Stripe", async () => {
    const stripe = stripeWithCard();
    const cases = [
      [await createReservation({ paymentMethodId: null }), "errors.stripe.noSavedCard"],
      [await createReservation({ customerId: null }), "errors.stripe.noSavedCard"],
      [await createReservation({ depositStatus: "pending" }), "errors.stripe.invalidDepositStatus"],
      [await createReservation({ depositAmount: "0.00" }), "errors.stripe.noDepositRequired"],
    ] as const;

    for (const [reservationId, error] of cases) {
      assert.deepEqual(await request(reservationId, stripe), { ok: false, error });
      assert.deepEqual(await readHolds(reservationId), []);
    }
    // Another store's reservation does not exist for this one.
    const reservationId = await createReservation();
    assert.deepEqual(
      await hold.authorizeDepositHold(
        {
          reservationId,
          storeId: "store_other",
          stripeAccountId: ACCOUNT,
          storeSettings: null,
          actorUserId: null,
        },
        depsOf(stripe),
      ),
      { ok: false, error: "errors.reservationNotFound" },
    );
    assert.equal(stripe.calls.length, 0);
  });

  test("each write about a hold marks the reservation for the billing service", async () => {
    const env = { billing: process.env.LOUEZ_BILLING, url: process.env.BILLING_SERVICE_URL };
    process.env.LOUEZ_BILLING = "cloud";
    process.env.BILLING_SERVICE_URL = "http://localhost:3100";
    const readMark = async (reservationId: string) => {
      const q = louezDb.billingSyncQueue;
      const [row] = await louezDb.db
        .select({ version: q.version })
        .from(q)
        .where(and(eq(q.aggregateType, "reservation"), eq(q.aggregateId, reservationId)));
      return row?.version ?? 0;
    };
    try {
      const stripe = stripeWithCard();
      const captured = await createReservation();
      const released = await createReservation();

      assert.equal((await request(captured, stripe)).ok, true);
      assert.equal((await request(released, stripe)).ok, true);
      const authorized = [await readMark(captured), await readMark(released)];
      await hold.captureDepositHold(
        { ...settlement(captured), amount: 10, reason: "scratch" },
        depsOf(stripe),
      );
      await hold.releaseDepositHold(settlement(released), depsOf(stripe));

      assert.ok(authorized[0] > 0 && authorized[1] > 0);
      assert.ok((await readMark(captured)) > authorized[0]);
      assert.ok((await readMark(released)) > authorized[1]);
    } finally {
      for (const [name, value] of [
        ["LOUEZ_BILLING", env.billing],
        ["BILLING_SERVICE_URL", env.url],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  describe("an attempt is settled on the account it was sent to", () => {
    test("the store changed connected accounts: the retry asks the first account, and its hold is recorded", async () => {
      const reservationId = await createReservation();
      const stripe = stripeWithCard();
      stripe.next.push(stripe.stillRunning);
      assert.equal((await request(reservationId, stripe)).ok, false);
      stripe.finishRunning();
      assert.equal(stripe.held(ACCOUNT).length, 1);

      // The store disconnects that account and connects another, which knows neither
      // the customer nor the card.
      const second = await request(reservationId, stripe, { accountId: NEXT_ACCOUNT });

      assert.equal(stripe.calls[1].request.accountId, ACCOUNT);
      assert.equal(second.ok && second.paymentIntentId, stripe.held(ACCOUNT)[0].id);
      assert.deepEqual(stripe.held(NEXT_ACCOUNT), []);
      const [row] = await readHolds(reservationId);
      assert.equal(row.status, "authorized");
      assert.equal(row.stripeAccountId, ACCOUNT);
      assert.equal(row.paymentIntentId, stripe.held(ACCOUNT)[0].id);
      assert.equal((await readDeposit(reservationId))?.status, "authorized");
    });

    test("a hold left on the first account is captured and released there", async () => {
      const stripe = stripeWithCard();
      const captured = await createReservation();
      const released = await createReservation();
      assert.equal((await request(captured, stripe)).ok, true);
      assert.equal((await request(released, stripe)).ok, true);

      // The store is on another account now, or on none.
      const capture = await hold.captureDepositHold(
        { ...settlement(captured, NEXT_ACCOUNT), amount: 20, reason: "broken wheel" },
        depsOf(stripe),
      );
      const release = await hold.releaseDepositHold(settlement(released, null), depsOf(stripe));

      assert.equal(capture.ok && capture.amountCapturedMinor, 2000);
      assert.equal(release.ok, true);
      assert.deepEqual(stripe.held(), []);
      assert.equal((await readDeposit(captured))?.status, "captured");
      assert.equal((await readDeposit(released))?.status, "released");
    });

    test("a lookup reads the attempt's account only", async () => {
      const reservationId = await createReservation();
      const stripe = stripeWithCard();
      stripe.next.push(stripe.neverArrives);
      assert.equal((await request(reservationId, stripe)).ok, false);
      const attemptId = stripe.calls[0].request.attemptId;
      // Another account holds a PaymentIntent that names the same attempt and customer.
      stripe.createIntent({
        accountId: NEXT_ACCOUNT,
        customerId: "cus_stripe",
        paymentMethodId: "pm_card",
        amountMinor: 5000,
        currency: "EUR",
        status: "requires_capture",
        attemptId,
        reservationId,
      });
      stripe.pagesRead.length = 0;

      await ageAttempt(reservationId, 30 * HOUR);
      const second = await request(reservationId, stripe);

      // Nothing answers the attempt on its own account: a new one starts there.
      assert.deepEqual(stripe.pagesRead, [{ accountId: ACCOUNT, customerId: "cus_stripe" }]);
      assert.equal(second.ok, true);
      assert.equal(stripe.held(ACCOUNT).length, 1);
      assert.equal((await readHolds(reservationId))[0].stripeAccountId, ACCOUNT);
      await assert.rejects(stripe.port.readIntent(ACCOUNT, stripe.held(NEXT_ACCOUNT)[0].id));
    });
  });

  describe("an answer that tells nothing never ends an attempt", () => {
    test("a Stripe 500 that Stripe turns into an authorization later: one hold, never a second attempt", async () => {
      const reservationId = await createReservation();
      const stripe = stripeWithCard();
      stripe.next.push(stripe.serverError("later"));

      // The 500 itself proves nothing: the attempt is kept.
      assert.deepEqual(await request(reservationId, stripe), {
        ok: false,
        error: "errors.stripe.authorizationUnconfirmed",
      });
      // The key now only ever answers that 500, and Stripe lists no PaymentIntent:
      // that is no proof either. The attempt stays, and nothing else is asked for.
      for (let retry = 0; retry < 3; retry++) {
        assert.deepEqual(await request(reservationId, stripe), {
          ok: false,
          error: "errors.stripe.authorizationUnconfirmed",
        });
      }
      assert.deepEqual(await holdStates(reservationId), [["pending", null]]);
      assert.equal((await readDeposit(reservationId))?.status, "card_saved");
      assert.deepEqual(await readActivity(reservationId), []);
      assert.deepEqual(new Set(stripe.calls.map((call) => call.key)).size, 1);

      // Stripe reconciles the request it answered 500 to: the authorization exists.
      const [reconciled] = stripe.reconcile();
      assert.deepEqual(stripe.held(), [reconciled]);

      const recovered = await request(reservationId, stripe);

      assert.deepEqual(recovered, {
        ok: true,
        paymentIntentId: reconciled.id,
        amount: 50,
        currency: "EUR",
      });
      assert.deepEqual(new Set(stripe.calls.map((call) => call.key)).size, 1);
      // One hold at Stripe, on the attempt's row.
      assert.deepEqual(stripe.held(), [reconciled]);
      const [row, ...others] = await readHolds(reservationId);
      assert.deepEqual(others, []);
      assert.deepEqual(
        [row.id, row.status, row.paymentIntentId],
        [reconciled.attemptId, "authorized", reconciled.id],
      );
      assert.equal((await readDeposit(reservationId))?.paymentIntentId, reconciled.id);
    });

    test("the webhook brings the authorization Stripe reconciled, onto the attempt's row", async () => {
      const reservationId = await createReservation();
      const stripe = stripeWithCard();
      stripe.next.push(stripe.serverError("later"));
      assert.equal((await request(reservationId, stripe)).ok, false);
      assert.equal((await request(reservationId, stripe)).ok, false);
      const [reconciled] = stripe.reconcile();

      assert.equal(await settle(reservationId, stripe, reconciled.id), "authorized");

      assert.deepEqual(await holdStates(reservationId), [["authorized", reconciled.id]]);
      // The store's next click finds the hold, and calls nobody.
      const calls = stripe.calls.length;
      assert.deepEqual(await request(reservationId, stripe), {
        ok: false,
        error: "errors.stripe.invalidDepositStatus",
      });
      assert.equal(stripe.calls.length, calls);
      assert.equal(stripe.held().length, 1);
    });

    test("a Stripe 500 that never becomes anything: the attempt is kept while its key lives, and replaced only after", async () => {
      const reservationId = await createReservation();
      const stripe = stripeWithCard();
      stripe.next.push(stripe.serverError("never"));
      assert.equal((await request(reservationId, stripe)).ok, false);

      // An hour before the key's life is over, counted from the last request: the
      // attempt is too old to send again, and still not proven empty.
      await ageAttempt(reservationId, 23 * HOUR + 30 * MINUTE);
      assert.deepEqual(await request(reservationId, stripe), {
        ok: false,
        error: "errors.stripe.authorizationUnconfirmed",
      });
      assert.equal(stripe.calls.length, 1);
      assert.deepEqual(await holdStates(reservationId), [["pending", null]]);

      // Past it, Stripe can no longer make anything of that request, and a complete
      // listing shows nothing: the attempt is over, and the request starts a new one.
      await ageAttempt(reservationId, HOUR);
      const second = await request(reservationId, stripe);

      assert.equal(second.ok, true);
      assert.equal(stripe.calls.length, 2);
      assert.notEqual(stripe.calls[1].key, stripe.calls[0].key);
      assert.equal(stripe.held().length, 1);
      assert.deepEqual(await holdStates(reservationId), [
        ["authorized", stripe.held()[0].id],
        ["failed", null],
      ]);
    });

    test("a Stripe 500 reconciled after its attempt was closed, on an account the store left: recorded, and released", async () => {
      const reservationId = await createReservation();
      const stripe = stripeWithCard();
      stripe.saveCard(NEXT_ACCOUNT, "pm_card", "cus_stripe");
      stripe.next.push(stripe.serverError("later"));
      assert.equal((await request(reservationId, stripe)).ok, false);
      const [first] = await readHolds(reservationId);

      // The store moves to another account; more than a day later, the first account's
      // listing is complete and empty: the attempt is closed, and a new one authorized.
      await louezDb.db
        .update(louezDb.stores)
        .set({ stripeAccountId: NEXT_ACCOUNT })
        .where(eq(louezDb.stores.id, STORE));
      try {
        await ageAttempt(reservationId, 25 * HOUR);
        const second = await request(reservationId, stripe, { accountId: NEXT_ACCOUNT });
        assert.equal(second.ok, true);

        // Stripe reconciles the first request after all; its webhook comes from the
        // account the store left.
        const [late] = stripe.reconcile();
        assert.equal(late.attemptId, first.id);
        assert.equal(await settle(reservationId, stripe, late.id, ACCOUNT), "superseded");
        assert.equal(stripe.held().length, 2);
        assert.deepEqual(await holdStates(reservationId), [
          ["authorized", stripe.held(NEXT_ACCOUNT)[0].id],
          ["release_owed", late.id],
        ]);
        assert.equal((await readHolds(reservationId)).find((row) => row.id === first.id)?.stripeAccountId, ACCOUNT);

        // The outbox releases it on the account it was made on.
        await runHandedOver(stripe);
        assert.deepEqual(stripe.released, [late.id]);
        assert.deepEqual(await holdStates(reservationId), [
          ["authorized", stripe.held(NEXT_ACCOUNT)[0].id],
          ["cancelled", late.id],
        ]);
      } finally {
        await louezDb.db
          .update(louezDb.stores)
          .set({ stripeAccountId: ACCOUNT })
          .where(eq(louezDb.stores.id, STORE));
      }
    });

    test("a closed attempt whose PaymentIntent shows up while the reservation holds none becomes the hold", async () => {
      const reservationId = await createReservation();
      const stripe = stripeWithCard();
      stripe.next.push(stripe.serverError("later"));
      assert.equal((await request(reservationId, stripe)).ok, false);
      await ageAttempt(reservationId, 25 * HOUR);
      // The next request finds a complete, empty listing and closes the attempt; the
      // card is then declined, so the reservation holds nothing.
      stripe.next.push(stripe.declined);
      assert.equal((await request(reservationId, stripe)).ok, false);
      const closed = (await readHolds(reservationId)).find(
        (row) => row.id === stripe.calls[0].request.attemptId,
      );
      assert.equal(closed?.status, "failed");

      const [late] = stripe.reconcile();
      assert.equal(await settle(reservationId, stripe, late.id), "authorized");
      assert.deepEqual(await readDeposit(reservationId), {
        status: "authorized",
        paymentIntentId: late.id,
        paymentMethodId: "pm_card",
      });
    });

    test("a Stripe 500 that authorized all the same: the hold is found and recorded", async () => {
      const reservationId = await createReservation();
      const stripe = stripeWithCard();
      stripe.next.push(stripe.serverError("now"));

      const result = await request(reservationId, stripe);

      assert.equal(stripe.calls.length, 1);
      assert.equal(stripe.held().length, 1);
      assert.equal(result.ok && result.paymentIntentId, stripe.held()[0].id);
      assert.deepEqual(await holdStates(reservationId), [["authorized", stripe.held()[0].id]]);
    });

    test("a refusal of a request sent again deletes no attempt whose hold exists", async () => {
      const reservationId = await createReservation();
      const stripe = stripeWithCard();
      stripe.next.push(stripe.stillRunning);
      assert.equal((await request(reservationId, stripe)).ok, false);
      stripe.finishRunning();
      // The retry is refused, as a request that reaches an account without the card is.
      stripe.next.push(async () => ({
        kind: "refused",
        paymentIntentId: null,
        message: "No such PaymentMethod: 'pm_card'",
      }));

      const second = await request(reservationId, stripe);

      assert.equal(second.ok && second.paymentIntentId, stripe.held()[0].id);
      assert.deepEqual(await holdStates(reservationId), [["authorized", stripe.held()[0].id]]);
    });

    test("a refusal of a request sent again, with nothing at Stripe, ends the attempt as failed", async () => {
      const reservationId = await createReservation();
      const stripe = stripeWithCard();
      stripe.next.push(stripe.neverArrives);
      assert.equal((await request(reservationId, stripe)).ok, false);
      stripe.next.push(async () => ({
        kind: "refused",
        paymentIntentId: null,
        message: "No such PaymentMethod: 'pm_card'",
      }));

      assert.deepEqual(await request(reservationId, stripe), {
        ok: false,
        error: "errors.stripe.authorizationFailed",
      });
      assert.deepEqual(await holdStates(reservationId), [["failed", null]]);
      assert.equal((await readDeposit(reservationId))?.status, "failed");
      assert.deepEqual(stripe.held(), []);
    });
  });

  describe("the store resolves an attempt Stripe has not confirmed", () => {
    const STORE_USER = "user_store_owner";
    const resolve = (
      reservationId: string,
      stripe: FakeDepositStripe,
      resolution: Parameters<typeof hold.resolveUnconfirmedAttempt>[0]["resolution"],
    ) =>
      hold.resolveUnconfirmedAttempt(
        { reservationId, storeId: STORE, actorUserId: STORE_USER, resolution },
        depsOf(stripe),
      );

    /** An attempt nothing can settle: claimed before its customer was stored, its card detached since. */
    async function stuckAttempt(stripe: FakeDepositStripe) {
      const reservationId = await createReservation();
      stripe.next.push(stripe.neverArrives);
      assert.equal((await request(reservationId, stripe)).ok, false);
      await louezDb.db
        .update(louezDb.payments)
        .set({ stripeCustomerId: null })
        .where(eq(louezDb.payments.reservationId, reservationId));
      await ageAttempt(reservationId, 9 * DAY);
      stripe.saveCard(ACCOUNT, "pm_card", "");
      // Stuck: no request can settle it, whatever its age.
      assert.deepEqual(await request(reservationId, stripe), {
        ok: false,
        error: "errors.stripe.authorizationUnconfirmed",
      });
      return reservationId;
    }

    test("nothing at Stripe: the attempt nothing could settle is closed, who closed it is recorded, and a new hold can be asked", async () => {
      const stripe = stripeWithCard();
      const reservationId = await stuckAttempt(stripe);
      const [attempt] = await readHolds(reservationId);

      assert.deepEqual(await resolve(reservationId, stripe, { kind: "nothing_at_stripe" }), {
        ok: true,
        outcome: "closed",
        paymentIntentId: null,
      });

      assert.deepEqual(await holdStates(reservationId), [["failed", null]]);
      // The deposit is not failed: the card is still saved, and nothing was declined.
      assert.equal((await readDeposit(reservationId))?.status, "card_saved");
      const a = louezDb.reservationActivity;
      const lines = await louezDb.db
        .select({ type: a.activityType, userId: a.userId, metadata: a.metadata })
        .from(a)
        .where(eq(a.reservationId, reservationId));
      assert.deepEqual(
        lines.map((line) => [line.type, line.userId, line.metadata?.closedBy, line.metadata?.attemptId]),
        [["deposit_failed", STORE_USER, "store", attempt.id]],
      );

      stripe.saveCard(ACCOUNT, "pm_card", "cus_stripe");
      const next = await request(reservationId, stripe);
      assert.equal(next.ok, true);
      assert.notEqual(stripe.calls.at(-1)?.request.attemptId, attempt.id);
      // Asked again: nothing is left to resolve.
      assert.deepEqual(await resolve(reservationId, stripe, { kind: "nothing_at_stripe" }), {
        ok: false,
        error: "no_unconfirmed_attempt",
      });
    });

    test("nothing at Stripe, while Louez's lookup finds the hold: it is recorded, and the declaration refused", async () => {
      const reservationId = await createReservation();
      const stripe = stripeWithCard();
      stripe.next.push(stripe.serverError("later"));
      assert.equal((await request(reservationId, stripe)).ok, false);
      const [late] = stripe.reconcile();

      assert.deepEqual(await resolve(reservationId, stripe, { kind: "nothing_at_stripe" }), {
        ok: false,
        error: "found_at_stripe",
        paymentIntentId: late.id,
        outcome: "authorized",
      });
      assert.deepEqual(await holdStates(reservationId), [["authorized", late.id]]);
      assert.equal((await readDeposit(reservationId))?.status, "authorized");
    });

    test("a request that never reached Stripe: the store's word closes it at once", async () => {
      const reservationId = await createReservation();
      const stripe = stripeWithCard();
      stripe.next.push(stripe.neverArrives);
      assert.equal((await request(reservationId, stripe)).ok, false);

      assert.equal((await resolve(reservationId, stripe, { kind: "nothing_at_stripe" })).ok, true);
      assert.equal((await request(reservationId, stripe)).ok, true);
      assert.equal(stripe.held().length, 1);
    });

    test("a closed attempt Stripe made a hold of after all is recorded and released when the reservation holds another", async () => {
      const reservationId = await createReservation();
      const stripe = stripeWithCard();
      stripe.next.push(stripe.serverError("later"));
      assert.equal((await request(reservationId, stripe)).ok, false);
      // The listing is complete and empty, and Stripe has not reconciled yet: the store
      // closes the attempt in good faith, and a new hold is authorized.
      assert.equal((await resolve(reservationId, stripe, { kind: "nothing_at_stripe" })).ok, true);
      const kept = await request(reservationId, stripe);
      assert.equal(kept.ok, true);

      const [late] = stripe.reconcile();
      assert.equal(await settle(reservationId, stripe, late.id), "superseded");
      await runHandedOver(stripe);

      assert.deepEqual(stripe.released, [late.id]);
      assert.deepEqual(
        stripe.held().map((intent) => intent.id),
        [kept.ok && kept.paymentIntentId],
      );
    });

    test("the store names the PaymentIntent a lookup could not reach: it is checked, then recorded", async () => {
      const stripe = stripeWithCard();
      const reservationId = await stuckAttempt(stripe);
      const [attempt] = await readHolds(reservationId);
      // What Stripe made of the attempt, which no lookup could reach.
      const made = stripe.createIntent({
        accountId: ACCOUNT,
        customerId: "cus_stripe",
        paymentMethodId: "pm_card",
        amountMinor: 5000,
        currency: "EUR",
        status: "requires_capture",
        attemptId: attempt.id,
        reservationId,
      });

      assert.deepEqual(
        await resolve(reservationId, stripe, { kind: "payment_intent", paymentIntentId: made.id }),
        { ok: true, outcome: "authorized", paymentIntentId: made.id },
      );
      assert.deepEqual(await holdStates(reservationId), [["authorized", made.id]]);
      assert.deepEqual(await readDeposit(reservationId), {
        status: "authorized",
        paymentIntentId: made.id,
        paymentMethodId: "pm_card",
      });
    });

    test("a PaymentIntent that is not the attempt's own is refused, and nothing is written", async () => {
      const stripe = stripeWithCard();
      const reservationId = await stuckAttempt(stripe);
      const [attempt] = await readHolds(reservationId);
      const intentWith = (values: Partial<FakeIntent>) =>
        stripe.createIntent({
          accountId: ACCOUNT,
          customerId: "cus_stripe",
          paymentMethodId: "pm_card",
          amountMinor: 5000,
          currency: "EUR",
          status: "requires_capture",
          attemptId: attempt.id,
          reservationId,
          ...values,
        });
      const cases: Array<[Partial<FakeIntent>, string[]]> = [
        // Everything the attempt was sent with, and no reference to it: the customer's
        // own authorization, or one made outside Louez.
        [{ attemptId: null, reservationId: null }, ["reservation", "attempt"]],
        // Another reservation's, on the same card.
        [
          { attemptId: "attempt_another", reservationId: "res_another_one_000000" },
          ["reservation", "attempt"],
        ],
        // This reservation's, but not this attempt's, or no attempt's.
        [{ attemptId: "attempt_another" }, ["attempt"]],
        [{ attemptId: null }, ["attempt"]],
        [{ reservationId: null }, ["reservation"]],
        [{ amountMinor: 9000 }, ["amount"]],
        [{ currency: "USD" }, ["currency"]],
        [{ paymentMethodId: "pm_customer", customerId: null }, ["card", "customer"]],
        [{ captureMethod: "automatic" }, ["capture_method"]],
      ];
      for (const [values, mismatches] of cases) {
        const intent = intentWith(values);
        assert.deepEqual(
          await resolve(reservationId, stripe, {
            kind: "payment_intent",
            paymentIntentId: intent.id,
          }),
          { ok: false, error: "intent_mismatch", mismatches },
          JSON.stringify(values),
        );
      }
      // Not on the attempt's account.
      assert.deepEqual(
        await resolve(reservationId, stripe, {
          kind: "payment_intent",
          paymentIntentId: "pi_nowhere",
        }),
        { ok: false, error: "intent_not_found" },
      );
      assert.deepEqual(await holdStates(reservationId), [["pending", null]]);
      assert.equal((await readHolds(reservationId))[0].id, attempt.id);
      assert.equal((await readDeposit(reservationId))?.status, "card_saved");
      assert.deepEqual(await readActivity(reservationId), []);
    });

    /** What Stripe made of the reservation's stuck attempt, which no lookup could reach. */
    async function madeOfAttempt(stripe: FakeDepositStripe, reservationId: string) {
      const [attempt] = await readHolds(reservationId);
      return stripe.createIntent({
        accountId: ACCOUNT,
        customerId: "cus_stripe",
        paymentMethodId: "pm_card",
        amountMinor: 5000,
        currency: "EUR",
        status: "requires_capture",
        attemptId: attempt.id,
        reservationId,
      });
    }

    test("the attempt's own PaymentIntent, once recorded, is captured and released as any hold", async () => {
      const stripe = stripeWithCard();
      const captured = await stuckAttempt(stripe);
      const released = await stuckAttempt(stripe);
      const forCapture = await madeOfAttempt(stripe, captured);
      const forRelease = await madeOfAttempt(stripe, released);
      for (const [reservationId, intent] of [
        [captured, forCapture],
        [released, forRelease],
      ] as const) {
        assert.deepEqual(
          await resolve(reservationId, stripe, {
            kind: "payment_intent",
            paymentIntentId: intent.id,
          }),
          { ok: true, outcome: "authorized", paymentIntentId: intent.id },
        );
      }

      // Part of it is captured: Stripe and Louez agree on what was taken.
      const capture = await hold.captureDepositHold(
        { ...settlement(captured), amount: 20, reason: "Scratched frame" },
        depsOf(stripe),
      );
      assert.equal(capture.ok, true);
      assert.equal(stripe.intentOf(ACCOUNT, forCapture.id).capturedMinor, 2000);
      assert.deepEqual(await readCaptures(captured), [
        { paymentIntentId: forCapture.id, amount: "20.00", status: "completed" },
      ]);
      assert.deepEqual(await holdStates(captured), [["completed", forCapture.id]]);
      assert.equal((await readDeposit(captured))?.status, "captured");

      assert.deepEqual(await hold.releaseDepositHold(settlement(released), depsOf(stripe)), {
        ok: true,
        amount: 50,
      });
      assert.deepEqual(stripe.released, [forRelease.id]);
      assert.deepEqual(await holdStates(released), [["cancelled", forRelease.id]]);
      assert.equal((await readDeposit(released))?.status, "released");
    });

    test("one authorization is never the hold of two reservations", async () => {
      const stripe = stripeWithCard();
      // Two reservations of the same customer, on the same card, for the same deposit.
      const first = await stuckAttempt(stripe);
      const second = await stuckAttempt(stripe);
      const [secondAttempt] = await readHolds(second);

      // An authorization without any attempt's reference is neither's.
      const anonymous = stripe.createIntent({
        accountId: ACCOUNT,
        customerId: "cus_stripe",
        paymentMethodId: "pm_card",
        amountMinor: 5000,
        currency: "EUR",
        status: "requires_capture",
        attemptId: null,
        reservationId: null,
      });
      for (const reservationId of [first, second]) {
        assert.deepEqual(
          await resolve(reservationId, stripe, {
            kind: "payment_intent",
            paymentIntentId: anonymous.id,
          }),
          { ok: false, error: "intent_mismatch", mismatches: ["reservation", "attempt"] },
        );
      }

      // The first reservation's own is the first's, and only the first's.
      const own = await madeOfAttempt(stripe, first);
      assert.deepEqual(
        await resolve(second, stripe, { kind: "payment_intent", paymentIntentId: own.id }),
        { ok: false, error: "intent_mismatch", mismatches: ["reservation", "attempt"] },
      );
      assert.equal(
        (await resolve(first, stripe, { kind: "payment_intent", paymentIntentId: own.id })).ok,
        true,
      );
      assert.deepEqual(
        await resolve(second, stripe, { kind: "payment_intent", paymentIntentId: own.id }),
        { ok: false, error: "intent_mismatch", mismatches: ["reservation", "attempt", "recorded"] },
      );

      assert.deepEqual(await holdStates(first), [["authorized", own.id]]);
      assert.deepEqual(await holdStates(second), [["pending", null]]);
      assert.equal((await readHolds(second))[0].id, secondAttempt.id);
      assert.equal((await readDeposit(second))?.status, "card_saved");
      const p = louezDb.payments;
      const naming = await louezDb.db
        .select({ reservationId: p.reservationId })
        .from(p)
        .where(eq(p.stripePaymentIntentId, own.id));
      assert.deepEqual(naming, [{ reservationId: first }]);
    });

    test("an attempt a request is asking Stripe about is left to it", async () => {
      const reservationId = await createReservation();
      const stripe = stripeWithCard();
      stripe.next.push(stripe.neverArrives);
      assert.equal((await request(reservationId, stripe)).ok, false);
      await louezDb.db
        .update(louezDb.payments)
        .set({ claimedUntil: sql`NOW() + INTERVAL 60 SECOND` })
        .where(eq(louezDb.payments.reservationId, reservationId));

      assert.deepEqual(await resolve(reservationId, stripe, { kind: "nothing_at_stripe" }), {
        ok: false,
        error: "attempt_in_progress",
      });
      assert.deepEqual(await holdStates(reservationId), [["pending", null]]);
    });
  });

  describe("a claim is the request's that made it", () => {
    const STORE_USER = "user_store_owner";

    /**
     * The fake Stripe, whose reads each wait for the test: `entered(n)` once the n-th
     * read is waiting, `letGo(n)` to let it answer.
     */
    function stalling(stripe: FakeDepositStripe) {
      const gates: Array<{
        arrived: Promise<void>;
        enter: () => void;
        go: Promise<void>;
        letGo: () => void;
      }> = [];
      const gate = (index: number) => {
        while (gates.length <= index) {
          let enter = () => {};
          let letGo = () => {};
          const arrived = new Promise<void>((resolve) => {
            enter = resolve;
          });
          const go = new Promise<void>((resolve) => {
            letGo = resolve;
          });
          gates.push({ arrived, enter, go, letGo });
        }
        return gates[index];
      };
      let reads = 0;
      const pass = async () => {
        const current = gate(reads++);
        current.enter();
        await current.go;
      };
      const port: DepositHoldStripe = {
        ...stripe.port,
        async findIntent(accountId, paymentIntentId) {
          await pass();
          return stripe.port.findIntent(accountId, paymentIntentId);
        },
        async listCustomerIntents(input) {
          await pass();
          return stripe.port.listCustomerIntents(input);
        },
      };
      return {
        deps: { ...depsOf(stripe), stripe: port },
        entered: (index: number) => gate(index).arrived,
        letGo: (index: number) => gate(index).letGo(),
      };
    }

    const resolveWith = (
      reservationId: string,
      deps: DepositHoldDeps,
      resolution: Parameters<typeof hold.resolveUnconfirmedAttempt>[0]["resolution"],
    ) =>
      hold.resolveUnconfirmedAttempt(
        { reservationId, storeId: STORE, actorUserId: STORE_USER, resolution },
        deps,
      );

    /** An attempt whose request never reached Stripe, with the customer it stored. */
    async function unansweredAttempt(stripe: FakeDepositStripe) {
      const reservationId = await createReservation();
      stripe.next.push(stripe.neverArrives);
      assert.equal((await request(reservationId, stripe)).ok, false);
      return reservationId;
    }

    /** Two PaymentIntents of the card's customer, for other reservations. */
    const otherIntentsOfCustomer = (stripe: FakeDepositStripe) => {
      for (const reservationId of ["res_other_1", "res_other_2"]) {
        stripe.createIntent({
          accountId: ACCOUNT,
          customerId: "cus_stripe",
          paymentMethodId: "pm_card",
          amountMinor: 1000,
          currency: "EUR",
          status: "canceled",
          attemptId: null,
          reservationId,
        });
      }
    };

    /**
     * The claim's lease runs out while its request still waits for Stripe. A lease
     * ends only once the database's clock has passed it, so the next claim is set a
     * later second: the clock moves on to another second first.
     */
    const expireClaim = async (reservationId: string) => {
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      await louezDb.db
        .update(louezDb.payments)
        .set({ claimedUntil: sql`NOW() - INTERVAL 1 SECOND` })
        .where(eq(louezDb.payments.reservationId, reservationId));
    };

    const readClaim = async (reservationId: string) => {
      const p = louezDb.payments;
      const [row] = await louezDb.db
        .select({ token: sql<number | null>`UNIX_TIMESTAMP(${p.claimedUntil})` })
        .from(p)
        .where(and(eq(p.reservationId, reservationId), eq(p.type, "deposit_hold")));
      return row?.token === null || row?.token === undefined ? null : Number(row.token);
    };

    test("a request whose lease ran out gives back nothing it no longer holds: no third request calls Stripe", async () => {
      const stripe = stripeWithCard();
      const reservationId = await unansweredAttempt(stripe);
      const slow = stalling(stripe);
      const named = { kind: "payment_intent", paymentIntentId: "pi_missing" } as const;

      const first = resolveWith(reservationId, slow.deps, named);
      await slow.entered(0);
      await expireClaim(reservationId);
      const second = resolveWith(reservationId, slow.deps, named);
      await slow.entered(1);
      const secondClaim = await readClaim(reservationId);
      assert.ok(secondClaim !== null);

      // The first ends, with Stripe's answer, after the second took the attempt over.
      slow.letGo(0);
      assert.deepEqual(await first, { ok: false, error: "intent_not_found" });
      assert.equal(await readClaim(reservationId), secondClaim);

      // A third request finds the attempt claimed, and calls nobody.
      const calls = stripe.calls.length;
      assert.deepEqual(await request(reservationId, stripe), {
        ok: false,
        error: "errors.stripe.authorizationInProgress",
      });
      assert.equal(stripe.calls.length, calls);

      slow.letGo(1);
      assert.deepEqual(await second, { ok: false, error: "intent_not_found" });
      assert.equal(await readClaim(reservationId), null);
    });

    test("a request that lost its claim closes nothing, and asks Stripe no more", async () => {
      const stripe = stripeWithCard({ pageSize: 1 });
      const reservationId = await unansweredAttempt(stripe);
      // Two older PaymentIntents of the customer: the lookup has two pages to read.
      otherIntentsOfCustomer(stripe);
      stripe.pagesRead.length = 0;
      const slow = stalling(stripe);

      const declared = resolveWith(reservationId, slow.deps, { kind: "nothing_at_stripe" });
      await slow.entered(0);
      await expireClaim(reservationId);
      const named = resolveWith(reservationId, slow.deps, {
        kind: "payment_intent",
        paymentIntentId: "pi_missing",
      });
      await slow.entered(1);

      slow.letGo(0);
      assert.deepEqual(await declared, { ok: false, error: "attempt_in_progress" });
      // Its first page only: the second was not asked for once the claim was lost.
      assert.equal(stripe.pagesRead.length, 1);
      assert.deepEqual(await holdStates(reservationId), [["pending", null]]);
      assert.deepEqual(await readActivity(reservationId), []);

      slow.letGo(1);
      assert.deepEqual(await named, { ok: false, error: "intent_not_found" });
    });

    test("a request that lost its claim records nothing of what Stripe told it; the claim's owner does", async () => {
      const stripe = stripeWithCard();
      const reservationId = await unansweredAttempt(stripe);
      const [attempt] = await readHolds(reservationId);
      const own = stripe.createIntent({
        accountId: ACCOUNT,
        customerId: "cus_stripe",
        paymentMethodId: "pm_card",
        amountMinor: 5000,
        currency: "EUR",
        status: "requires_capture",
        attemptId: attempt.id,
        reservationId,
      });
      const slow = stalling(stripe);

      const named = resolveWith(reservationId, slow.deps, {
        kind: "payment_intent",
        paymentIntentId: own.id,
      });
      await slow.entered(0);
      await expireClaim(reservationId);
      const declared = resolveWith(reservationId, slow.deps, { kind: "nothing_at_stripe" });
      await slow.entered(1);

      slow.letGo(0);
      assert.deepEqual(await named, { ok: false, error: "attempt_in_progress" });
      assert.deepEqual(await holdStates(reservationId), [["pending", null]]);
      assert.equal((await readDeposit(reservationId))?.status, "card_saved");
      assert.deepEqual(await readActivity(reservationId), []);

      slow.letGo(1);
      assert.deepEqual(await declared, {
        ok: false,
        error: "found_at_stripe",
        paymentIntentId: own.id,
        outcome: "authorized",
      });
      assert.deepEqual(await holdStates(reservationId), [["authorized", own.id]]);
    });

    test("the claim is renewed before each call to Stripe: a long lookup keeps it", async () => {
      const stripe = stripeWithCard({ pageSize: 1 });
      const reservationId = await unansweredAttempt(stripe);
      otherIntentsOfCustomer(stripe);
      const slow = stalling(stripe);

      const declared = resolveWith(reservationId, slow.deps, { kind: "nothing_at_stripe" });
      await slow.entered(0);
      const before = await readClaim(reservationId);
      // The database's clock moves on to another second.
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      slow.letGo(0);
      await slow.entered(1);
      const renewed = await readClaim(reservationId);
      assert.ok(before !== null && renewed !== null && renewed > before, `${before} -> ${renewed}`);

      slow.letGo(1);
      assert.deepEqual(await declared, { ok: true, outcome: "closed", paymentIntentId: null });
    });
  });

  describe("a lookup that could not finish proves nothing", () => {
    /** Older PaymentIntents of the card's customer, for other reservations. */
    const otherIntents = (stripe: FakeDepositStripe, count: number) => {
      for (let index = 0; index < count; index++) {
        stripe.createIntent({
          accountId: ACCOUNT,
          customerId: "cus_stripe",
          paymentMethodId: "pm_card",
          amountMinor: 1000,
          currency: "EUR",
          status: "canceled",
          attemptId: null,
          reservationId: `res_other_${index}`,
        });
      }
    };

    test("the attempt's PaymentIntent is found on a later page", async () => {
      const reservationId = await createReservation();
      const stripe = stripeWithCard({ pageSize: 2 });
      stripe.next.push(stripe.stillRunning);
      assert.equal((await request(reservationId, stripe)).ok, false);
      stripe.finishRunning();
      // Newest first: the attempt's PaymentIntent is on the third page.
      otherIntents(stripe, 4);
      stripe.pagesRead.length = 0;

      await ageAttempt(reservationId, 30 * HOUR);
      const second = await request(reservationId, stripe);

      assert.equal(stripe.pagesRead.length, 3);
      assert.equal(second.ok && second.paymentIntentId, stripe.held()[0].id);
      assert.equal(stripe.calls.length, 1);
    });

    test("past its bound, the lookup gives up: the attempt is kept, whatever its age, until Stripe shows its hold", async () => {
      const reservationId = await createReservation();
      const stripe = stripeWithCard({ pageSize: 1 });
      // A network that keeps an authorization a month.
      stripe.setAuthorizationDays(30);
      stripe.next.push(stripe.stillRunning);
      assert.equal((await request(reservationId, stripe)).ok, false);
      stripe.finishRunning();
      const [live] = stripe.held();
      otherIntents(stripe, ATTEMPT_LOOKUP_MAX_PAGES);
      stripe.pagesRead.length = 0;

      await ageAttempt(reservationId, 30 * HOUR);
      const second = await request(reservationId, stripe);

      assert.equal(stripe.pagesRead.length, ATTEMPT_LOOKUP_MAX_PAGES);
      assert.deepEqual(second, { ok: false, error: "errors.stripe.authorizationUnconfirmed" });
      assert.equal(stripe.calls.length, 1);
      assert.deepEqual(stripe.held(), [live]);
      assert.deepEqual(await holdStates(reservationId), [["pending", null]]);

      // Nine days, then three weeks: Stripe still holds the card, and no age makes
      // Louez decide it does not. No second authorization is asked for.
      for (const older of [9 * DAY, 12 * DAY]) {
        await ageAttempt(reservationId, older);
        assert.deepEqual(await request(reservationId, stripe), {
          ok: false,
          error: "errors.stripe.authorizationUnconfirmed",
        });
      }
      assert.equal(stripe.calls.length, 1);
      assert.deepEqual(stripe.held(), [live]);
      assert.deepEqual(await holdStates(reservationId), [["pending", null]]);
      assert.equal((await readDeposit(reservationId))?.status, "card_saved");

      // An event about the hold settles the attempt, however late.
      assert.equal(await settle(reservationId, stripe, live.id), "authorized");
      assert.deepEqual(await holdStates(reservationId), [["authorized", live.id]]);
      assert.deepEqual(stripe.held(), [live]);
    });
  });

  describe("the database's clock dates an attempt, and no date bounds its lookup", () => {
    test("a server whose clock runs an hour ahead neither misdates the attempt nor loses its hold", async () => {
      const reservationId = await createReservation();
      const stripe = stripeWithCard();
      // Stripe's clock is right; this server's is an hour ahead.
      const rightNow = Date.now();
      stripe.setClock(() => new Date(rightNow));
      stripe.next.push(stripe.serverError("now"));

      mock.timers.enable({ apis: ["Date"], now: rightNow + HOUR });
      let first: Awaited<ReturnType<typeof request>>;
      try {
        first = await request(reservationId, stripe);
      } finally {
        mock.timers.reset();
      }
      // A server with a right clock retries, as the store would.
      if (!first.ok) await request(reservationId, stripe);

      // The hold Stripe made an hour "before" the attempt is the attempt's: no second
      // one was asked for.
      assert.equal(stripe.held().length, 1);
      assert.deepEqual(await holdStates(reservationId), [["authorized", stripe.held()[0].id]]);
      const [dated] = await louezDb.db
        .select({
          inTheFuture: sql<number>`${louezDb.payments.createdAt} > NOW() + INTERVAL 1 MINUTE`,
        })
        .from(louezDb.payments)
        .where(eq(louezDb.payments.reservationId, reservationId));
      assert.equal(Number(dated.inTheFuture), 0);
    });

    test("a claim made by a server whose clock runs ahead ends when the database says so", async () => {
      const reservationId = await createReservation();
      const stripe = stripeWithCard();
      stripe.next.push(stripe.neverArrives);

      mock.timers.enable({ apis: ["Date"], now: Date.now() + HOUR });
      try {
        assert.equal((await request(reservationId, stripe)).ok, false);
      } finally {
        mock.timers.reset();
      }
      // The request gave its attempt back: a server with a right clock takes it at once.
      const second = await request(reservationId, stripe);

      assert.equal(second.ok, true);
      assert.equal(stripe.calls.length, 2);
      assert.equal(stripe.calls[1].key, stripe.calls[0].key);
    });
  });

  describe("the deadline of a hold is the one Stripe states", () => {
    async function readDeadlines(reservationId: string) {
      const [reservation] = await louezDb.db
        .select({ expiresAt: louezDb.reservations.depositAuthorizationExpiresAt })
        .from(louezDb.reservations)
        .where(eq(louezDb.reservations.id, reservationId));
      const [row] = await louezDb.db
        .select({ expiresAt: louezDb.payments.authorizationExpiresAt })
        .from(louezDb.payments)
        .where(eq(louezDb.payments.reservationId, reservationId));
      return [reservation.expiresAt, row.expiresAt];
    }

    test("a hold recovered days later keeps Stripe's deadline, not seven days from now", async () => {
      const reservationId = await createReservation();
      const stripe = stripeWithCard();
      // Stripe authorized three days ago; Louez never heard of it.
      const authorizedAt = new Date(Date.now() - 3 * DAY);
      stripe.setClock(() => authorizedAt);
      stripe.next.push(stripe.stillRunning);
      assert.equal((await request(reservationId, stripe)).ok, false);
      stripe.finishRunning();
      await ageAttempt(reservationId, 3 * DAY);

      const recovered = await request(reservationId, stripe);

      assert.equal(recovered.ok, true);
      const deadline = authorizedAt.getTime() + 7 * DAY;
      assert.equal(stripe.held()[0].captureBefore?.getTime(), deadline);
      // MySQL keeps the second.
      for (const stored of await readDeadlines(reservationId)) {
        assert.ok(stored);
        assert.ok(Math.abs(stored.getTime() - deadline) <= 1_000);
      }
    });

    test("a network that keeps an authorization a month: Louez does not say it lapsed after a week", async () => {
      const reservationId = await createReservation();
      const stripe = stripeWithCard();
      stripe.setAuthorizationDays(30);
      const before = Date.now();

      assert.equal((await request(reservationId, stripe)).ok, true);

      for (const stored of await readDeadlines(reservationId)) {
        assert.ok(stored);
        assert.ok(stored.getTime() >= before + 30 * DAY - 2_000);
      }
    });

    test("where Stripe states no deadline, Louez records none and makes none up", async () => {
      const stripe = stripeWithCard();
      stripe.setAuthorizationDays(null);
      const stores = await createReservation();
      const customers = await createReservation({ depositStatus: "pending" });
      // A reservation whose earlier hold had a deadline keeps none of it.
      await setReservation(customers, {
        depositAuthorizationExpiresAt: new Date("2026-01-01T00:00:00.000Z"),
      });

      assert.equal((await request(stores, stripe)).ok, true);
      assert.equal((await customerAuthorizes(customers, stripe)).outcome, "authorized");

      assert.deepEqual(await readDeadlines(stores), [null, null]);
      assert.deepEqual(await readDeadlines(customers), [null, null]);
      assert.equal((await readDeposit(stores))?.status, "authorized");
      assert.equal(stripe.held().length, 2);
    });
  });

  describe("a capture and a release each act on the PaymentIntent they name", () => {
    test("a capture completes the hold and records the charge once, however often Stripe tells of it", async () => {
      const reservationId = await createReservation();
      const stripe = stripeWithCard();
      assert.equal((await request(reservationId, stripe)).ok, true);
      const [intent] = stripe.held();

      const result = await hold.captureDepositHold(
        { ...settlement(reservationId), amount: 30, reason: "broken wheel" },
        depsOf(stripe),
      );
      // Stripe tells the Connect webhook of the same capture, three times: no second
      // row, and no second line on the reservation's activity.
      const again = [];
      for (let delivery = 0; delivery < 3; delivery++) {
        again.push(
          await holdWrites.settleDepositIntent(louezDb.db, {
            reservationId,
            accountId: ACCOUNT,
            intent: stripe.toIntent(intent),
            actorUserId: null,
          }),
        );
      }

      assert.equal(result.ok && result.amountCapturedMinor, 3000);
      for (const settled of again) {
        assert.equal(settled.status === "settled" && settled.outcome, "captured");
        assert.equal(
          settled.status === "settled" && settled.capturePaymentId,
          result.ok && result.capturePaymentId,
        );
      }
      assert.deepEqual(stripe.held(), []);
      assert.equal((await readDeposit(reservationId))?.status, "captured");
      assert.deepEqual(await holdStates(reservationId), [["completed", intent.id]]);
      assert.deepEqual(await readCaptures(reservationId), [
        { paymentIntentId: intent.id, amount: "30.00", status: "completed" },
      ]);
      assert.deepEqual(await readActivity(reservationId), [
        "deposit_authorized",
        "deposit_captured",
      ]);
      // The line is the store's: who captured, how much and why.
      const a = louezDb.reservationActivity;
      const [line] = await louezDb.db
        .select({ description: a.description, metadata: a.metadata })
        .from(a)
        .where(and(eq(a.reservationId, reservationId), eq(a.activityType, "deposit_captured")));
      assert.match(line.description ?? "", /broken wheel/);
      assert.equal(line.metadata?.reason, "broken wheel");
      assert.equal(line.metadata?.amount, 30);
    });

    test("the webhook records a capture before the dashboard does: one row, one line, completed by the store's", async () => {
      const reservationId = await createReservation();
      const stripe = stripeWithCard();
      assert.equal((await request(reservationId, stripe)).ok, true);
      const [intent] = stripe.held();
      // Stripe captured and told the webhook before the dashboard's request came back.
      const first: DepositHoldDeps = {
        ...depsOf(stripe),
        stripe: {
          ...stripe.port,
          capture: async (accountId, paymentIntentId, amountMinor) => {
            const captured = await stripe.port.capture(accountId, paymentIntentId, amountMinor);
            assert.equal(await settle(reservationId, stripe, intent.id), "captured");
            return captured;
          },
        },
      };

      const result = await hold.captureDepositHold(
        { ...settlement(reservationId), amount: 30, reason: "broken wheel" },
        first,
      );

      assert.equal(result.ok, true);
      assert.equal((await readCaptures(reservationId)).length, 1);
      const a = louezDb.reservationActivity;
      const lines = await louezDb.db
        .select({ description: a.description })
        .from(a)
        .where(and(eq(a.reservationId, reservationId), eq(a.activityType, "deposit_captured")));
      assert.equal(lines.length, 1);
      assert.match(lines[0].description ?? "", /broken wheel/);
    });

    test("a capture or a release is refused before Stripe when nothing is held, or for nothing", async () => {
      const stripe = stripeWithCard();
      const unheld = await createReservation();
      const held = await createReservation();
      assert.equal((await request(held, stripe)).ok, true);
      const capture = (reservationId: string, amount: number, reason: string) =>
        hold.captureDepositHold({ ...settlement(reservationId), amount, reason }, depsOf(stripe));

      assert.deepEqual(await capture(unheld, 10, "scratch"), {
        ok: false,
        error: "errors.stripe.noActiveAuthorization",
      });
      assert.deepEqual(await hold.releaseDepositHold(settlement(unheld), depsOf(stripe)), {
        ok: false,
        error: "errors.stripe.noActiveAuthorization",
      });
      assert.deepEqual(await capture(held, 60, "scratch"), {
        ok: false,
        error: "errors.invalidAmount",
      });
      assert.deepEqual(await capture(held, 10, " "), {
        ok: false,
        error: "errors.reasonRequired",
      });
      assert.equal(stripe.held().length, 1);
      assert.equal((await readDeposit(held))?.status, "authorized");
    });

    test("a release answered late leaves the hold the reservation took meanwhile, and its capture", async () => {
      const reservationId = await createReservation();
      const stripe = stripeWithCard();
      assert.equal((await request(reservationId, stripe)).ok, true);
      const first = stripe.held()[0].id;
      let second = "";

      // Stripe cancels the first hold; before the dashboard records it, the webhook
      // does, the customer authorizes again, and the store captures that hold.
      const paused: DepositHoldDeps = {
        ...depsOf(stripe),
        stripe: {
          ...stripe.port,
          release: async (accountId, paymentIntentId) => {
            const intent = await stripe.port.release(accountId, paymentIntentId);
            assert.equal(await settle(reservationId, stripe, first), "released");
            second = (await customerAuthorizes(reservationId, stripe)).intent.id;
            const capture = await hold.captureDepositHold(
              { ...settlement(reservationId), amount: 50, reason: "lost" },
              depsOf(stripe),
            );
            assert.equal(capture.ok, true);
            return intent;
          },
        },
      };
      const released = await hold.releaseDepositHold(settlement(reservationId), paused);

      assert.equal(released.ok, true);
      assert.deepEqual(await readDeposit(reservationId), {
        status: "captured",
        paymentIntentId: second,
        paymentMethodId: "pm_customer",
      });
      assert.deepEqual(await holdStates(reservationId), [
        ["cancelled", first],
        ["completed", second],
      ]);
      assert.deepEqual(await readCaptures(reservationId), [
        { paymentIntentId: second, amount: "50.00", status: "completed" },
      ]);
      assert.equal(stripe.intentOf(ACCOUNT, second).status, "succeeded");
    });

    test("a release that Stripe refuses, because the capture won, records nothing", async () => {
      const reservationId = await createReservation();
      const stripe = stripeWithCard();
      assert.equal((await request(reservationId, stripe)).ok, true);
      const [intent] = stripe.held();

      // Both read the hold as authorized; the capture reaches Stripe first.
      const racing: DepositHoldDeps = {
        ...depsOf(stripe),
        stripe: {
          ...stripe.port,
          release: async (accountId, paymentIntentId) => {
            const capture = await hold.captureDepositHold(
              { ...settlement(reservationId), amount: 50, reason: "lost" },
              depsOf(stripe),
            );
            assert.equal(capture.ok, true);
            return stripe.port.release(accountId, paymentIntentId);
          },
        },
      };
      const released = await hold.releaseDepositHold(settlement(reservationId), racing);

      assert.deepEqual(released, { ok: false, error: "errors.stripe.releaseFailed" });
      assert.equal(stripe.intentOf(ACCOUNT, intent.id).status, "succeeded");
      assert.equal((await readDeposit(reservationId))?.status, "captured");
      assert.deepEqual(await holdStates(reservationId), [["completed", intent.id]]);
      assert.equal((await readCaptures(reservationId)).length, 1);
    });

    test("a capture that Stripe refuses, because the release won, records nothing", async () => {
      const reservationId = await createReservation();
      const stripe = stripeWithCard();
      assert.equal((await request(reservationId, stripe)).ok, true);
      const [intent] = stripe.held();

      // Both read the hold as authorized; the release reaches Stripe first.
      const racing: DepositHoldDeps = {
        ...depsOf(stripe),
        stripe: {
          ...stripe.port,
          capture: async (accountId, paymentIntentId, amountMinor) => {
            const release = await hold.releaseDepositHold(
              settlement(reservationId),
              depsOf(stripe),
            );
            assert.equal(release.ok, true);
            return stripe.port.capture(accountId, paymentIntentId, amountMinor);
          },
        },
      };
      const captured = await hold.captureDepositHold(
        { ...settlement(reservationId), amount: 50, reason: "lost" },
        racing,
      );

      assert.deepEqual(captured, { ok: false, error: "errors.stripe.captureFailed" });
      assert.equal(stripe.intentOf(ACCOUNT, intent.id).status, "canceled");
      assert.equal((await readDeposit(reservationId))?.status, "released");
      assert.deepEqual(await holdStates(reservationId), [["cancelled", intent.id]]);
      assert.deepEqual(await readCaptures(reservationId), []);
    });

    test("a release recorded after the capture leaves the captured hold", async () => {
      const reservationId = await createReservation();
      const stripe = stripeWithCard();
      assert.equal((await request(reservationId, stripe)).ok, true);
      const [intent] = stripe.held();
      const authorized = stripe.toIntent(intent);
      assert.equal(
        (
          await hold.captureDepositHold(
            { ...settlement(reservationId), amount: 50, reason: "lost" },
            depsOf(stripe),
          )
        ).ok,
        true,
      );

      // A release written from what was known before the capture: a hold only moves
      // forward, so the money stays recorded.
      const settled = await holdWrites.settleDepositIntent(louezDb.db, {
        reservationId,
        accountId: ACCOUNT,
        intent: { ...authorized, status: "canceled" },
        actorUserId: null,
      });

      assert.equal(settled.status === "settled" && settled.outcome, "stale");
      assert.equal((await readDeposit(reservationId))?.status, "captured");
      assert.deepEqual(await holdStates(reservationId), [["completed", intent.id]]);
      assert.equal((await readCaptures(reservationId)).length, 1);
    });
  });
});
