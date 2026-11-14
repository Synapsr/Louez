import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, afterEach, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import {
  createTestDatabase,
  raceOnLockedRow,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";

// The cron's pass over abandoned online checkouts, on a migrated database: what
// it looks at (an online checkout still pending, no rental payment completed,
// its newest session past a session's lifetime and a margin, and under 48
// hours old, at most a batch a run, oldest first), what it reads at Stripe
// (every unsettled session, never expired), and what it records (a paid session
// as the customer's return records it; every session expired, each pending row
// as the expiry handler records it, then the checkout's cancellation), against
// itself and a resume in flight (docs/domain/reservation-changes.md). Stripe is
// a fake: no network.

process.env.SKIP_ENV_VALIDATION = "true";
process.env.STRIPE_SECRET_KEY = "sk_test_stub";
delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
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

type AtStripe = "complete" | "expired" | "open" | "unreachable";

describe(
  "the pass over abandoned checkouts (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let pass: typeof import("./abandoned-checkouts");
    let paymentSession: typeof import("./payment-session");
    let counter = 0;
    /** What Stripe reads of a session; by default it reads it expired. */
    const atStripe = new Map<string, AtStripe>();
    /** The calls to Stripe, in order: `retrieve cs_…`, `expire cs_…`, `create cs_…`. */
    const stripeCalls: string[] = [];
    /** Runs as Stripe is asked something: a test's moment. */
    let onStripeCall: ((call: string) => Promise<void>) | null = null;

    before(async () => {
      database = await createTestDatabase("abandoned_checkouts");
      // DATABASE_URL now points at the test database.
      louezDb = await import("@louez/db");
      paymentSession = await import("./payment-session");
      pass = await import("./abandoned-checkouts");
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
        return { id, status: "expired" };
      });
      // A session id here is `cs_` and its reservation's id, then `_` and a number.
      Reflect.set(sessions, "retrieve", async (id: string) => {
        await call(`retrieve ${id}`);
        const state = atStripe.get(id) ?? "expired";
        if (state === "unreachable") throw new Error("Stripe not reached");
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
      });
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
      stripeCalls.length = 0;
      onStripeCall = null;
      // Each case leaves nothing for the next one's pass to look at.
      await louezDb.db.delete(louezDb.payments);
      await louezDb.db.delete(louezDb.reservationActivity);
      await louezDb.db.delete(louezDb.reservations);
    });

    /**
     * A checkout of 10.00 EUR and its rental sessions' rows, each `{ status, age }`,
     * the age being how long ago its row was written.
     */
    async function checkout(
      sessions: ReadonlyArray<{ status: "pending" | "cancelled" | "completed"; age: number }>,
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
      for (const [index, { status, age }] of sessions.entries()) {
        const sessionId = `cs_${id}_${index}`;
        ids.push(sessionId);
        await louezDb.db.insert(louezDb.payments).values({
          id: `pay_${id}_${index}`,
          reservationId: id,
          amount: "10.00",
          type: "rental",
          method: "stripe",
          status,
          stripeCheckoutSessionId: sessionId,
          stripeAccountId: ACCOUNT,
          origin: "checkout",
          currency: "EUR",
          createdAt: new Date(Date.now() - age),
        });
      }
      return { id, sessions: ids };
    }

    /** The `payment_expired` line the expiry of `session` wrote. */
    const expiryLine = (reservationId: string, session: string) =>
      louezDb.db.insert(louezDb.reservationActivity).values({
        id: `act_${session}`,
        reservationId,
        activityType: "payment_expired",
        metadata: { checkoutSessionId: session, amount: 10, currency: "EUR", method: "stripe" },
      });

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

    const resume = (reservationId: string) =>
      paymentSession.createReservationPaymentSessionForCustomer(
        SLUG,
        reservationId,
        CUSTOMER,
        "checkout_resume",
        { allowPendingReservation: true, chargeAmount: 10 },
      );

    test("a session paid and never recorded: recorded as the customer's return records it, the checkout confirmed", async () => {
      const { id, sessions } = await checkout([{ status: "pending", age: 40 * MINUTE }]);
      atStripe.set(String(sessions[0]), "complete");

      assert.deepEqual(await pass.settleAbandonedCheckouts(), {
        confirmed: 1,
        cancelled: 0,
        left: 0,
        unreadable: 0,
        failed: 0,
      });

      const state = await stateOf(id);
      assert.equal(state.status, "confirmed");
      assert.deepEqual(state.payments, { [String(sessions[0])]: "completed" });
      assert.ok(!stripeCalls.some((call) => call.startsWith("expire")), "nothing expired");
    });

    test("every session expired: each pending row recorded as the expiry handler records it, then the checkout cancelled; a session a line names is not read", async () => {
      const { id, sessions } = await checkout([
        { status: "pending", age: 40 * MINUTE },
        // Replaced by a resume: cancelled, no line names it.
        { status: "cancelled", age: 50 * MINUTE },
        // Its expiry recorded.
        { status: "cancelled", age: 60 * MINUTE },
      ]);
      const [pending, replaced, recorded] = sessions.map(String);
      await expiryLine(id, String(recorded));

      assert.equal((await pass.settleAbandonedCheckouts()).cancelled, 1);

      assert.deepEqual(stripeCalls.sort(), [`retrieve ${pending}`, `retrieve ${replaced}`].sort());
      assert.deepEqual(await stateOf(id), {
        status: "cancelled",
        payments: {
          [String(pending)]: "cancelled",
          [String(replaced)]: "cancelled",
          [String(recorded)]: "cancelled",
        },
        history: ["cancelled", `payment_expired ${pending}`, `payment_expired ${recorded}`],
      });
    });

    test("a session unread or still open: nothing written, the checkout left to the next run", async () => {
      for (const state of ["unreachable", "open"] as const) {
        const { id, sessions } = await checkout([{ status: "pending", age: 40 * MINUTE }]);
        atStripe.set(String(sessions[0]), state);

        assert.equal((await pass.settleAbandonedCheckouts()).unreadable, 1, state);

        assert.deepEqual(
          await stateOf(id),
          { status: "pending", payments: { [String(sessions[0])]: "pending" }, history: [] },
          state,
        );
        await louezDb.db.delete(louezDb.reservations).where(eq(louezDb.reservations.id, id));
      }
    });

    test("a checkout whose newest session is within its lifetime and margin, or older than 48 hours, is not looked at", async () => {
      const young = await checkout([
        { status: "cancelled", age: 3 * HOUR },
        { status: "pending", age: 10 * MINUTE },
      ]);
      const old = await checkout([{ status: "pending", age: 49 * HOUR }]);

      assert.deepEqual(await pass.settleAbandonedCheckouts(), {
        confirmed: 0,
        cancelled: 0,
        left: 0,
        unreadable: 0,
        failed: 0,
      });

      assert.deepEqual(stripeCalls, []);
      assert.equal((await stateOf(young.id)).status, "pending");
      assert.equal((await stateOf(old.id)).status, "pending");
    });

    test("at most a batch a run, oldest first", async () => {
      const checkouts = [];
      for (let index = 0; index <= pass.ABANDONED_CHECKOUTS_PER_RUN; index += 1) {
        // The first is the youngest.
        checkouts.push(await checkout([{ status: "pending", age: (40 + index) * MINUTE }]));
      }

      assert.equal(
        (await pass.settleAbandonedCheckouts()).cancelled,
        pass.ABANDONED_CHECKOUTS_PER_RUN,
      );

      assert.equal(stripeCalls.length, pass.ABANDONED_CHECKOUTS_PER_RUN);
      const [youngest, ...others] = checkouts;
      assert.equal((await stateOf(String(youngest?.id))).status, "pending", "the youngest waits");
      for (const { id } of others) assert.equal((await stateOf(id)).status, "cancelled");
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

    test("a marketplace booking, a checkout with a completed rental payment, and a reservation not from an online checkout are not looked at", async () => {
      const marketplace = await checkout([{ status: "pending", age: 40 * MINUTE }], {
        source: "marketplace",
      });
      const paid = await checkout([
        { status: "completed", age: 50 * MINUTE },
        { status: "pending", age: 40 * MINUTE },
      ]);
      const manual = await checkout([{ status: "pending", age: 40 * MINUTE }], {
        source: "manual",
      });

      assert.equal((await pass.settleAbandonedCheckouts()).cancelled, 0);

      assert.deepEqual(stripeCalls, []);
      for (const { id } of [marketplace, paid, manual]) {
        assert.equal((await stateOf(id)).status, "pending", id);
      }
    });

    test("a pass that cancels the checkout while a resume creates its session: the resume installs nothing, expires its session and answers errors.invalidStatus", async () => {
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

      assert.deepEqual(await resume(id), { error: "errors.invalidStatus" });

      assert.equal((outcome as { cancelled: number }).cancelled, 1);
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

      assert.deepEqual(await pass.settleAbandonedCheckouts(), {
        confirmed: 0,
        cancelled: 0,
        left: 1,
        unreadable: 0,
        failed: 0,
      });

      assert.ok(resumed && !("error" in resumed), JSON.stringify(resumed));
      assert.deepEqual(await stateOf(id), {
        status: "pending",
        payments: { [String(sessions[0])]: "cancelled", [String(resumed.sessionId)]: "pending" },
        history: ["payment_initiated"],
      });
    });
  },
);
