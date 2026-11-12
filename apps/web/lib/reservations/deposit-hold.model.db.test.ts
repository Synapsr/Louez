import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, describe, test } from "node:test";

import { and, eq, inArray, sql } from "drizzle-orm";

import type { ApiEffectSenders } from "@louez/api/platform/effects";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type {
  DepositEvent,
  DepositEventDeps,
} from "@/app/api/webhooks/stripe/connect/deposit-events";

import type { DepositHoldDeps } from "./deposit-hold";
import {
  type FakeDepositStripe,
  type FakeIntent,
  fakeDepositStripe,
} from "./fake-deposit-stripe.fixtures";
import { type DepositIntent, intentStateOf } from "./util.deposit-hold-transition";

// A model of everything a deposit hold can see, walked at random on a migrated
// database with Stripe faked: the store asks, the customer authorizes, Stripe answers
// or does not, each webhook comes in any order and more than once, a process dies
// between two steps, a writer acts on what it read from Stripe earlier, the store
// captures and releases from Louez or from Stripe, the store changes connected
// accounts, the store resolves an attempt Stripe never confirmed (rightly or not),
// time passes, and Stripe makes a PaymentIntent of a request it answered 500 to, a
// day later or more. After every step the rows are checked
// against what the fake Stripe holds; at the end of each walk every event is delivered
// and the outbox is run to its end, and the two must then agree exactly.
//
// A failure prints how to replay its walk alone:
//   DEPOSIT_MODEL_SEED=<seed> DEPOSIT_MODEL_SEQUENCES=1 pnpm test
//
// The walk's sequence of the review that closed the attempts for good: an attempt
// answered 500, the store moves to another account, a day passes, a complete and empty
// listing closes the attempt and a new one is authorized, then Stripe makes the first
// one's PaymentIntent. Every PaymentIntent Stripe holds must then have its row, the
// reservation referencing one of them at most, the others released.
//
// What the model leaves out, because Louez is not asked to hold it (deposit-hold.ts):
// - A store that changes connected accounts while a customer's own authorization, made
//   on the account it leaves, is still unknown to Louez: its event then comes from an
//   account with no row to vouch for it, and is refused.

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

const SEED = Number(process.env.DEPOSIT_MODEL_SEED ?? 20261112);
const SEQUENCES = Number(process.env.DEPOSIT_MODEL_SEQUENCES ?? 1500);
const STEPS = 10;

const STORE = "store_deposit_model";
const ACCOUNTS = ["acct_model_first", "acct_model_next"] as const;
const DEPOSIT_MINOR = 5000;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Mulberry32: a walk is its seed. */
function randomOf(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    chance: (probability: number) => next() < probability,
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
    index: (length: number) => Math.floor(next() * length),
  };
}

type Random = ReturnType<typeof randomOf>;

/**
 * How often the walks went through what this model is there to test: the default run
 * fails when one of them stops happening, so a change to the weights cannot quietly
 * stop testing it.
 */
const coverage = {
  /** A closed attempt whose PaymentIntent Stripe made afterwards, then recorded. */
  closedThenRecorded: 0,
  /** The same, on an account the store had left by then. */
  closedThenRecordedOnLeftAccount: 0,
  /** The store said it found nothing at Stripe, and the attempt was closed. */
  storeClosed: 0,
  /** The store named the attempt's PaymentIntent, and it was recorded. */
  storeNamed: 0,
  /** The store named a PaymentIntent that is not the attempt's, and was refused. */
  storeRefused: 0,
  /** A capture or a release Stripe made whose answer was lost. */
  answersLost: 0,
  accountMoves: 0,
};

/** A hold row as the model remembers it from one step to the next. */
type SeenRow = {
  readonly state: string;
  readonly rank: number;
  readonly paymentIntentId: string | null;
};

const RANK: Record<string, number> = {
  pending: 1,
  failed: 2,
  authorized: 3,
  release_owed: 3,
  completed: 4,
  cancelled: 4,
};

/** The event Stripe sends when a PaymentIntent reaches a status. */
const EVENT_OF: Record<string, DepositEvent["type"]> = {
  requires_capture: "payment_intent.amount_capturable_updated",
  canceled: "payment_intent.canceled",
  succeeded: "payment_intent.succeeded",
  requires_payment_method: "payment_intent.payment_failed",
  requires_action: "payment_intent.payment_failed",
};

describe("deposit hold, model (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let hold: typeof import("./deposit-hold");
  let holdWrites: typeof import("./deposit-hold-writes");
  let events: typeof import("@/app/api/webhooks/stripe/connect/deposit-events");
  let outbox: typeof import("@louez/api/platform/effects");
  let holdEffects: typeof import("./deposit-hold-effects");
  let counter = 0;

  before(async () => {
    database = await createTestDatabase("deposit_model");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    hold = await import("./deposit-hold");
    holdWrites = await import("./deposit-hold-writes");
    events = await import("@/app/api/webhooks/stripe/connect/deposit-events");
    outbox = await import("@louez/api/platform/effects");
    holdEffects = await import("./deposit-hold-effects");
    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: "owner",
      name: "Deposit model",
      slug: "deposit-model",
      stripeAccountId: ACCOUNTS[0],
    });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  /** One walk: a reservation, its Stripe, and what the model remembers of both. */
  async function walk(random: Random) {
    const stripe: FakeDepositStripe = fakeDepositStripe();
    for (const account of ACCOUNTS) stripe.saveCard(account, "pm_card", "cus_stripe");
    const reservationId = `res_model_${String(++counter).padStart(11, "0")}`;
    let account: string = ACCOUNTS[0];
    /** Stripe's events not delivered yet. */
    const undelivered: DepositEvent[] = [];
    /** The last status of each PaymentIntent Stripe sent an event for. */
    const told = new Map<string, string>();
    /** The outbox rows handed to the dispatcher, not run yet. */
    const handedOver: string[] = [];
    const seen = new Map<string, SeenRow>();
    /** The reservation's deposit at the last check. */
    let depositBefore: { status: string | null; paymentIntentId: string | null } | undefined;
    /** Each PaymentIntent as Stripe had it at each of its changes: what a slow writer holds. */
    const snapshots: Array<{ accountId: string; intent: DepositIntent }> = [];
    const log: string[] = [];

    await louezDb.db
      .update(louezDb.stores)
      .set({ stripeAccountId: account })
      .where(eq(louezDb.stores.id, STORE));
    await louezDb.db.insert(louezDb.reservations).values({
      id: reservationId,
      storeId: STORE,
      customerId: "customer",
      number: `M-${counter}`,
      status: "confirmed",
      startDate: new Date("2026-03-12T09:00:00.000Z"),
      endDate: new Date("2026-03-14T09:00:00.000Z"),
      subtotalAmount: "100.00",
      depositAmount: "50.00",
      totalAmount: "100.00",
      depositStatus: "card_saved",
      currency: "EUR",
      stripeCustomerId: "cus_stripe",
      stripePaymentMethodId: "pm_card",
      source: "manual",
    });

    const holdDeps = (port = stripe.port): DepositHoldDeps => ({
      database: louezDb.db,
      stripe: port,
      dispatchEffects: (ids) => {
        handedOver.push(...ids);
      },
    });
    const eventDeps: DepositEventDeps = {
      ...holdDeps(),
      generateInvoice: async () => {},
      paymentFailure: {
        dispatchNotification: async () => ({
          email: { sent: false },
          sms: { sent: false },
          discord: { sent: false },
          push: { sent: false },
        }),
        notifyPaymentFailed: async () => {},
        failMarketplaceBookingAttempt: async () => {},
      },
    };
    const senders = {
      ...holdEffects.createDepositHoldEffectSenders({ database: louezDb.db, stripe: stripe.port }),
    } as ApiEffectSenders;
    const settlement = () => ({
      reservationId,
      storeId: STORE,
      fallbackAccountId: account,
      storeSettings: { currency: "EUR" },
      actorUserId: null,
    });

    const ofReservation = () =>
      stripe.intents.filter((intent) => intent.reservationId === reservationId);
    const heldAtStripe = () => ofReservation().filter((intent) => intent.status === "requires_capture");

    const readRows = () => {
      const p = louezDb.payments;
      return louezDb.db
        .select({
          id: p.id,
          type: p.type,
          status: p.status,
          paymentIntentId: p.stripePaymentIntentId,
          accountId: p.stripeAccountId,
          releaseOwedAt: p.releaseOwedAt,
          amount: p.amount,
        })
        .from(p)
        .where(eq(p.reservationId, reservationId));
    };
    const readDeposit = async () => {
      const r = louezDb.reservations;
      const [row] = await louezDb.db
        .select({ status: r.depositStatus, paymentIntentId: r.depositPaymentIntentId })
        .from(r)
        .where(eq(r.id, reservationId));
      return row;
    };

    /** Stripe sends an event for every PaymentIntent whose status changed, whoever changed it. */
    const stripeTells = () => {
      for (const intent of ofReservation()) {
        if (told.get(intent.id) === intent.status) continue;
        told.set(intent.id, intent.status);
        snapshots.push({ accountId: intent.accountId, intent: stripe.toIntent(intent) });
        const type = EVENT_OF[intent.status];
        if (!type) continue;
        undelivered.push({
          type,
          stripeEventId: `evt_${reservationId}_${undelivered.length}_${told.size}_${intent.status}_${intent.id}`,
          accountId: intent.accountId,
          paymentIntent: {
            id: intent.id,
            amount: intent.amountMinor,
            currency: intent.currency.toLowerCase(),
            metadata: {
              type: "deposit_hold",
              reservationId,
              ...(intent.attemptId ? { depositHoldAttemptId: intent.attemptId } : {}),
            },
            last_payment_error: null,
          },
        });
      }
    };

    // Declared below: what must be true after every write.
    let check: () => Promise<unknown> = async () => {};

    const deliver = async (event: DepositEvent) => {
      const outcome = await events.handleDepositEvent(event, eventDeps);
      log.push(`  ${event.type} of ${event.paymentIntent.id} on ${event.accountId}: ${outcome}`);
      await check();
      return outcome;
    };

    /** Runs outbox rows one at a time, as the dispatcher does, checking after each. */
    const runEffects = async (ids: readonly string[]) => {
      const outcome = { sent: 0, failed: 0, skipped: 0 };
      for (const id of ids) {
        const one = await outbox.dispatchEffects([id], senders);
        outcome.sent += one.sent;
        outcome.failed += one.failed;
        outcome.skipped += one.skipped;
        await check();
      }
      return outcome;
    };

    /** The cron's pass over the outbox, every unfinished row of the reservation due. */
    const runCron = async () => {
      const e = louezDb.apiEffects;
      const due = and(
        eq(e.type, "deposit.holdRelease"),
        inArray(e.status, ["pending", "failed"]),
        sql`JSON_UNQUOTE(JSON_EXTRACT(${e.payload}, '$.reservationId')) = ${reservationId}`,
      );
      await louezDb.db
        .update(e)
        .set({
          nextAttemptAt: sql`NOW(3) - INTERVAL 1 SECOND`,
          createdAt: sql`NOW(3) - INTERVAL 1 HOUR`,
        })
        .where(due);
      const rows = await louezDb.db.select({ id: e.id }).from(e).where(due).orderBy(e.seq);
      return runEffects(rows.map((row) => row.id));
    };

    /**
     * Stripe does what it was asked, then the answer is lost: the caller sees an error.
     * What it read before goes through; once the answer is lost, so is the caller's
     * process, and nothing it reads after comes back.
     */
    const losingAnswers = (): DepositHoldDeps["stripe"] => {
      let lost = false;
      const lose = () => {
        lost = true;
        throw new Error("socket hang up");
      };
      return {
        ...stripe.port,
        capture: async (...call) => {
          await stripe.port.capture(...call);
          return lose();
        },
        release: async (...call) => {
          await stripe.port.release(...call);
          return lose();
        },
        readIntent: async (...call) => {
          if (lost) throw new Error("socket hang up");
          return stripe.port.readIntent(...call);
        },
      };
    };


    const actions: Array<{ readonly weight: number; readonly run: () => Promise<string> }> = [
      {
        weight: 3,
        run: async () => {
          const script = random.pick([
            "accept",
            "accept",
            "accept",
            "lostAnswer",
            "neverArrives",
            "stillRunning",
            "serverErrorNow",
            "serverErrorNever",
            "serverErrorLater",
            "declined",
            "needsCustomer",
          ] as const);
          stripe.next.length = 0;
          stripe.next.push(
            script === "serverErrorNow"
              ? stripe.serverError("now")
              : script === "serverErrorNever"
                ? stripe.serverError("never")
                : script === "serverErrorLater"
                  ? stripe.serverError("later")
                  : stripe[script],
          );
          const result = await hold.authorizeDepositHold(
            {
              reservationId,
              storeId: STORE,
              stripeAccountId: account,
              storeSettings: { currency: "EUR" },
              actorUserId: null,
            },
            holdDeps(),
          );
          stripe.next.length = 0;
          return `the store asks (Stripe: ${script}): ${result.ok ? "authorized" : result.error}`;
        },
      },
      {
        weight: 4,
        run: async () => {
          if (undelivered.length === 0) return "no event to deliver";
          const at = random.index(undelivered.length);
          const event = undelivered[at];
          // Stripe delivers some events more than once.
          if (!random.chance(0.25)) undelivered.splice(at, 1);
          return `the webhook: ${await deliver(event)}`;
        },
      },
      {
        weight: 1.5,
        run: async () => {
          const intent = stripe.customerAuthorizes({ accountId: account, reservationId });
          // The customer's page records it at once, unless its tab was closed first.
          if (!random.chance(0.5)) return `the customer authorizes ${intent.id}, its page gone`;
          const settled = await holdWrites.settleDepositIntent(louezDb.db, {
            reservationId,
            storeId: STORE,
            accountId: account,
            intent: stripe.toIntent(intent),
            actorUserId: null,
          });
          if (settled.status === "settled") handedOver.push(...settled.effectIds);
          return `the customer authorizes ${intent.id}: ${settled.status === "settled" ? settled.outcome : settled.status}`;
        },
      },
      {
        weight: 1,
        run: async () => {
          const lost = random.chance(0.25);
          const capturedBefore = stripe.intents.filter((i) => i.status === "succeeded").length;
          const result = await hold.captureDepositHold(
            { ...settlement(), amount: random.pick([10, 50]), reason: "damage" },
            holdDeps(lost ? losingAnswers() : stripe.port),
          );
          const capturedNow = stripe.intents.filter((i) => i.status === "succeeded").length;
          // A lost answer means Stripe captured and Louez recorded nothing yet: the
          // webhook will.
          if (lost && capturedNow > capturedBefore) {
            coverage.answersLost += 1;
            assert.equal(result.ok, false, "a capture whose answer was lost reported done");
          }
          return `the store captures${lost ? ", the answer lost" : ""}: ${result.ok ? "captured" : result.error}`;
        },
      },
      {
        weight: 1,
        run: async () => {
          const lost = random.chance(0.25);
          const releasedBefore = stripe.released.length;
          const result = await hold.releaseDepositHold(
            settlement(),
            holdDeps(lost ? losingAnswers() : stripe.port),
          );
          if (lost && stripe.released.length > releasedBefore) {
            coverage.answersLost += 1;
            assert.equal(result.ok, false, "a release whose answer was lost reported done");
          }
          return `the store releases${lost ? ", the answer lost" : ""}: ${result.ok ? "released" : result.error}`;
        },
      },
      {
        weight: 0.7,
        run: async () => {
          const held = heldAtStripe();
          if (held.length === 0) return "nothing to capture at Stripe";
          const intent = random.pick(held);
          stripe.captureAtStripe(intent.accountId, intent.id, random.pick([1000, DEPOSIT_MINOR]));
          return `captured at Stripe: ${intent.id}`;
        },
      },
      {
        weight: 0.7,
        run: async () => {
          const held = heldAtStripe();
          if (held.length === 0) return "nothing to cancel at Stripe";
          const intent = random.pick(held);
          stripe.cancel(intent.accountId, intent.id);
          return `cancelled at Stripe: ${intent.id}`;
        },
      },
      {
        weight: 1,
        run: async () => {
          // A request, a page or a webhook that read Stripe a while ago, and only
          // writes now: what it holds may be older than what the rows record.
          if (snapshots.length === 0) return "no older snapshot to write";
          const { accountId, intent } = random.pick(snapshots);
          const settled = await holdWrites.settleDepositIntent(louezDb.db, {
            reservationId,
            accountId,
            intent,
            actorUserId: null,
          });
          if (settled.status === "settled") handedOver.push(...settled.effectIds);
          return `a slow writer records ${intent.paymentIntentId} as it was, ${intent.status}: ${settled.status === "settled" ? settled.outcome : settled.status}`;
        },
      },
      {
        weight: 1,
        run: async () => {
          stripe.finishRunning();
          const reconciled = stripe.reconcile();
          return `Stripe finishes its requests (${reconciled.length} reconciled)`;
        },
      },
      {
        weight: 1.5,
        run: async () => {
          const down = random.chance(0.2);
          stripe.failReleases(down ? 1 : 0);
          const outcome = await runEffects(handedOver.splice(0));
          stripe.failReleases(0);
          return `the outbox runs${down ? ", Stripe down" : ""}: ${JSON.stringify(outcome)}`;
        },
      },
      {
        weight: 0.5,
        run: async () => {
          // The process dies before it dispatches what its write queued.
          handedOver.length = 0;
          return "the process dies before dispatching";
        },
      },
      {
        weight: 1,
        run: async () => `the cron runs: ${JSON.stringify(await runCron())}`,
      },
      {
        weight: 1.2,
        run: async () => {
          // The store resolves an attempt Stripe has not confirmed, from what its Stripe
          // dashboard shows: it names the attempt's PaymentIntent, or a wrong one, or
          // says it found nothing, rightly or because Stripe has not made it yet.
          const rows = await readRows();
          const pending = rows.find((row) => row.type === "deposit_hold" && row.status === "pending");
          if (!pending) return "no attempt to resolve";
          const made = stripe.intents.find((intent) => intent.attemptId === pending.id);
          const other = ofReservation().find((intent) => intent.attemptId !== pending.id);
          const choice = random.pick(["nothing", "its own", "its own", "a wrong one"] as const);
          // A wrong one: another PaymentIntent of the reservation, or a mistyped id.
          const wrong = other?.id ?? "pi_mistyped";
          const resolution =
            choice === "nothing" || (choice === "its own" && !made)
              ? ({ kind: "nothing_at_stripe" } as const)
              : ({
                  kind: "payment_intent",
                  paymentIntentId: choice === "its own" && made ? made.id : wrong,
                } as const);
          const result = await hold.resolveUnconfirmedAttempt(
            { reservationId, storeId: STORE, actorUserId: "user_model", resolution },
            holdDeps(),
          );
          if (resolution.kind === "payment_intent" && choice === "a wrong one") {
            assert.equal(result.ok, false, `${resolution.paymentIntentId} was taken for the attempt`);
            coverage.storeRefused += 1;
          }
          if (result.ok && result.outcome === "closed") coverage.storeClosed += 1;
          if (result.ok && resolution.kind === "payment_intent") coverage.storeNamed += 1;
          const said =
            resolution.kind === "nothing_at_stripe" ? "nothing at Stripe" : resolution.paymentIntentId;
          return `the store resolves ${pending.id} (${said}): ${result.ok ? result.outcome : result.error}`;
        },
      },
      {
        weight: 1.5,
        run: async () => {
          // A customer's own authorization still unknown to Louez is told first: see
          // the top of this file.
          const rows = await readRows();
          for (let at = undelivered.length - 1; at >= 0; at--) {
            const event = undelivered[at];
            const intent = ofReservation().find(({ id }) => id === event.paymentIntent.id);
            const known = rows.some((row) => row.paymentIntentId === event.paymentIntent.id);
            if (intent?.attemptId === null && !known) {
              undelivered.splice(at, 1);
              await deliver(event);
            }
          }
          account = account === ACCOUNTS[0] ? ACCOUNTS[1] : ACCOUNTS[0];
          coverage.accountMoves += 1;
          await louezDb.db
            .update(louezDb.stores)
            .set({ stripeAccountId: account })
            .where(eq(louezDb.stores.id, STORE));
          return `the store moves to ${account}`;
        },
      },
      {
        weight: 0.7,
        run: async () => {
          const deposit = await readDeposit();
          if (deposit?.status !== "failed" && deposit?.status !== "released") {
            return "no card to save again";
          }
          await louezDb.db
            .update(louezDb.reservations)
            .set({ depositStatus: "card_saved" })
            .where(eq(louezDb.reservations.id, reservationId));
          return "the customer saves a card again";
        },
      },
      {
        weight: 0.7,
        run: async () => {
          const ms = random.pick([3 * MINUTE, 25 * HOUR, 9 * DAY]);
          if (ms >= 24 * HOUR) {
            // A request still running is done within a day. One Stripe answered 500 to
            // is made, given up, or still to be made: Stripe promises no delay.
            stripe.finishRunning();
            const fate = random.pick(["made", "given up", "later"] as const);
            if (fate === "made") stripe.reconcile();
            if (fate === "given up") stripe.giveUp();
          }
          const p = louezDb.payments;
          const seconds = sql.raw(String(Math.round(ms / 1000)));
          await louezDb.db
            .update(p)
            .set({
              createdAt: sql`${p.createdAt} - INTERVAL ${seconds} SECOND`,
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
          return `${Math.round(ms / MINUTE)} minutes pass`;
        },
      },
    ];
    const totalWeight = actions.reduce((sum, action) => sum + action.weight, 0);
    const pickAction = () => {
      let at = random.index(Math.round(totalWeight * 100)) / 100;
      for (const action of actions) {
        at -= action.weight;
        if (at < 0) return action;
      }
      return actions[0];
    };

    /** What must be true after every write, whatever is still on its way. */
    const checkNow = async () => {
      const rows = await readRows();
      const deposit = await readDeposit();
      const holds = rows.filter((row) => row.type === "deposit_hold");
      const captures = rows.filter((row) => row.type === "deposit_capture");
      const intents = ofReservation();
      const intentOf = (paymentIntentId: string | null) =>
        intents.find((intent) => intent.id === paymentIntentId);
      const stateOf = (row: (typeof holds)[number]) =>
        row.releaseOwedAt ? "release_owed" : row.status;

      // No row moves backward, a final row never changes, a row keeps its PaymentIntent.
      for (const row of holds) {
        const state = stateOf(row);
        const rank = RANK[state];
        assert.ok(rank, `a hold row is ${state}`);
        if (row.releaseOwedAt) assert.equal(row.status, "authorized", "a release owed on a row not held");
        const before = seen.get(row.id);
        // A capture settles onto the reservation it belongs to, unless the
        // reservation held another PaymentIntent when it was recorded.
        const heldAnother =
          (depositBefore?.status === "authorized" || depositBefore?.status === "captured") &&
          depositBefore.paymentIntentId !== null &&
          depositBefore.paymentIntentId !== row.paymentIntentId;
        if (state === "completed" && before?.state !== "completed" && !heldAnother) {
          assert.deepEqual(
            [deposit?.status, deposit?.paymentIntentId],
            ["captured", row.paymentIntentId],
            `${row.paymentIntentId} was captured, and the reservation does not say so`,
          );
        }
        if (before) {
          assert.ok(rank >= before.rank, `row ${row.id} moved from ${before.state} back to ${state}`);
          if (before.rank === 4) assert.equal(state, before.state, `final row ${row.id} changed`);
          if (before.state === "release_owed") {
            assert.notEqual(state, "authorized", `row ${row.id} was decided against, then adopted`);
          }
          if (before.paymentIntentId) {
            assert.equal(row.paymentIntentId, before.paymentIntentId, `row ${row.id} changed PaymentIntent`);
          }
          if (before.state === "failed" && !before.paymentIntentId && row.paymentIntentId) {
            coverage.closedThenRecorded += 1;
            if (row.accountId !== account) coverage.closedThenRecordedOnLeftAccount += 1;
          }
        }
        seen.set(row.id, { state, rank, paymentIntentId: row.paymentIntentId });
      }

      // No hold row is ever deleted: a closed attempt keeps its row, for the
      // PaymentIntent Stripe may still make of it.
      for (const id of seen.keys()) {
        assert.ok(holds.some((row) => row.id === id), `row ${id} was deleted`);
      }

      // Louez never says more than Stripe does of a PaymentIntent.
      for (const row of holds) {
        if (!row.paymentIntentId) continue;
        const intent = intentOf(row.paymentIntentId);
        assert.ok(intent, `row ${row.id} names a PaymentIntent Stripe does not have`);
        assert.equal(row.accountId, intent.accountId, `row ${row.id} names the wrong account`);
        const atStripe = intentStateOf(intent.status);
        if (row.status === "completed") assert.equal(atStripe, "captured", `row ${row.id} completed`);
        if (row.status === "cancelled") assert.equal(atStripe, "canceled", `row ${row.id} cancelled`);
        if (row.status === "authorized") {
          assert.notEqual(atStripe, "unconfirmed", `row ${row.id} authorized, never held at Stripe`);
        }
        // One row per PaymentIntent.
        assert.equal(
          holds.filter((other) => other.paymentIntentId === row.paymentIntentId).length,
          1,
          `${row.paymentIntentId} has two hold rows`,
        );
      }

      // At most one hold is recorded as live, and it is the one the reservation
      // references; every other authorization Louez knows Stripe holds has its
      // release owed.
      const live = holds.filter((row) => row.status === "authorized" && !row.releaseOwedAt);
      if (deposit?.status === "authorized") {
        assert.deepEqual(
          live.map((row) => row.paymentIntentId),
          [deposit.paymentIntentId],
          "the reservation's hold is not the one live row",
        );
      } else {
        assert.deepEqual(live, [], `a live hold row on a deposit ${deposit?.status}`);
      }
      for (const intent of heldAtStripe()) {
        const row = holds.find((hold) => hold.paymentIntentId === intent.id);
        // Without a row yet, Louez was not told: its event is on its way.
        if (row) assert.equal(row.status, "authorized", `${intent.id} is held, its row ${row.status}`);
      }
      if (deposit?.status === "captured") {
        const row = holds.find((hold) => hold.paymentIntentId === deposit.paymentIntentId);
        assert.equal(row?.status, "completed", "a captured deposit without its completed hold");
      }

      // Money is recorded once, as Stripe took it.
      for (const capture of captures) {
        const intent = intentOf(capture.paymentIntentId);
        assert.equal(intent?.status, "succeeded", `a capture row of ${capture.paymentIntentId}`);
        assert.equal(Number(capture.amount) * 100, intent?.capturedMinor);
        assert.equal(
          captures.filter((other) => other.paymentIntentId === capture.paymentIntentId).length,
          1,
          `${capture.paymentIntentId} was captured twice in Louez`,
        );
      }
      depositBefore = deposit
        ? { status: deposit.status, paymentIntentId: deposit.paymentIntentId }
        : undefined;
      return { holds, captures, deposit, intents };
    };
    check = checkNow;

    /** Everything on its way arrives: then the rows and Stripe agree exactly. */
    const drain = async () => {
      stripe.finishRunning();
      stripe.reconcile();
      stripe.failReleases(0);
      for (let pass = 0; pass < 4; pass++) {
        stripeTells();
        while (undelivered.length > 0) {
          const [event] = undelivered.splice(random.index(undelivered.length), 1);
          await deliver(event);
        }
        await runEffects(handedOver.splice(0));
        await runCron();
      }
      stripeTells();
      assert.deepEqual(undelivered, [], "the walk did not settle");

      const { holds, captures, deposit, intents } = await checkNow();
      const held = heldAtStripe();
      // One live hold at most at Stripe: the releases owed were made.
      assert.equal(
        holds.some((row) => row.releaseOwedAt),
        false,
        "a release is still owed",
      );
      assert.ok(held.length <= 1, `Stripe holds ${held.length} authorizations`);
      // Every PaymentIntent Stripe holds has a row that says so, and it is the
      // reservation's hold.
      for (const intent of held) {
        const row = holds.find((hold) => hold.paymentIntentId === intent.id);
        assert.equal(row?.status, "authorized", `${intent.id} is held with no row that says so`);
        assert.deepEqual(
          [deposit?.status, deposit?.paymentIntentId],
          ["authorized", intent.id],
          "Stripe holds an authorization the reservation does not reference",
        );
      }
      // The reservation's deposit is what Stripe says of the PaymentIntent it references.
      const referenced = intents.find((intent) => intent.id === deposit?.paymentIntentId);
      if (deposit?.status === "authorized") assert.equal(referenced?.status, "requires_capture");
      if (deposit?.status === "captured") assert.equal(referenced?.status, "succeeded");
      if (deposit?.status === "released") assert.equal(referenced?.status, "canceled");
      // Every PaymentIntent that is over has its final row; every capture its money.
      for (const intent of intents) {
        const row = holds.find((hold) => hold.paymentIntentId === intent.id);
        if (intent.status === "canceled") {
          assert.equal(row?.status, "cancelled", `${intent.id} was cancelled at Stripe`);
        }
        if (intent.status === "succeeded") {
          assert.equal(row?.status, "completed", `${intent.id} was captured at Stripe`);
          assert.equal(
            captures.filter((capture) => capture.paymentIntentId === intent.id).length,
            1,
            `${intent.id} was captured at Stripe`,
          );
        }
      }
      // An attempt still pending is one Stripe never made anything for.
      for (const row of holds) {
        if (row.status !== "pending") continue;
        assert.equal(
          intents.some((intent: FakeIntent) => intent.attemptId === row.id),
          false,
          `attempt ${row.id} is pending, and Stripe has its PaymentIntent`,
        );
      }
      // Whatever Stripe made of an attempt, open or closed when it was made, that held
      // or holds money is recorded on the attempt's own row.
      for (const intent of intents) {
        if (!intent.attemptId || intentStateOf(intent.status) === "unconfirmed") continue;
        const row = holds.find((hold) => hold.paymentIntentId === intent.id);
        assert.equal(row?.id, intent.attemptId, `${intent.id} is not on its attempt's row`);
      }
    };

    try {
      for (let step = 0; step < STEPS; step++) {
        log.push(await pickAction().run());
        stripeTells();
        await check();
      }
      log.push("everything arrives");
      await drain();
    } catch (error) {
      const reason = error instanceof Error ? (error.stack ?? error.message) : String(error);
      throw new Error(`${log.join("\n")}\n${reason}`);
    }
  }

  test(`${SEQUENCES} random walks keep what Louez says and what Stripe holds in agreement (seed ${SEED})`, async (t) => {
    for (let sequence = 0; sequence < SEQUENCES; sequence++) {
      const seed = SEED + sequence;
      try {
        await walk(randomOf(seed));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        assert.fail(
          `Walk ${sequence} failed. Replay it alone with DEPOSIT_MODEL_SEED=${seed} DEPOSIT_MODEL_SEQUENCES=1\n${reason}`,
        );
      }
    }
    t.diagnostic(`paths walked: ${JSON.stringify(coverage)}`);
    if (SEQUENCES >= 500) {
      for (const [path, count] of Object.entries(coverage)) {
        assert.ok(count > 0, `no walk went through ${path}: ${JSON.stringify(coverage)}`);
      }
    }
  });
});
