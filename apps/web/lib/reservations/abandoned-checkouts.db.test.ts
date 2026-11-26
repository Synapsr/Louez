import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, afterEach, before, describe, mock, test } from "node:test";

import { and, eq, sql } from "drizzle-orm";

import {
  createTestDatabase,
  raceOnLockedRow,
  reservationChangeTestHooks,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";

import { closeNetworkForSuite, withoutProviderSettings } from "@/lib/testing/network-guard";

// The cron's pass over abandoned online checkouts, on a migrated database: what
// it looks at (an online checkout still pending, no rental payment completed,
// an unsettled rental session written past a session's lifetime and a margin
// and under 48 hours ago, at most a batch a run, drawn at random, within a time
// budget), what it reads at Stripe (each such session, never expired, with a
// short timeout and no retry), what it records (a session over marked settled, a
// pending one as the expiry handler records it, a paid one as the customer's
// return records it), and when it asks for the checkout's cancellation, which
// leaves a checkout with an unsettled session; against itself, and against
// resumes in flight (docs/domain/reservation-changes.md). Stripe is a fake: no
// network.

process.env.SKIP_ENV_VALIDATION = "true";
process.env.STRIPE_SECRET_KEY = "sk_test_stub";
// The completion's senders run for real here: unconfigured, they reach no provider.
withoutProviderSettings();
// The store is billed by nobody here: no fee is planned, and none is asked of a service.
delete process.env.LOUEZ_BILLING;
delete process.env.BILLING_SERVICE_URL;

const FILES_SDK = new URL("../../node_modules/files-sdk/dist/", import.meta.url);
Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: unknown,
    next: (specifier: string, context: unknown) => unknown,
  ) {
    // The checkout's modules import Next.js-only guards and the file storage SDK.
    if (specifier === "server-only" || specifier === "@/lib/storage/files") {
      return { url: "node:module", shortCircuit: true };
    }
    // files-sdk exports ESM only, through an "import" condition the test's require misses.
    if (specifier === "files-sdk" || specifier.startsWith("files-sdk/")) {
      const entry = specifier === "files-sdk" ? "index.js" : `${specifier.slice(10)}/index.js`;
      return { url: new URL(entry, FILES_SDK).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const STORE = "store_abandoned";
const SLUG = "abandoned-checkouts";
const ACCOUNT = "acct_abandoned";
const CUSTOMER = "cus_abandoned";
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/**
 * What Stripe says of a session: `expired` by default. An `open`, `complete` or
 * `unreachable` one is not expired by an expire call; a `hang` one is read only
 * when the read's own timeout ends it.
 */
type AtStripe = "complete" | "expired" | "open" | "unreachable" | "hang";

describe(
  "the pass over abandoned checkouts (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    // No test of this suite reaches a provider: Stripe is a fake.
    closeNetworkForSuite();
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let pass: typeof import("./abandoned-checkouts");
    let paymentSession: typeof import("./payment-session");
    let settlement: typeof import("./checkout-session-settlement");
    let counter = 0;
    const atStripe = new Map<string, AtStripe>();
    /** The calls to Stripe, in order: `retrieve cs_…`, `expire cs_…`, `create cs_…`. */
    const stripeCalls: string[] = [];
    /** The per-request options of each read. */
    const readOptions: Array<Record<string, unknown>> = [];
    /** Runs as Stripe is asked something: a test's moment. */
    let onStripeCall: ((call: string) => Promise<void>) | null = null;
    /** The pass's run lines, as it logs them. */
    const runLines: Array<Record<string, unknown>> = [];

    before(async () => {
      database = await createTestDatabase("abandoned_checkouts");
      // DATABASE_URL now points at the test database.
      louezDb = await import("@louez/db");
      paymentSession = await import("./payment-session");
      pass = await import("./abandoned-checkouts");
      settlement = await import("./checkout-session-settlement");
      // The pass's log: its run lines are kept, every other line dropped.
      const { log } = await import("@/lib/evlog");
      Reflect.set(log, "warn", (event: { abandonedCheckouts?: Record<string, unknown> }) => {
        if (event.abandonedCheckouts) runLines.push(event.abandonedCheckouts);
      });
      const { getStripe } = await import("@/lib/stripe/client");
      const sessions = getStripe().checkout.sessions;
      const call = async (name: string) => {
        stripeCalls.push(name);
        await onStripeCall?.(name);
      };
      Reflect.set(sessions, "create", async () => {
        const id = `cs_new_${++counter}`;
        await call(`create ${id}`);
        return { id, url: `https://checkout.stripe.test/${id}`, expires_at: 1_900_000_000 };
      });
      Reflect.set(sessions, "expire", async (id: string) => {
        await call(`expire ${id}`);
        const state = atStripe.get(id) ?? "expired";
        if (state !== "expired") throw new Error("This Checkout Session is not expireable.");
        return { id, status: "expired", amount_total: 1000, currency: "eur" };
      });
      // A session id here is `cs_` and its reservation's id, then `_` and a number.
      Reflect.set(
        sessions,
        "retrieve",
        async (id: string, options: { timeout?: number; maxNetworkRetries?: number }) => {
          readOptions.push({ ...options });
          await call(`retrieve ${id}`);
          const state = atStripe.get(id) ?? "expired";
          if (state === "unreachable") throw new Error("Stripe not reached");
          if (state === "hang") {
            // As the SDK ends a request at its timeout.
            await new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Request timed out")), options.timeout),
            );
          }
          const reservationId = id.slice("cs_".length, id.lastIndexOf("_"));
          return {
            id,
            status: state,
            payment_status: state === "complete" ? "paid" : "unpaid",
            payment_intent: `pi_${id}`,
            customer: null,
            amount_total: 1000,
            currency: "eur",
            metadata: { reservationId, checkoutFlow: "storefront_checkout" },
            expires_at: 1_900_000_000,
          };
        },
      );
      // The customer's return reads the paid session's PaymentIntent.
      Reflect.set(getStripe().paymentIntents, "retrieve", async (id: string) => ({
        id,
        customer: null,
        payment_method: "pm_card",
        metadata: {},
        latest_charge: { id: `ch_${id}`, created: 1_800_000_000 },
      }));

      await louezDb.db.insert(louezDb.stores).values({
        id: STORE,
        userId: "owner_abandoned",
        name: "Abandoned",
        slug: SLUG,
        settings: { reservationMode: "payment", advanceNoticeMinutes: 0, currency: "EUR" },
        stripeAccountId: ACCOUNT,
        stripeChargesEnabled: true,
      });
      await louezDb.db.insert(louezDb.customers).values({
        id: CUSTOMER,
        storeId: STORE,
        email: "renter@abandoned.test",
        firstName: "Renter",
        lastName: "Abandoned",
      });
    });

    after(async () => {
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    afterEach(async () => {
      atStripe.clear();
      runLines.length = 0;
      stripeCalls.length = 0;
      readOptions.length = 0;
      onStripeCall = null;
      reservationChangeTestHooks().beforeReservationLock = null;
      // Each case leaves nothing for the next one's pass to look at.
      await louezDb.db.delete(louezDb.payments);
      await louezDb.db.delete(louezDb.reservationActivity);
      await louezDb.db.delete(louezDb.reservations);
    });

    /**
     * A checkout of 10.00 EUR and its rental sessions' rows, each `{ status, age }`,
     * the age being how long ago its row was written; `settled` marks a row's
     * session settled, as Louez records a session Stripe said is over.
     */
    async function checkout(
      sessions: ReadonlyArray<{
        status: "pending" | "cancelled" | "completed";
        age: number;
        /** Marked settled, that long ago (the row's age when `true`). */
        settled?: boolean | number;
        /** The checkout's own row by default; a payment request's asks its own amount. */
        origin?: "checkout" | "payment_request";
        amount?: string;
      }>,
      { source = "online" }: { source?: string } = {},
    ) {
      const id = `res_${++counter}`;
      await louezDb.db.insert(louezDb.reservations).values({
        id,
        storeId: STORE,
        customerId: CUSTOMER,
        number: id,
        status: "pending",
        startDate: new Date("2031-04-10T09:00:00.000Z"),
        endDate: new Date("2031-04-12T09:00:00.000Z"),
        subtotalAmount: "10.00",
        depositAmount: "0.00",
        totalAmount: "10.00",
        currency: "EUR",
        source,
      });
      const ids: string[] = [];
      for (const [
        index,
        { status, age, settled, origin = "checkout", amount },
      ] of sessions.entries()) {
        const sessionId = `cs_${id}_${index}`;
        ids.push(sessionId);
        await louezDb.db.insert(louezDb.payments).values({
          id: `pay_${id}_${index}`,
          reservationId: id,
          amount: amount ?? "10.00",
          type: "rental",
          method: "stripe",
          status,
          stripeCheckoutSessionId: sessionId,
          stripeAccountId: ACCOUNT,
          origin,
          paymentRequestId: origin === "payment_request" ? `prq_${id}_${index}` : null,
          currency: "EUR",
          sessionSettledAt:
            settled === undefined || settled === false
              ? null
              : new Date(Date.now() - (settled === true ? age : settled)),
          createdAt: new Date(Date.now() - age),
        });
      }
      return { id, sessions: ids };
    }

    /** The reservation's status, its rental rows by session, and its history's types. */
    async function stateOf(id: string) {
      const [reservation] = await louezDb.db
        .select({ status: louezDb.reservations.status })
        .from(louezDb.reservations)
        .where(eq(louezDb.reservations.id, id));
      const rows = await louezDb.db
        .select({
          session: louezDb.payments.stripeCheckoutSessionId,
          status: louezDb.payments.status,
        })
        .from(louezDb.payments)
        .where(eq(louezDb.payments.reservationId, id));
      const lines = await louezDb.db
        .select({
          type: louezDb.reservationActivity.activityType,
          metadata: louezDb.reservationActivity.metadata,
        })
        .from(louezDb.reservationActivity)
        .where(eq(louezDb.reservationActivity.reservationId, id));
      return {
        status: reservation?.status,
        payments: Object.fromEntries(rows.map((row) => [row.session, row.status])),
        history: lines
          .map(({ type, metadata }) =>
            type === "payment_expired"
              ? `payment_expired ${(metadata as { checkoutSessionId: string }).checkoutSessionId}`
              : type,
          )
          .sort(),
      };
    }

    /** The sessions of the reservation marked settled. */
    async function settledOf(id: string) {
      const rows = await louezDb.db
        .select({
          session: louezDb.payments.stripeCheckoutSessionId,
          settledAt: louezDb.payments.sessionSettledAt,
        })
        .from(louezDb.payments)
        .where(eq(louezDb.payments.reservationId, id));
      return rows.flatMap(({ session, settledAt }) => (settledAt ? [String(session)] : [])).sort();
    }

    /** A run's counts, with these and zero for the others. */
    const counts = (some: Partial<Record<string, number>>) => ({
      confirmed: 0,
      cancelled: 0,
      left: 0,
      unreadable: 0,
      failed: 0,
      waiting: 0,
      ...some,
    });

    const resume = (reservationId: string) =>
      paymentSession.createReservationPaymentSessionForCustomer(
        SLUG,
        reservationId,
        CUSTOMER,
        "checkout_resume",
        { allowPendingReservation: true, chargeAmount: 10 },
      );

    /** A promise and the function that settles it: a moment a test holds. */
    const moment = () => {
      let release = () => {};
      const reached = new Promise<void>((resolve) => {
        release = resolve;
      });
      return { reached, release };
    };

    test("a session paid and never recorded: recorded as the customer's return records it, the checkout confirmed", async () => {
      const { id, sessions } = await checkout([{ status: "pending", age: 40 * MINUTE }]);
      atStripe.set(String(sessions[0]), "complete");

      assert.deepEqual(await pass.settleAbandonedCheckouts(), counts({ confirmed: 1 }));

      const state = await stateOf(id);
      assert.equal(state.status, "confirmed");
      assert.deepEqual(state.payments, { [String(sessions[0])]: "completed" });
      assert.ok(!stripeCalls.some((call) => call.startsWith("expire")), "nothing expired");
    });

    test("every unsettled session over: a pending row recorded as the expiry handler records it, a replaced one marked alone, then the checkout cancelled; a settled session is not read", async () => {
      const { id, sessions } = await checkout([
        { status: "pending", age: 40 * MINUTE },
        // Replaced by a resume: cancelled, unsettled.
        { status: "cancelled", age: 50 * MINUTE },
        // Settled: Stripe said it is over.
        { status: "cancelled", age: 60 * MINUTE, settled: true },
      ]);
      const [pending, replaced, settled] = sessions.map(String);

      assert.deepEqual(await pass.settleAbandonedCheckouts(), counts({ cancelled: 1 }));

      assert.deepEqual(stripeCalls.sort(), [`retrieve ${pending}`, `retrieve ${replaced}`].sort());
      assert.deepEqual(await settledOf(id), [pending, replaced, settled].sort());
      assert.deepEqual(await stateOf(id), {
        status: "cancelled",
        payments: {
          [String(pending)]: "cancelled",
          [String(replaced)]: "cancelled",
          [String(settled)]: "cancelled",
        },
        history: ["cancelled", `payment_expired ${pending}`],
      });
    });

    test("a session unread or still open: nothing written, the checkout left to the next run", async () => {
      for (const state of ["unreachable", "open"] as const) {
        const { id, sessions } = await checkout([{ status: "pending", age: 40 * MINUTE }]);
        atStripe.set(String(sessions[0]), state);

        assert.deepEqual(await pass.settleAbandonedCheckouts(), counts({ unreadable: 1 }), state);

        assert.deepEqual(
          await stateOf(id),
          { status: "pending", payments: { [String(sessions[0])]: "pending" }, history: [] },
          state,
        );
        assert.deepEqual(await settledOf(id), [], state);
        await louezDb.db.delete(louezDb.reservations).where(eq(louezDb.reservations.id, id));
      }
    });

    test("selected by the record: an unsettled session past its lifetime and a margin, and under 48 hours old, to read; a settled one with no payment left, to cancel; a younger one, an older one and a paid checkout are not", async () => {
      const due = await checkout([{ status: "pending", age: 40 * MINUTE }]);
      const settled = await checkout([{ status: "cancelled", age: 40 * MINUTE, settled: true }]);
      const young = await checkout([{ status: "pending", age: 10 * MINUTE }]);
      // Written before the record existed, unmarked, and past the pass's reach.
      const old = await checkout([{ status: "cancelled", age: 49 * HOUR }]);
      const paid = await checkout([
        { status: "completed", age: 50 * MINUTE },
        { status: "cancelled", age: 40 * MINUTE },
      ]);
      const marketplace = await checkout([{ status: "pending", age: 40 * MINUTE }], {
        source: "marketplace",
      });
      const manual = await checkout([{ status: "pending", age: 40 * MINUTE }], {
        source: "manual",
      });

      const found = await pass.findAbandonedCheckouts(new Date(), sql`1`);

      // The unsettled one is read at Stripe; the settled one, with no payment
      // left, is drawn for its cancellation.
      assert.deepEqual(
        found.map(({ id, branch }) => [id, branch]),
        [
          [due.id, "unsettled"],
          [settled.id, "settled"],
        ],
      );
      for (const { id } of [young, old, paid, marketplace, manual]) {
        assert.ok(!found.some((checkout) => checkout.id === id), id);
      }
    });

    test("a payment request opened and never paid on a reservation that never had a checkout: never drawn, and left when its cancellation is asked", async () => {
      // The store accepted the request before any payment, then sent a payment request.
      const open = await checkout([
        { status: "pending", age: 40 * MINUTE, origin: "payment_request" },
      ]);
      const over = await checkout([
        { status: "cancelled", age: 40 * MINUTE, settled: true, origin: "payment_request" },
      ]);

      const found = await pass.findAbandonedCheckouts(new Date(), sql`1`);

      for (const { id } of [open, over]) {
        assert.ok(!found.some((checkout) => checkout.id === id), id);
      }
      // Asked anyway, by the pass's settle step or by a session's expiry.
      assert.equal(await pass.settleAbandonedCheckout({ id: open.id, storeId: STORE }), "left");
      assert.equal(
        await pass.settleAbandonedCheckout({ id: over.id, storeId: STORE, branch: "settled" }),
        "left",
      );
      // The cancellation's own read under the lock, asked directly.
      const { changeSystemReservationStatus } =
        await import("@louez/api/services/system-reservation-status");
      assert.equal(
        await changeSystemReservationStatus(
          {
            reason: "checkout_abandoned",
            reservationId: over.id,
            checkoutSessionId: String(over.sessions[0]),
          },
          async () => {},
        ),
        false,
      );
      for (const { id } of [open, over]) {
        assert.equal((await stateOf(id)).status, "pending", id);
      }
    });

    test("a checkout whose payment request's session is still unsettled: drawn for it, that session read and marked, then the checkout cancelled", async () => {
      // The checkout's session is settled; the request's, given since, never heard of.
      const { id, sessions } = await checkout([
        { status: "cancelled", age: 60 * MINUTE, settled: true },
        { status: "pending", age: 40 * MINUTE, origin: "payment_request" },
      ]);
      const [own, request] = sessions.map(String);

      const found = await pass.findAbandonedCheckouts(new Date(), sql`1`);
      assert.deepEqual(
        found.map((checkout) => [checkout.id, checkout.branch]),
        [[id, "unsettled"]],
      );

      assert.deepEqual(await pass.settleAbandonedCheckouts(), counts({ cancelled: 1 }));

      assert.deepEqual(stripeCalls, [`retrieve ${request}`]);
      assert.deepEqual(await settledOf(id), [own, request].sort());
      assert.equal((await stateOf(id)).status, "cancelled");
    });

    test("a checkout dated by its newest mark, a payment request's included: its own settled two days ago, the request's since, drawn and cancelled", async () => {
      const { id } = await checkout([
        { status: "cancelled", age: 49 * HOUR, settled: true },
        { status: "cancelled", age: 41 * MINUTE, settled: 40 * MINUTE, origin: "payment_request" },
      ]);

      const found = await pass.findAbandonedCheckouts(new Date(), sql`1`);
      assert.deepEqual(
        found.map((checkout) => [checkout.id, checkout.branch]),
        [[id, "settled"]],
      );

      assert.deepEqual(await pass.settleAbandonedCheckouts(), counts({ cancelled: 1 }));
      assert.equal((await stateOf(id)).status, "cancelled");
    });

    test("a checkout whose payment request's session may still be paid is not cancelled", async () => {
      // Given a moment ago: under the delay, not drawn, and left when its cancellation is asked.
      const young = await checkout([
        { status: "cancelled", age: 60 * MINUTE, settled: true },
        { status: "pending", age: 10 * MINUTE, origin: "payment_request" },
      ]);
      // Old enough to be read, and still open at Stripe.
      const open = await checkout([
        { status: "cancelled", age: 60 * MINUTE, settled: true },
        { status: "pending", age: 40 * MINUTE, origin: "payment_request" },
      ]);
      atStripe.set(String(open.sessions[1]), "open");

      const found = await pass.findAbandonedCheckouts(new Date(), sql`1`);
      assert.ok(!found.some((checkout) => checkout.id === young.id));
      assert.deepEqual(await pass.settleAbandonedCheckouts(), counts({ unreadable: 1 }));

      const { changeSystemReservationStatus } =
        await import("@louez/api/services/system-reservation-status");
      for (const { id, sessions } of [young, open]) {
        assert.equal(
          await changeSystemReservationStatus(
            {
              reason: "checkout_abandoned",
              reservationId: id,
              checkoutSessionId: String(sessions[0]),
            },
            async () => {},
          ),
          false,
          id,
        );
        assert.equal((await stateOf(id)).status, "pending", id);
      }
    });

    test("a storefront checkout whose store also sent a payment request, both settled together: drawn and cancelled", async () => {
      const { id } = await checkout([
        { status: "cancelled", age: 50 * MINUTE, settled: true },
        { status: "cancelled", age: 40 * MINUTE, settled: true, origin: "payment_request" },
      ]);

      const found = await pass.findAbandonedCheckouts(new Date(), sql`1`);
      assert.deepEqual(
        found.map((checkout) => [checkout.id, checkout.branch]),
        [[id, "settled"]],
      );
      assert.deepEqual(await pass.settleAbandonedCheckouts(), counts({ cancelled: 1 }));

      assert.equal((await stateOf(id)).status, "cancelled");
    });

    test("the account page opens no session on a pending reservation", async () => {
      const { id } = await checkout([]);

      assert.deepEqual(
        await paymentSession.createReservationPaymentSessionForCustomer(
          SLUG,
          id,
          CUSTOMER,
          "account_page",
        ),
        { error: "errors.invalidStatus" },
      );
      assert.deepEqual(stripeCalls, []);
    });

    test("the checkout's resume reads the checkout's own row, never a payment request's", async () => {
      const { resumeCheckoutPayment } = await import("./resume-checkout-payment");
      const store = {
        id: STORE,
        slug: SLUG,
        stripeAccountId: ACCOUNT,
        stripeChargesEnabled: true,
        settings: null,
      };
      // A request-flow reservation: its only session is the store's request.
      const requestOnly = await checkout([
        { status: "pending", age: 5 * MINUTE, origin: "payment_request", amount: "4.00" },
      ]);

      assert.deepEqual(await resumeCheckoutPayment({ store, reservationId: requestOnly.id }), {
        ok: false,
        error: "invalid_status",
      });
      assert.deepEqual(stripeCalls, []);

      // A checkout of 10.00 whose store sent a request of 4.00 since.
      const both = await checkout([
        { status: "cancelled", age: 50 * MINUTE, settled: true },
        {
          status: "cancelled",
          age: 5 * MINUTE,
          settled: true,
          origin: "payment_request",
          amount: "4.00",
        },
      ]);

      const resumed = await resumeCheckoutPayment({ store, reservationId: both.id });

      assert.ok(resumed.ok, JSON.stringify(resumed));
      const [installed] = await louezDb.db
        .select({ amount: louezDb.payments.amount, origin: louezDb.payments.origin })
        .from(louezDb.payments)
        .where(
          and(eq(louezDb.payments.reservationId, both.id), eq(louezDb.payments.status, "pending")),
        );
      assert.deepEqual(installed, { amount: "10.00", origin: "customer_session" });
    });

    test("a checkout with a session past the window and a younger one: only the older is read and marked, and the checkout is left", async () => {
      const { id, sessions } = await checkout([
        { status: "cancelled", age: 3 * HOUR },
        { status: "pending", age: 10 * MINUTE },
      ]);

      assert.deepEqual(await pass.settleAbandonedCheckouts(), counts({ left: 1 }));

      assert.deepEqual(stripeCalls, [`retrieve ${sessions[0]}`]);
      assert.deepEqual(await settledOf(id), [String(sessions[0])]);
      assert.equal((await stateOf(id)).status, "pending");
    });

    test("at most a batch a run", async () => {
      const checkouts = [];
      for (let index = 0; index <= pass.ABANDONED_CHECKOUTS_PER_RUN; index += 1) {
        checkouts.push(await checkout([{ status: "pending", age: (40 + index) * MINUTE }]));
      }

      assert.equal(
        (await pass.settleAbandonedCheckouts()).cancelled,
        pass.ABANDONED_CHECKOUTS_PER_RUN,
      );

      assert.equal(stripeCalls.length, pass.ABANDONED_CHECKOUTS_PER_RUN);
      const statuses = await Promise.all(
        checkouts.map(async ({ id }) => (await stateOf(id)).status),
      );
      assert.equal(statuses.filter((status) => status === "pending").length, 1, "one waits");
    });

    test("checkouts that stay unreadable do not keep another out: drawn at random, it is settled within a few runs; each run logs one line", async () => {
      // More unreadable checkouts than a batch, all older than the readable one,
      // which a batch drawn oldest first would never reach.
      const unreadable = pass.ABANDONED_CHECKOUTS_PER_RUN + 5;
      for (let index = 0; index < unreadable; index += 1) {
        const { sessions } = await checkout([{ status: "pending", age: (50 + index) * MINUTE }]);
        atStripe.set(String(sessions[0]), "unreachable");
      }
      const readable = await checkout([{ status: "pending", age: 40 * MINUTE }]);
      // And as many settled checkouts with no payment left, the other question's.
      const settled = [];
      for (let index = 0; index < unreadable; index += 1) {
        settled.push(
          await checkout([{ status: "cancelled", age: 3 * HOUR, settled: 40 * MINUTE }]),
        );
      }

      // The draw is RAND(seed), one seed a run, so the runs are the same each
      // time. While the settled ones last, each question has half the batch: with
      // 26 checkouts to read and 10 places, a checkout is left out of a run drawn
      // at random with probability 16/26, and out of 58 runs with (16/26)^58, under
      // 1e-12: 58 runs bound the wait. The settled ones are cancelled meanwhile.
      const bound = 58;
      let runs = 0;
      while ((await stateOf(readable.id)).status === "pending" && runs < bound) {
        runs += 1;
        await pass.settleAbandonedCheckouts({ order: sql`RAND(${runs})` });
      }

      assert.equal((await stateOf(readable.id)).status, "cancelled", `within ${bound} runs`);
      for (const { id } of settled) {
        if ((await stateOf(id)).status !== "cancelled") {
          await pass.settleAbandonedCheckouts({ order: sql`RAND(${(runs += 1)})` });
        }
      }
      for (const { id } of settled) assert.equal((await stateOf(id)).status, "cancelled", id);
      assert.equal(runLines.length, runs, "one line a run");
      for (const line of runLines) {
        assert.equal(line.event, "run_skipped");
        assert.ok(Number(line.unreadable) > 0);
        assert.ok((line.reservationIds as string[]).length <= 5, JSON.stringify(line));
      }
    });

    test("each read has a short timeout and no retry: one that hangs ends at its timeout, and the checkout is left to the next run", async () => {
      const { id, sessions } = await checkout([{ status: "pending", age: 40 * MINUTE }]);
      atStripe.set(String(sessions[0]), "hang");
      mock.timers.enable({ apis: ["setTimeout"] });
      try {
        const run = pass.settleAbandonedCheckouts();
        while (readOptions.length === 0) await new Promise((resolve) => setImmediate(resolve));
        // The read's own timeout, on the faked clock: nothing waits for it.
        mock.timers.tick(Number(readOptions[0]?.timeout));

        assert.deepEqual(await run, counts({ unreadable: 1 }));
      } finally {
        mock.timers.reset();
      }
      assert.deepEqual(readOptions, [{ ...pass.ABANDONED_CHECKOUT_READ, stripeAccount: ACCOUNT }]);
      assert.equal((await stateOf(id)).status, "pending");
    });

    test("past its time budget a run takes no new checkout: those left wait, and the run's line counts them", async () => {
      for (let index = 0; index < 3; index += 1) {
        await checkout([{ status: "pending", age: (40 + index) * MINUTE }]);
      }
      // The run starts at 0, takes its first checkout and reads that one's session
      // then; the clock reads past the budget from the second checkout on.
      let reads = 0;
      const clock = () => (reads++ < 3 ? 0 : pass.ABANDONED_CHECKOUTS_RUN_BUDGET_MS);

      assert.deepEqual(
        await pass.settleAbandonedCheckouts({ clock }),
        counts({ cancelled: 1, waiting: 2 }),
      );
      assert.equal(runLines.length, 1);
      assert.equal(runLines[0]?.waiting, 2);
    });

    test("a checkout whose many sessions answer slowly keeps no settled checkout waiting, and its reads stop at the budget", async () => {
      // Twenty-six sessions to read, more than the budget allows at a second each.
      const slow = await checkout(
        Array.from({ length: 26 }, (_, index) => ({
          status: "cancelled" as const,
          age: (40 + index) * MINUTE,
        })),
      );
      for (const session of slow.sessions) atStripe.set(session, "unreachable");
      const settled = await checkout([{ status: "cancelled", age: 40 * MINUTE, settled: true }]);
      // Each read costs a second of the run's clock.
      const clock = () => readOptions.length * 1000;

      for (let run = 0; run < 3; run += 1) {
        readOptions.length = 0;
        const result = await pass.settleAbandonedCheckouts({ clock, first: "settled" });
        // The settled checkout is cancelled by the first run, whatever the other costs.
        assert.equal((await stateOf(settled.id)).status, "cancelled", `run ${run}`);
        assert.equal(result.waiting, 0, `run ${run}`);
        assert.equal(result.unreadable, 1, `run ${run}`);
        // No group of reads starts once the budget is spent.
        assert.ok(
          readOptions.length <= pass.ABANDONED_CHECKOUTS_RUN_BUDGET_MS / 1000 + 4,
          `run ${run}: ${readOptions.length} reads`,
        );
      }
      assert.equal((await stateOf(slow.id)).status, "pending");
    });

    test("a cancellation that waits out the budget keeps no checkout to read waiting: which question goes first is drawn for each run", async () => {
      const settled = await checkout([{ status: "cancelled", age: 40 * MINUTE, settled: true }]);
      const toRead = await checkout([{ status: "pending", age: 40 * MINUTE }]);
      // The settled checkout's cancellation waits for its reservation's lock past
      // the run's budget, then fails, as on a lock wait timeout.
      let elapsed = 0;
      reservationChangeTestHooks().beforeReservationLock = async (scope) => {
        if (scope.reservationId !== settled.id) return;
        elapsed = pass.ABANDONED_CHECKOUTS_RUN_BUDGET_MS;
        throw new Error("Lock wait timeout exceeded");
      };
      const clock = () => elapsed;

      // Settled first: its wait spends the budget, the checkout to read waits.
      assert.deepEqual(
        await pass.settleAbandonedCheckouts({ clock, first: "settled" }),
        counts({ failed: 1, waiting: 1 }),
      );
      assert.equal((await stateOf(toRead.id)).status, "pending");

      // The draw, as the run makes it: one half of the runs take the checkouts to read first.
      elapsed = 0;
      const random = mock.method(Math, "random", () => 0.9);
      try {
        assert.deepEqual(
          await pass.settleAbandonedCheckouts({ clock }),
          counts({ cancelled: 1, failed: 1 }),
        );
      } finally {
        random.mock.restore();
      }
      assert.equal((await stateOf(toRead.id)).status, "cancelled");
      assert.equal((await stateOf(settled.id)).status, "pending");
    });

    test("two runs at once: each record written once, the checkout cancelled once", async () => {
      const { id, sessions } = await checkout([{ status: "pending", age: 40 * MINUTE }]);

      // Both runs have read the checkout and its session, then wait on its row.
      await raceOnLockedRow(database, { table: "reservations", id }, [
        () => pass.settleAbandonedCheckouts(),
        () => pass.settleAbandonedCheckouts(),
      ]);

      assert.deepEqual(await stateOf(id), {
        status: "cancelled",
        payments: { [String(sessions[0])]: "cancelled" },
        history: ["cancelled", `payment_expired ${sessions[0]}`],
      });
    });

    test("a resume in flight is not cancelled by the pass: the session it replaced is marked, and nothing of the checkout is left for the pass", async () => {
      const { id, sessions } = await checkout([{ status: "pending", age: 40 * MINUTE }]);
      let outcome: unknown;
      // The resume has cancelled the old session's row and expired it; the pass
      // runs while the resume creates its own session.
      onStripeCall = async (call) => {
        if (call.startsWith("create ")) {
          onStripeCall = null;
          outcome = await pass.settleAbandonedCheckouts();
        }
      };

      const result = await resume(id);

      assert.ok(!("error" in result), JSON.stringify(result));
      assert.deepEqual(outcome, counts({}));
      assert.deepEqual(await settledOf(id), [String(sessions[0])]);
      assert.deepEqual(await stateOf(id), {
        status: "pending",
        payments: { [String(sessions[0])]: "cancelled", [String(result.sessionId)]: "pending" },
        history: ["payment_initiated"],
      });
    });

    test("a resume that installs its session while the pass reads the old one: the pass leaves the checkout", async () => {
      const { id, sessions } = await checkout([{ status: "pending", age: 40 * MINUTE }]);
      let resumed: Awaited<ReturnType<typeof resume>> | undefined;
      // The pass has read the checkout and its pending row, and reads the session at
      // Stripe: meanwhile the resume runs whole.
      onStripeCall = async (call) => {
        if (call === `retrieve ${sessions[0]}`) {
          onStripeCall = null;
          resumed = await resume(id);
        }
      };

      assert.deepEqual(await pass.settleAbandonedCheckouts(), counts({ left: 1 }));

      assert.ok(resumed && !("error" in resumed), JSON.stringify(resumed));
      assert.deepEqual(await stateOf(id), {
        status: "pending",
        payments: { [String(sessions[0])]: "cancelled", [String(resumed.sessionId)]: "pending" },
        history: ["payment_initiated"],
      });
    });

    test("the pass reads an old session while one resume installs its successor and another replaces that one: the pass does not cancel while the successor is unsettled, and cancels once it is marked", async () => {
      const { id, sessions } = await checkout([{ status: "pending", age: 40 * MINUTE }]);
      const first = String(sessions[0]);
      let installed: Awaited<ReturnType<typeof resume>> | undefined;
      let replacing: Promise<Awaited<ReturnType<typeof resume>>> | undefined;
      const held = moment();
      const replacingAsks = moment();
      onStripeCall = async (call) => {
        // The pass reads the first session: meanwhile resume A installs its
        // successor, then resume B cancels the successor's row and waits on Stripe.
        if (call === `retrieve ${first}` && !installed) {
          installed = await resume(id);
          assert.ok(installed && !("error" in installed), JSON.stringify(installed));
          atStripe.set(String(installed.sessionId), "open");
          replacing = resume(id);
          await replacingAsks.reached;
          return;
        }
        if (installed && !("error" in installed) && call === `expire ${installed.sessionId}`) {
          replacingAsks.release();
          await held.reached;
        }
      };

      assert.deepEqual(await pass.settleAbandonedCheckouts(), counts({ left: 1 }));
      assert.equal((await stateOf(id)).status, "pending", "not cancelled while it is unsettled");

      held.release();
      assert.deepEqual(await replacing, { error: "errors.paymentSessionError" });
      onStripeCall = null;
      assert.ok(installed && !("error" in installed));
      const successor = String(installed.sessionId);
      assert.deepEqual(await settledOf(id), [first]);

      // The successor's session ends unpaid; its event is lost. Past its lifetime,
      // the pass reads it expired, marks it, and cancels the checkout.
      atStripe.set(successor, "expired");
      await louezDb.db
        .update(louezDb.payments)
        .set({ createdAt: new Date(Date.now() - 40 * MINUTE) })
        .where(eq(louezDb.payments.stripeCheckoutSessionId, successor));
      assert.deepEqual(await pass.settleAbandonedCheckouts(), counts({ cancelled: 1 }));
      assert.deepEqual(await settledOf(id), [first, successor].sort());
      assert.equal((await stateOf(id)).status, "cancelled");
    });

    test("a resume replaces the last session and is refused, then that session's expiry marks it: past the delay, the pass cancels the checkout", async () => {
      const { id, sessions } = await checkout([{ status: "pending", age: 5 * MINUTE }]);
      const last = String(sessions[0]);
      // Stripe can neither expire nor read the session: the resume is refused, and
      // the row it cancelled stays cancelled.
      atStripe.set(last, "unreachable");
      assert.deepEqual(await resume(id), { error: "errors.paymentSessionError" });
      // Its expiry is delivered: the handler's write marks the replaced row alone.
      assert.equal(
        await settlement.recordCheckoutSessionExpiry({
          reservationId: id,
          paymentId: `pay_${id}_0`,
          session: { id: last, amount_total: 1000, currency: "eur" },
        }),
        false,
      );
      assert.deepEqual(await settledOf(id), [last]);
      assert.equal((await stateOf(id)).status, "pending");

      // Within the delay the pass leaves it; once the mark is past it, it cancels.
      assert.deepEqual(await pass.settleAbandonedCheckouts(), counts({}));
      await louezDb.db
        .update(louezDb.payments)
        .set({ sessionSettledAt: new Date(Date.now() - 40 * MINUTE) })
        .where(eq(louezDb.payments.stripeCheckoutSessionId, last));
      stripeCalls.length = 0;
      assert.deepEqual(await pass.settleAbandonedCheckouts(), counts({ cancelled: 1 }));
      assert.deepEqual(stripeCalls, [], "no Stripe call");
      assert.deepEqual(await stateOf(id), {
        status: "cancelled",
        payments: { [last]: "cancelled" },
        history: ["cancelled"],
      });
    });

    test("a settled checkout is left when a successor is pending, a rental payment completed, its newest mark younger than the delay, or older than the bound", async () => {
      const successor = await checkout([
        { status: "cancelled", age: 3 * HOUR, settled: 40 * MINUTE },
        { status: "pending", age: 2 * MINUTE },
      ]);
      const paid = await checkout([
        { status: "cancelled", age: 3 * HOUR, settled: 40 * MINUTE },
        { status: "completed", age: 2 * HOUR },
      ]);
      const young = await checkout([
        { status: "cancelled", age: 3 * HOUR, settled: 40 * MINUTE },
        { status: "cancelled", age: 10 * MINUTE, settled: 5 * MINUTE },
      ]);
      const old = await checkout([{ status: "cancelled", age: 50 * HOUR, settled: 49 * HOUR }]);

      assert.deepEqual(await pass.findAbandonedCheckouts(new Date()), []);
      assert.deepEqual(await pass.settleAbandonedCheckouts(), counts({}));
      for (const { id } of [successor, paid, young, old]) {
        assert.equal((await stateOf(id)).status, "pending", id);
      }
      assert.deepEqual(stripeCalls, []);
    });

    test("two runs at once over a settled checkout: cancelled once", async () => {
      const { id } = await checkout([{ status: "cancelled", age: 3 * HOUR, settled: 40 * MINUTE }]);

      // Both runs have drawn the checkout, then wait on its row.
      await raceOnLockedRow(database, { table: "reservations", id }, [
        () => pass.settleAbandonedCheckouts(),
        () => pass.settleAbandonedCheckouts(),
      ]);

      assert.deepEqual((await stateOf(id)).history, ["cancelled"]);
      assert.equal((await stateOf(id)).status, "cancelled");
    });

    test("a settled checkout cancelled by the pass while a resume creates its session: the resume installs nothing and expires its session", async () => {
      const { id, sessions } = await checkout([
        { status: "cancelled", age: 3 * HOUR, settled: 40 * MINUTE },
      ]);
      let outcome: unknown;
      onStripeCall = async (call) => {
        if (call.startsWith("create ")) {
          onStripeCall = null;
          outcome = await pass.settleAbandonedCheckouts();
        }
      };

      assert.deepEqual(await resume(id), { error: "errors.invalidStatus" });

      assert.deepEqual(outcome, counts({ cancelled: 1 }));
      const created = stripeCalls
        .find((call) => call.startsWith("create "))
        ?.slice("create ".length);
      assert.ok(stripeCalls.includes(`expire ${created}`), "the new session expired");
      assert.deepEqual(await stateOf(id), {
        status: "cancelled",
        payments: { [String(sessions[0])]: "cancelled" },
        history: ["cancelled"],
      });
    });

    test("a resume that installs its session after the pass drew the settled checkout: the cancellation, under the lock, leaves it", async () => {
      const { id, sessions } = await checkout([
        { status: "cancelled", age: 3 * HOUR, settled: 40 * MINUTE },
      ]);
      let resumed: Awaited<ReturnType<typeof resume>> | undefined;
      // The pass has drawn the checkout and asks for its cancellation: before the
      // cancellation takes the reservation's lock, the resume runs whole.
      reservationChangeTestHooks().beforeReservationLock = async (scope) => {
        if (scope.reservationId !== id) return;
        reservationChangeTestHooks().beforeReservationLock = null;
        resumed = await resume(id);
      };

      assert.deepEqual(await pass.settleAbandonedCheckouts(), counts({ left: 1 }));

      assert.ok(resumed && !("error" in resumed), JSON.stringify(resumed));
      assert.deepEqual(await stateOf(id), {
        status: "pending",
        payments: { [String(sessions[0])]: "cancelled", [String(resumed.sessionId)]: "pending" },
        history: ["payment_initiated"],
      });
    });

    test("three resumes: one replaces the session another just gave, while a third creates its own: the third installs nothing and its session is expired; one session given stays payable", async () => {
      const { id, sessions } = await checkout([{ status: "pending", age: 5 * MINUTE }]);
      let given: Awaited<ReturnType<typeof resume>> | undefined;
      let replacing: Promise<Awaited<ReturnType<typeof resume>>> | undefined;
      const held = moment();
      const replacingAsks = moment();
      let createdByA: string | undefined;
      onStripeCall = async (call) => {
        // Resume A has settled the first session and creates its own: meanwhile
        // resume B installs its session and gives its URL, then resume C cancels
        // B's row and waits on Stripe.
        if (call.startsWith("create ") && !createdByA) {
          createdByA = call.slice("create ".length);
          given = await resume(id);
          assert.ok(given && !("error" in given), JSON.stringify(given));
          atStripe.set(String(given.sessionId), "open");
          replacing = resume(id);
          await replacingAsks.reached;
          return;
        }
        if (given && !("error" in given) && call === `expire ${given.sessionId}`) {
          replacingAsks.release();
          await held.reached;
        }
      };

      const third = await resume(id);
      held.release();
      const replaced = await replacing;
      onStripeCall = null;

      assert.ok(given && !("error" in given));
      assert.deepEqual(third, { error: "errors.paymentSessionError" }, "A installs nothing");
      assert.deepEqual(replaced, { error: "errors.paymentSessionError" }, "C installs nothing");
      assert.ok(stripeCalls.includes(`expire ${createdByA}`), "A's session expired at Stripe");
      // B's session is the one session given to the customer that is still payable;
      // its row is cancelled and unsettled, so nothing installs another meanwhile.
      assert.deepEqual(await stateOf(id), {
        status: "pending",
        payments: { [String(sessions[0])]: "cancelled", [String(given.sessionId)]: "cancelled" },
        history: ["payment_initiated"],
      });
      assert.deepEqual(await settledOf(id), [String(sessions[0])]);
    });
  },
);
