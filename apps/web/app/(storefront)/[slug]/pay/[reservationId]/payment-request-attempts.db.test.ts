import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";
import type Stripe from "stripe";

import {
  createTestDatabase,
  raceOnLockedRow,
  skipWithoutTestDatabase,
  type TestDatabase,
  waitForLockWaits,
} from "@louez/db/testing";

import { closeNetworkForSuite } from "@/lib/testing/network-guard";

// A payment request's session and the rental's other door, the customer's own
// payment session, go through one gate (invariants M5, M6): under the
// reservation's lock, the request is checked against the reservation's status
// and, for a rental request, against what is still owed; the rental's open
// payments are cancelled and their sessions expired at Stripe before a new one
// is created, and the new one is installed as a pending payment only on a
// reservation still payable with no other open attempt. Sending the same
// request again replaces its session; a session paid anyway is recorded once,
// and the rental reads paid above its total. Stripe is a fake that notes what
// it is asked: no network. The database is real.

process.env.SKIP_ENV_VALIDATION = "true";
// The Stripe client is built from this key, then its sessions are replaced.
process.env.STRIPE_SECRET_KEY = "sk_test_stub";
delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
// The store is billed by nobody here: no fee is planned, and none is asked of a service.
delete process.env.LOUEZ_BILLING;
delete process.env.BILLING_SERVICE_URL;

const LOCALE_SCHEME = "louez-pay-attempts-locale:";
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
    // The page's locale comes from the request, which a test has not.
    if (parent.endsWith("/pay/[reservationId]/actions.ts") && specifier === "next-intl/server") {
      return { shortCircuit: true, url: `${LOCALE_SCHEME}next-intl` };
    }
    return next(specifier, context);
  },
  load(url: string, context: unknown, next: (url: string, context: unknown) => unknown) {
    if (!url.startsWith(LOCALE_SCHEME)) return next(url, context);
    return {
      shortCircuit: true,
      format: "module",
      source: `export async function getLocale() { return "en"; }\n`,
    };
  },
});

const STORE = "store_pay_attempts";
const SLUG = "pay-attempts";
const ACCOUNT = "acct_pay_attempts";
const CUSTOMER = "customer_pay_attempts";

describe(
  "a payment request's session and the rental's other door (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    // No test of this suite reaches a provider: Stripe is a fake.
    closeNetworkForSuite();

    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let pay: typeof import("./actions");
    let paymentSession: typeof import("@/lib/reservations/payment-session");
    let completion: typeof import("@/lib/stripe/payment-completion");
    let counter = 0;
    const nextId = (prefix: string) => `${prefix}_${++counter}`;

    /** What Stripe was asked, in order: `create <id>` and `expire <id>`. */
    const calls: string[] = [];
    /** Each session created: its id, parameters and request options. */
    const created: Array<{
      id: string;
      params: Stripe.Checkout.SessionCreateParams;
      options: Stripe.RequestOptions | undefined;
    }> = [];
    const expired = new Set<string>();
    /** Runs after a session is created, before it is installed: a test's moment. */
    let afterCreate: (() => Promise<void>) | null = null;

    /** The sessions a customer could still pay: created and not expired. */
    const payable = () => created.map(({ id }) => id).filter((id) => !expired.has(id));

    before(async () => {
      database = await createTestDatabase("pay_request_attempts");
      // DATABASE_URL now points at the test database.
      louezDb = await import("@louez/db");
      pay = await import("./actions");
      paymentSession = await import("@/lib/reservations/payment-session");
      completion = await import("@/lib/stripe/payment-completion");
      const { getStripe } = await import("@/lib/stripe/client");
      Reflect.set(
        getStripe().checkout.sessions,
        "create",
        async (params: Stripe.Checkout.SessionCreateParams, options?: Stripe.RequestOptions) => {
          const id = `cs_attempt_${created.length + 1}`;
          created.push({ id, params, options });
          calls.push(`create ${id}`);
          await afterCreate?.();
          return { id, url: `https://checkout.stripe.test/${id}`, expires_at: 1_900_000_000 };
        },
      );
      Reflect.set(getStripe().checkout.sessions, "expire", async (id: string) => {
        calls.push(`expire ${id}`);
        if (expired.has(id))
          throw new Error("This Checkout Session is not in an expireable state.");
        expired.add(id);
        return { id, status: "expired", amount_total: 0, currency: "eur" };
      });
      Reflect.set(getStripe().checkout.sessions, "retrieve", async (id: string) => ({
        id,
        status: expired.has(id) ? "expired" : "open",
        payment_status: "unpaid",
      }));

      await louezDb.db.insert(louezDb.stores).values({
        id: STORE,
        userId: "owner_pay_attempts",
        name: "Pay attempts",
        slug: SLUG,
        stripeAccountId: ACCOUNT,
        stripeChargesEnabled: true,
        onboardingCompleted: true,
        settings: { reservationMode: "request", currency: "EUR", advanceNoticeMinutes: 0 },
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
      calls.length = 0;
      created.length = 0;
      expired.clear();
      afterCreate = null;
    });

    type Status = (typeof louezDb.reservations.$inferInsert)["status"];

    /** A signed reservation of 100.00 EUR. */
    async function reservation(status: Status = "confirmed", total = "100.00") {
      const id = nextId("res_attempt");
      await louezDb.db.insert(louezDb.reservations).values({
        id,
        storeId: STORE,
        customerId: CUSTOMER,
        number: id,
        status,
        startDate: new Date("2031-06-10T09:00:00Z"),
        endDate: new Date("2031-06-12T09:00:00Z"),
        subtotalAmount: total,
        depositAmount: "0.00",
        totalAmount: total,
        currency: "EUR",
        signedAt: new Date("2031-06-01T09:00:00Z"),
      });
      return id;
    }

    /** A payment request of the reservation. */
    async function request(
      reservationId: string,
      { amount = "100.00", type = "rental" as "rental" | "custom" } = {},
    ) {
      const token = nextId("token");
      const requestId = nextId("req");
      await louezDb.db.insert(louezDb.paymentRequests).values({
        id: requestId,
        storeId: STORE,
        reservationId,
        token,
        amount,
        currency: "EUR",
        description: type === "rental" ? "Rental" : "Damage",
        type,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      return { id: reservationId, token, requestId };
    }

    /** A payment the store records by hand. */
    const recordCash = (reservationId: string, amount: string) =>
      louezDb.db.insert(louezDb.payments).values({
        id: nextId("cash"),
        reservationId,
        amount,
        type: "rental",
        method: "cash",
        status: "completed",
        currency: "EUR",
      });

    const load = (link: { id: string; token: string }) =>
      pay.getPaymentRequestData({ slug: SLUG, reservationId: link.id, token: link.token });

    const open = (link: { id: string; token: string; requestId: string }) =>
      pay.initiatePayment({
        slug: SLUG,
        reservationId: link.id,
        token: link.token,
        paymentRequestId: link.requestId,
      });

    /** The rental's other door: the customer's account page. */
    const fromAccount = (reservationId: string) =>
      paymentSession.createReservationPaymentSessionForCustomer(
        SLUG,
        reservationId,
        CUSTOMER,
        "account_page",
      );

    /** The reservation's Stripe payments, by session. */
    async function sessionRows(reservationId: string) {
      const rows = await louezDb.db
        .select({
          id: louezDb.payments.id,
          session: louezDb.payments.stripeCheckoutSessionId,
          status: louezDb.payments.status,
          settled: louezDb.payments.sessionSettledAt,
          origin: louezDb.payments.origin,
          paymentRequestId: louezDb.payments.paymentRequestId,
        })
        .from(louezDb.payments)
        .where(eq(louezDb.payments.reservationId, reservationId));
      return rows
        .filter((row) => row.session !== null)
        .sort((a, b) => String(a.session).localeCompare(String(b.session)))
        .map(({ settled, ...row }) => ({ ...row, settled: settled !== null }));
    }

    async function requestStatus(requestId: string) {
      const [row] = await louezDb.db
        .select({ status: louezDb.paymentRequests.status })
        .from(louezDb.paymentRequests)
        .where(eq(louezDb.paymentRequests.id, requestId));
      return row?.status;
    }

    /**
     * Runs `statements` in a transaction on another connection, which keeps their
     * locks until a transaction waits on one of them, then commits.
     */
    async function commitOnceWaitedOn(statements: ReadonlyArray<[string, unknown[]]>) {
      const holder = await database.connect();
      await holder.beginTransaction();
      for (const [statement, values] of statements) await holder.query(statement, values);
      const committed = (async () => {
        try {
          await waitForLockWaits(holder, database.name, 1);
        } finally {
          await holder.commit();
          await holder.end();
        }
      })();
      return { committed };
    }

    /** The completion writer, as the webhook calls it for a paid session of the request. */
    const paid = (reservationId: string, sessionId: string, paymentRequestId: string) =>
      completion.claimCompletedCheckoutPayment({
        reservationId,
        amount: 100,
        currency: "EUR",
        stripeCheckoutSessionId: sessionId,
        stripePaymentIntentId: `pi_${sessionId}`,
        stripeChargeId: `ch_${sessionId}`,
        stripePaymentMethodId: "pm_card",
        stripeAccountId: ACCOUNT,
        claimedAt: new Date("2031-06-02T10:00:00Z"),
        paidAt: new Date("2031-06-02T09:59:58Z"),
        grossMinor: 10_000,
        insuranceShareMinor: 0,
        origin: "payment_request",
        paymentRequestId,
        feeFacts: null,
      });

    test("rule 6: a customer who pays once gets the same session, and its payment is the one recorded", async () => {
      const link = await request(await reservation());

      const result = await open(link);

      assert.deepEqual(result, { ok: true, url: "https://checkout.stripe.test/cs_attempt_1" });
      const [session] = created;
      assert.equal(session?.options?.stripeAccount, ACCOUNT);
      assert.equal(session?.params.line_items?.[0]?.price_data?.unit_amount, 10_000);
      assert.equal(session?.params.line_items?.[0]?.price_data?.currency, "eur");
      assert.equal(session?.params.metadata?.paymentRequestId, link.requestId);
      assert.deepEqual(payable(), ["cs_attempt_1"]);

      const claim = await paid(link.id, "cs_attempt_1", link.requestId);

      assert.equal(claim.claimed, true);
      const payments = await louezDb.db
        .select({
          id: louezDb.payments.id,
          amount: louezDb.payments.amount,
          currency: louezDb.payments.currency,
          type: louezDb.payments.type,
          method: louezDb.payments.method,
          status: louezDb.payments.status,
          origin: louezDb.payments.origin,
          paymentRequestId: louezDb.payments.paymentRequestId,
          stripeAccountId: louezDb.payments.stripeAccountId,
        })
        .from(louezDb.payments)
        .where(eq(louezDb.payments.reservationId, link.id));
      assert.deepEqual(payments, [
        {
          id: claim.paymentId,
          amount: "100.00",
          currency: "EUR",
          type: "rental",
          method: "stripe",
          status: "completed",
          origin: "payment_request",
          paymentRequestId: link.requestId,
          stripeAccountId: ACCOUNT,
        },
      ]);
      assert.equal(await requestStatus(link.requestId), "completed");
    });

    test("rule 1: the same request sent again replaces its session, expired before the next is created; one session payable", async () => {
      const link = await request(await reservation());

      const first = await open(link);
      const second = await open(link);

      assert.ok(first.ok && second.ok, JSON.stringify([first, second]));
      assert.deepEqual(calls, [
        "create cs_attempt_1",
        "expire cs_attempt_1",
        "create cs_attempt_2",
      ]);
      assert.deepEqual(payable(), ["cs_attempt_2"]);
      const rows = await sessionRows(link.id);
      assert.deepEqual(
        rows.map(({ id: _id, ...row }) => row),
        [
          {
            session: "cs_attempt_1",
            status: "cancelled",
            settled: true,
            origin: "payment_request",
            paymentRequestId: link.requestId,
          },
          {
            session: "cs_attempt_2",
            status: "pending",
            settled: false,
            origin: "payment_request",
            paymentRequestId: link.requestId,
          },
        ],
      );
      // Each create is sent with a key of its own attempt: a retry of it finds the same session.
      assert.deepEqual(
        created.map(({ options }) => options?.idempotencyKey),
        rows.map(({ id }) => `checkout-session:${id}`),
      );
    });

    test("rule 1: the request sent from two tabs at once: one session installed, the other expired and refused", async () => {
      const link = await request(await reservation());

      // Both have read the request, then wait on the reservation's row.
      const answers = await raceOnLockedRow(database, { table: "reservations", id: link.id }, [
        () => open(link),
        () => open(link),
      ]);

      const installed = answers.filter((answer) => answer.ok);
      assert.equal(installed.length, 1, JSON.stringify(answers));
      assert.deepEqual(
        answers.filter((answer) => !answer.ok),
        [{ ok: false, error: "session_creation_failed" }],
      );
      assert.equal(payable().length, 1, `payable: ${payable().join(", ")}`);
      const pending = (await sessionRows(link.id)).filter((row) => row.status === "pending");
      assert.deepEqual(
        pending.map((row) => row.session),
        payable(),
      );
    });

    test("rule 3: a payment the store records while the session is created: the request asks more than is owed, nothing installed", async () => {
      const link = await request(await reservation());
      let recording: { committed: Promise<void> } | undefined;
      // The store's payment holds the reservation's row when the session comes to
      // be installed, and commits once the install waits on it.
      afterCreate = async () => {
        recording = await commitOnceWaitedOn([
          ["SELECT id FROM reservations WHERE id = ? FOR UPDATE", [link.id]],
          [
            "INSERT INTO payments (id, reservation_id, amount, payment_type, payment_method, payment_status, currency) VALUES (?, ?, '30.00', 'rental', 'cash', 'completed', 'EUR')",
            [nextId("cash"), link.id],
          ],
        ]);
      };

      const result = await open(link);
      await recording?.committed;

      assert.deepEqual(result, { ok: false, error: "no_longer_current" });
      assert.deepEqual(payable(), [], "the session created is expired");
      assert.deepEqual(await sessionRows(link.id), []);
      assert.equal(await requestStatus(link.requestId), "pending");
    });

    test("rule 2: the account's session open, then the request: the account's is expired and its payment cancelled first", async () => {
      const reservationId = await reservation();
      const link = await request(reservationId);
      const account = await fromAccount(reservationId);
      assert.ok("sessionId" in account, JSON.stringify(account));

      const result = await open(link);

      assert.ok(result.ok, JSON.stringify(result));
      assert.deepEqual(calls, [
        "create cs_attempt_1",
        "expire cs_attempt_1",
        "create cs_attempt_2",
      ]);
      assert.deepEqual(payable(), ["cs_attempt_2"]);
      assert.deepEqual(
        (await sessionRows(reservationId)).map(({ session, status, origin }) => [
          session,
          status,
          origin,
        ]),
        [
          ["cs_attempt_1", "cancelled", "customer_session"],
          ["cs_attempt_2", "pending", "payment_request"],
        ],
      );
    });

    test("rule 2: the request's session open, then the account: the request's is expired and its payment cancelled first", async () => {
      const reservationId = await reservation();
      const link = await request(reservationId);
      assert.ok((await open(link)).ok);

      const account = await fromAccount(reservationId);

      assert.ok("sessionId" in account, JSON.stringify(account));
      assert.deepEqual(calls, [
        "create cs_attempt_1",
        "expire cs_attempt_1",
        "create cs_attempt_2",
      ]);
      assert.deepEqual(payable(), ["cs_attempt_2"]);
      assert.deepEqual(
        (await sessionRows(reservationId)).map(({ session, status, origin }) => [
          session,
          status,
          origin,
        ]),
        [
          ["cs_attempt_1", "cancelled", "payment_request"],
          ["cs_attempt_2", "pending", "customer_session"],
        ],
      );
    });

    test("rule 2: a custom request takes the same gate, and asks the store's amount whatever the rental owes", async () => {
      // The rental is settled; the store asks 40 for damage.
      const reservationId = await reservation("completed");
      await recordCash(reservationId, "100.00");
      const damage = await request(reservationId, { amount: "40.00", type: "custom" });

      assert.ok((await load(damage)).ok);
      const first = await open(damage);
      const again = await open(damage);

      assert.ok(first.ok && again.ok, JSON.stringify([first, again]));
      assert.deepEqual(payable(), ["cs_attempt_2"]);
      assert.equal(created[0]?.params.line_items?.[0]?.price_data?.unit_amount, 4000);
      assert.deepEqual(
        (await sessionRows(reservationId)).map(({ session, status }) => [session, status]),
        [
          ["cs_attempt_1", "cancelled"],
          ["cs_attempt_2", "pending"],
        ],
      );
    });

    test("rule 4: a request on a cancelled, rejected or declined reservation opens nothing", async () => {
      for (const status of ["cancelled", "rejected", "declined"] as const) {
        for (const type of ["rental", "custom"] as const) {
          const link = await request(await reservation(status), { type });

          assert.deepEqual(
            await load(link),
            { ok: false, error: "cancelled" },
            `${status} ${type}`,
          );
          assert.deepEqual(
            await open(link),
            { ok: false, error: "cancelled" },
            `${status} ${type}`,
          );
        }
      }
      assert.deepEqual(created, [], "no session asked for");
    });

    test("rule 4: the store cancels the reservation while the session is created: nothing installed, the session expired", async () => {
      const link = await request(await reservation());
      let cancellation: { committed: Promise<void> } | undefined;
      afterCreate = async () => {
        cancellation = await commitOnceWaitedOn([
          ["UPDATE reservations SET reservation_status = 'cancelled' WHERE id = ?", [link.id]],
        ]);
      };

      const result = await open(link);
      await cancellation?.committed;

      assert.deepEqual(result, { ok: false, error: "cancelled" });
      assert.deepEqual(payable(), []);
      assert.deepEqual(await sessionRows(link.id), []);
    });

    test("rule 5: a replaced session paid anyway is recorded once, and the rental reads paid above its total", async () => {
      const link = await request(await reservation());
      assert.ok((await open(link)).ok);
      assert.ok((await open(link)).ok);

      // Stripe took both: the first in a tab left open before it was expired, heard late.
      const late = await paid(link.id, "cs_attempt_1", link.requestId);
      const current = await paid(link.id, "cs_attempt_2", link.requestId);
      const replay = await paid(link.id, "cs_attempt_1", link.requestId);

      assert.equal(late.claimed, true);
      assert.equal(current.claimed, true);
      assert.deepEqual(replay, { paymentId: late.paymentId, claimed: false });
      assert.deepEqual(
        (await sessionRows(link.id)).map(({ id, session, status }) => [id, session, status]),
        [
          [late.paymentId, "cs_attempt_1", "completed"],
          [current.paymentId, "cs_attempt_2", "completed"],
        ],
      );
      const rows = await louezDb.db
        .select()
        .from(louezDb.payments)
        .where(eq(louezDb.payments.reservationId, link.id));
      const { getRentalPaid } = await import("@/lib/reservations/util.payment-status");
      assert.equal(
        getRentalPaid(rows, "EUR"),
        200,
        "paid above the rental's 100: the store refunds one",
      );
      assert.equal(await requestStatus(link.requestId), "completed");
    });
  },
);
