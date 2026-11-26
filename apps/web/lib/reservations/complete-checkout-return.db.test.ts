import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// The customer's return from Stripe on a migrated database, through
// `completeCheckoutPayment` (docs/domain/reservation-changes.md, 6a-W2): the
// payment row of the session is read before Stripe is asked, and the session and
// its PaymentIntent are read on the account that row records, else on the
// store's connected account; the claim records that account. Stripe's reads are
// replaced by ones that note the account each is made on, in order, and fail on
// any other call; the senders, the invoicing and the fee runner are replaced.

const directory = mkdtempSync(join(tmpdir(), "louez-checkout-return-"));
const stubsPath = join(directory, "stubs.cjs");
writeFileSync(stubsPath, "module.exports = globalThis.__louezCheckoutReturnStubs;");
after(() => rmSync(directory, { recursive: true }));

/** What each module has replaced, by the module that imports it. */
const STUBBED: Record<string, ReadonlySet<string>> = {
  "/lib/reservations/complete-checkout-payment.ts": new Set([
    "@/lib/billing/reservation-effects",
    "@/lib/discord/platform-notifications",
    "@/lib/evlog",
    "@/lib/integrations/calendar/sync",
    "@/lib/invoicing/delivery",
    "@/lib/invoicing/service",
    "@/lib/notifications/customer-dispatcher",
    "@/lib/notifications/dispatcher",
    "@/lib/product-analytics/analytics",
    "@/lib/stripe/client",
  ]),
  // `getCheckoutSession` reads the session through it.
  "/lib/stripe.ts": new Set(["./stripe/client"]),
};

type Call = [name: string, ...args: unknown[]];
const calls: Call[] = [];
const record =
  (name: string, answer: () => unknown = () => undefined) =>
  (...args: unknown[]) => {
    calls.push([name, ...structuredClone(args)]);
    return answer();
  };
const unexpected = (name: string) => () => {
  throw new Error(`Unexpected Stripe call: ${name}`);
};

/** What Stripe answers of a session instead of the paid one below, by its id. */
const sessionAtStripe = new Map<string, Record<string, unknown>>();

const stripe = {
  checkout: {
    sessions: {
      // A paid storefront checkout's session, whose metadata names `reservationId`.
      retrieve: async (id: string, options: { stripeAccount?: string } | undefined) => {
        calls.push(["stripe.checkout.sessions.retrieve", id, options?.stripeAccount]);
        const reservationId = id.slice("cs_".length);
        return {
          id,
          status: "complete",
          payment_status: "paid",
          payment_intent: `pi_${reservationId}`,
          customer: "cus_stripe_ada",
          amount_total: 1000,
          currency: "eur",
          metadata: { reservationId, checkoutFlow: "storefront_checkout" },
          url: null,
          expires_at: 1_900_000_000,
          ...sessionAtStripe.get(id),
        };
      },
      create: unexpected("checkout.sessions.create"),
      expire: unexpected("checkout.sessions.expire"),
    },
  },
  paymentIntents: {
    retrieve: async (
      id: string,
      _params: unknown,
      options: { stripeAccount?: string } | undefined,
    ) => {
      calls.push(["stripe.paymentIntents.retrieve", id, options?.stripeAccount]);
      return {
        id,
        customer: "cus_stripe_ada",
        payment_method: "pm_card_ada",
        metadata: {},
        latest_charge: { id: `ch_${id}`, created: 1_800_000_000 },
      };
    },
  },
};

Reflect.set(globalThis, "__louezCheckoutReturnStubs", {
  stripe,
  getStripe: () => stripe,
  log: { error: record("log.error"), warn: record("log.warn"), info: record("log.info") },
  runReservationEffects: record("runReservationEffects"),
  notifyPaymentReceived: async () => {},
  notifyReservationConfirmed: async () => {},
  markReservationForCalendarSync: async () => {},
  tryPrepareInitialInvoiceEmailDelivery: async () => ({
    attachments: [],
    contractSignatureUrl: null,
  }),
  tryGenerateInvoiceForPayment: async () => ({ success: true }),
  dispatchCustomerNotification: async () => ({}),
  dispatchNotification: async () => ({}),
  captureProductServerEvent: async () => {},
  toAnalyticsAmountCents: () => null,
});

Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: { parentURL?: string },
    next: (specifier: string, context: unknown) => unknown,
  ) {
    if (specifier === "server-only" || specifier === "@/lib/storage/files") {
      return { url: "node:module", shortCircuit: true };
    }
    const parent = context.parentURL ? decodeURIComponent(context.parentURL) : "";
    for (const [module, replaced] of Object.entries(STUBBED)) {
      if (parent.endsWith(module) && replaced.has(specifier)) {
        return { url: pathToFileURL(stubsPath).href, shortCircuit: true };
      }
    }
    return next(specifier, context);
  },
});

/** A store that left PREVIOUS_ACCOUNT for TODAY_ACCOUNT. */
// The storefront's address, which the account's payment return lands on.
process.env.NEXT_PUBLIC_APP_URL = "https://app.louez.test";
process.env.NEXT_PUBLIC_APP_DOMAIN = "louez.test";

const STORE = "store_chk_return";
const UNCONNECTED_STORE = "store_chk_return_none";
const PREVIOUS_ACCOUNT = "acct_checkout_return_previous";
const TODAY_ACCOUNT = "acct_checkout_return_today";

describe(
  "the customer's return from Stripe (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let completion: typeof import("./complete-checkout-payment");
    let paymentReturn: typeof import("@/app/(storefront)/[slug]/account/reservations/[reservationId]/payment-return/route");
    let paymentStatus: typeof import("./util.payment-status");
    let counter = 0;

    before(async () => {
      database = await createTestDatabase("checkout_return");
      louezDb = await import("@louez/db");
      completion = await import("./complete-checkout-payment");
      paymentReturn =
        await import("@/app/(storefront)/[slug]/account/reservations/[reservationId]/payment-return/route");
      paymentStatus = await import("./util.payment-status");

      const settings = {
        reservationMode: "payment" as const,
        currency: "EUR",
        advanceNoticeMinutes: 0,
      };
      await louezDb.db.insert(louezDb.stores).values([
        {
          id: STORE,
          userId: "owner",
          name: "Return",
          slug: "checkout-return",
          email: "shop@return.test",
          stripeAccountId: TODAY_ACCOUNT,
          stripeChargesEnabled: true,
          // Online: the storefront's routes find it by its slug.
          onboardingCompleted: true,
          settings,
        },
        {
          id: UNCONNECTED_STORE,
          userId: "owner_none",
          name: "Return none",
          slug: "checkout-return-none",
          stripeAccountId: null,
          settings,
        },
      ]);
      await louezDb.db.insert(louezDb.customers).values({
        id: "cus_return",
        storeId: STORE,
        email: "ada@return.test",
        firstName: "Ada",
        lastName: "Customer",
      });
    });

    after(async () => {
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    beforeEach(() => {
      calls.length = 0;
      sessionAtStripe.clear();
    });

    const nextId = (prefix: string) =>
      `${prefix}_${String(++counter).padStart(20 - prefix.length, "0")}`;

    /** A storefront checkout's pending booking; its session's row records `stripeAccountId`. */
    async function checkout(stripeAccountId: string | null, storeId = STORE) {
      const id = nextId("res");
      await louezDb.db.insert(louezDb.reservations).values({
        id,
        storeId,
        customerId: "cus_return",
        number: id,
        status: "pending",
        startDate: new Date("2030-06-01T09:00:00Z"),
        endDate: new Date("2030-06-03T09:00:00Z"),
        subtotalAmount: "10.00",
        depositAmount: "0.00",
        totalAmount: "10.00",
        currency: "EUR",
        source: "online",
      });
      const sessionId = `cs_${id}`;
      await louezDb.db.insert(louezDb.payments).values({
        id: nextId("pay"),
        reservationId: id,
        amount: "10.00",
        type: "rental",
        method: "stripe",
        status: "pending",
        stripeCheckoutSessionId: sessionId,
        origin: "checkout",
        currency: "EUR",
        stripeAccountId,
      });
      return { id, sessionId, storeId };
    }

    const returnFrom = (booking: { id: string; sessionId: string; storeId: string }) =>
      completion.completeCheckoutPayment({
        source: "return",
        storeId: booking.storeId,
        reservationId: booking.id,
        stripeCheckoutSessionId: booking.sessionId,
      });

    async function stateOf(id: string) {
      const [reservation] = await louezDb.db
        .select({ status: louezDb.reservations.status })
        .from(louezDb.reservations)
        .where(eq(louezDb.reservations.id, id));
      const payments = await louezDb.db
        .select({
          status: louezDb.payments.status,
          stripeAccountId: louezDb.payments.stripeAccountId,
        })
        .from(louezDb.payments)
        .where(eq(louezDb.payments.reservationId, id));
      return { status: reservation?.status, payments };
    }

    const stripeReads = () => calls.filter(([name]) => name.startsWith("stripe."));

    test("a session its row records under the account the store left: read on that account before any other call, and recorded with it", async () => {
      const booking = await checkout(PREVIOUS_ACCOUNT);

      assert.deepEqual(await returnFrom(booking), {
        status: "completed",
        claimed: true,
        reservationConfirmed: true,
      });

      assert.deepEqual(calls[0], [
        "stripe.checkout.sessions.retrieve",
        booking.sessionId,
        PREVIOUS_ACCOUNT,
      ]);
      assert.deepEqual(stripeReads(), [
        ["stripe.checkout.sessions.retrieve", booking.sessionId, PREVIOUS_ACCOUNT],
        ["stripe.paymentIntents.retrieve", `pi_${booking.id}`, PREVIOUS_ACCOUNT],
      ]);
      assert.deepEqual(await stateOf(booking.id), {
        status: "confirmed",
        payments: [{ status: "completed", stripeAccountId: PREVIOUS_ACCOUNT }],
      });
    });

    test("a row that records no account: read on the store's connected account, and recorded with it", async () => {
      const booking = await checkout(null);

      assert.deepEqual(await returnFrom(booking), {
        status: "completed",
        claimed: true,
        reservationConfirmed: true,
      });

      assert.deepEqual(stripeReads(), [
        ["stripe.checkout.sessions.retrieve", booking.sessionId, TODAY_ACCOUNT],
        ["stripe.paymentIntents.retrieve", `pi_${booking.id}`, TODAY_ACCOUNT],
      ]);
      assert.deepEqual(await stateOf(booking.id), {
        status: "confirmed",
        payments: [{ status: "completed", stripeAccountId: TODAY_ACCOUNT }],
      });
    });

    test("a store with no connected account answers payment_unavailable, Stripe asked nothing", async () => {
      const booking = await checkout(PREVIOUS_ACCOUNT, UNCONNECTED_STORE);

      assert.deepEqual(await returnFrom(booking), { status: "payment_unavailable" });

      assert.deepEqual(stripeReads(), []);
      assert.deepEqual(await stateOf(booking.id), {
        status: "pending",
        payments: [{ status: "pending", stripeAccountId: PREVIOUS_ACCOUNT }],
      });
    });

    /**
     * A confirmed booking whose €9 deposit is paid, and whose €10 balance the
     * customer paid from their account: its session's row `pending`, the webhook
     * not delivered yet.
     */
    async function balancePaidAtStripe() {
      const id = nextId("res");
      await louezDb.db.insert(louezDb.reservations).values({
        id,
        storeId: STORE,
        customerId: "cus_return",
        number: id,
        status: "confirmed",
        startDate: new Date("2030-06-01T09:00:00Z"),
        endDate: new Date("2030-06-03T09:00:00Z"),
        subtotalAmount: "19.00",
        depositAmount: "0.00",
        totalAmount: "19.00",
        currency: "EUR",
        source: "online",
      });
      const sessionId = `cs_${id}`;
      await louezDb.db.insert(louezDb.payments).values([
        {
          id: nextId("pay"),
          reservationId: id,
          amount: "9.00",
          type: "rental",
          method: "stripe",
          status: "completed",
          stripePaymentIntentId: `pi_deposit_${id}`,
          currency: "EUR",
        },
        {
          id: nextId("pay"),
          reservationId: id,
          amount: "10.00",
          type: "rental",
          method: "stripe",
          status: "pending",
          stripeCheckoutSessionId: sessionId,
          origin: "customer_session",
          currency: "EUR",
          stripeAccountId: TODAY_ACCOUNT,
        },
      ]);
      return { id, sessionId };
    }

    const rowsOf = (id: string) =>
      louezDb.db
        .select({
          type: louezDb.payments.type,
          status: louezDb.payments.status,
          amount: louezDb.payments.amount,
          stripeCheckoutSessionId: louezDb.payments.stripeCheckoutSessionId,
        })
        .from(louezDb.payments)
        .where(eq(louezDb.payments.reservationId, id));

    test("the account's payment return verifies the session at Stripe, records it, and lands on the reservation with that session", async () => {
      const { NextRequest } = await import("next/server");
      const booking = await balancePaidAtStripe();
      const url = `https://checkout-return.example.test/account/reservations/${booking.id}/payment-return?session_id=${booking.sessionId}`;

      const response = await paymentReturn.GET(new NextRequest(url), {
        params: Promise.resolve({ slug: "checkout-return", reservationId: booking.id }),
      });

      assert.equal(response.status, 307);
      const location = new URL(String(response.headers.get("location")));
      assert.equal(location.pathname.endsWith(`/account/reservations/${booking.id}`), true);
      assert.equal(location.searchParams.get("event"), "paid");
      assert.equal(location.searchParams.get("session_id"), booking.sessionId);
      assert.deepEqual(stripeReads()[0], [
        "stripe.checkout.sessions.retrieve",
        booking.sessionId,
        TODAY_ACCOUNT,
      ]);
      // The banner reads that session's payment: received, not because of the deposit.
      const rows = await rowsOf(booking.id);
      assert.equal(paymentStatus.getReservationPaymentStatus(rows, booking.sessionId), "received");
    });

    test("before the return is verified, the balance's session reads as being verified, the deposit received notwithstanding", async () => {
      const booking = await balancePaidAtStripe();

      const rows = await rowsOf(booking.id);

      assert.equal(
        paymentStatus.getReservationPaymentStatus(rows, booking.sessionId),
        "processing",
      );
      assert.equal(paymentStatus.getReservationPaymentStatus(rows), "received");
    });

    /** The account's payment return, as Stripe sends the customer to it. */
    const paymentReturnOf = async (slug: string, reservationId: string, sessionId: string) => {
      const { NextRequest } = await import("next/server");
      const url = `https://checkout-return.example.test/account/reservations/${reservationId}/payment-return?session_id=${sessionId}`;
      const response = await paymentReturn.GET(new NextRequest(url), {
        params: Promise.resolve({ slug, reservationId }),
      });
      return new URL(String(response.headers.get("location")));
    };

    test("an unpaid, expired, foreign or other store's session records nothing and lands without the paid event", async () => {
      const cases: Array<[string, Record<string, unknown>]> = [
        ["unpaid", { status: "open", payment_status: "unpaid" }],
        ["expired", { status: "expired", payment_status: "unpaid" }],
        ["foreign", { metadata: { reservationId: "res_another_booking_01" } }],
        ["other store", { metadata: { reservationId: "", storeId: "store_someone_else" } }],
      ];
      for (const [name, atStripe] of cases) {
        const booking = await balancePaidAtStripe();
        const metadata = atStripe.metadata as Record<string, string> | undefined;
        sessionAtStripe.set(booking.sessionId, {
          ...atStripe,
          ...(metadata
            ? { metadata: { ...metadata, reservationId: metadata.reservationId || booking.id } }
            : {}),
        });

        const location = await paymentReturnOf("checkout-return", booking.id, booking.sessionId);

        assert.equal(location.pathname.endsWith(`/account/reservations/${booking.id}`), true, name);
        assert.equal(location.search, "", name);
        const rows = await rowsOf(booking.id);
        assert.equal(
          rows.find((row) => row.stripeCheckoutSessionId === booking.sessionId)?.status,
          "pending",
          `${name}: nothing recorded`,
        );
      }
    });

    test("a slug that names no store, such as evil.example%23, sends to the instance's root, never elsewhere", async () => {
      const booking = await balancePaidAtStripe();

      for (const slug of ["evil.example%23", "evil.example#", "unknown-store"]) {
        const location = await paymentReturnOf(slug, booking.id, booking.sessionId);
        assert.equal(location.href, "https://app.louez.test/", slug);
      }
      assert.deepEqual(stripeReads(), [], "nothing is read for an unknown store");
    });

    test("a return without a session lands on the store's own account page", async () => {
      const booking = await balancePaidAtStripe();
      const { NextRequest } = await import("next/server");
      const response = await paymentReturn.GET(
        new NextRequest(
          `https://checkout-return.example.test/account/reservations/${booking.id}/payment-return`,
        ),
        { params: Promise.resolve({ slug: "checkout-return", reservationId: booking.id }) },
      );

      const location = new URL(String(response.headers.get("location")));
      assert.equal(location.pathname.endsWith("/account"), true);
      assert.equal(location.hostname.endsWith("louez.test"), true);
    });
  },
);
