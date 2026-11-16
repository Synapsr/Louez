import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import {
  createTestDatabase,
  readLockWaiters,
  skipWithoutTestDatabase,
  type LockWaiter,
  type TestDatabase,
  waitForLockWaits,
} from "@louez/db/testing";

import { closeNetworkForSuite } from "@/lib/testing/network-guard";

// The marketplace's checkout through its adapter and the customer's payment
// session, on a migrated database, against the marketplace's failure of the
// same booking. The checkout holds the booking's attempt while its adapter
// creates the payment session on another connection; the failure takes the
// reservation's lock, then the attempt. The payment session is told its caller
// holds the attempt, and never asks for the reservation's lock meanwhile: the
// database cannot see a wait that goes through the application, and would
// break such a cycle only by the lock timeout. Stripe is a fake: no network.

process.env.SKIP_ENV_VALIDATION = "true";
process.env.STRIPE_SECRET_KEY = "sk_test_stub";
process.env.MARKETPLACE_CATALOG_SECRET = "marketplace-secret";
delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
// The store is billed by nobody here: no fee is planned, and none is asked of a service.
delete process.env.LOUEZ_BILLING;
delete process.env.BILLING_SERVICE_URL;

const FILES_SDK = new URL("../node_modules/files-sdk/dist/", import.meta.url);
const registerHooks = Reflect.get(nodeModule, "registerHooks");
if (typeof registerHooks !== "function") {
  throw new Error("This test requires node:module registerHooks");
}
registerHooks({
  resolve(
    specifier: string,
    context: unknown,
    next: (specifier: string, context: unknown) => unknown,
  ) {
    // The adapter's modules import Next.js-only guards and the file storage SDK.
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

const STORE = "store_mkt_checkout";
const ACCOUNT = "acct_mkt_checkout";
const CUSTOMER = "cus_mkt_checkout";

describe(
  "the marketplace's checkout and its failure (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    // No test of this suite reaches a provider: Stripe is a fake.
    closeNetworkForSuite();
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let services: typeof import("@louez/api/services");
    let adapters: typeof import("./marketplace-booking");

    before(async () => {
      database = await createTestDatabase("marketplace_checkout");
      // DATABASE_URL now points at the test database.
      louezDb = await import("@louez/db");
      adapters = await import("./marketplace-booking");
      // packages/api is ES modules: its services need the CommonJS packages'
      // names by hand. Loaded last, as the mocks change how later modules load.
      await import("@louez/mcp/testing/cjs-named-exports");
      services = await import("@louez/api/services");
      const { getStripe } = await import("@/lib/stripe/client");
      const sessions = getStripe().checkout.sessions;
      Reflect.set(sessions, "create", async () => ({
        id: "cs_mkt_new",
        url: "https://checkout.stripe.test/cs_mkt_new",
        expires_at: 1_900_000_000,
      }));
      Reflect.set(sessions, "expire", async (id: string) => ({ id, status: "expired" }));

      await louezDb.db.insert(louezDb.stores).values({
        id: STORE,
        userId: "owner_mkt_checkout",
        name: "Marketplace checkout",
        slug: "mkt-checkout",
        settings: { reservationMode: "payment", advanceNoticeMinutes: 0, currency: "EUR" },
        stripeAccountId: ACCOUNT,
        stripeChargesEnabled: true,
      });
      await louezDb.db.insert(louezDb.customers).values({
        id: CUSTOMER,
        storeId: STORE,
        email: "renter@marketplace.test",
        firstName: "Renter",
        lastName: "Marketplace",
      });
    });

    after(async () => {
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    /**
     * A marketplace booking whose first checkout session expired unpaid: its
     * payment cancelled by the expiry, its attempt still `checkout_pending`.
     */
    async function bookingWithExpiredSession() {
      const id = "res_mkt_checkout_0001";
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
        source: "marketplace",
      });
      await louezDb.db.insert(louezDb.marketplaceBookingAttempts).values({
        id: "att_mkt_checkout_0001",
        bookingAttemptId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        storeId: STORE,
        quoteTokenHash: "0".repeat(64),
        holdId: id,
        reservationId: id,
        status: "checkout_pending",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
      await louezDb.db.insert(louezDb.payments).values({
        id: "pay_mkt_expired_0001",
        reservationId: id,
        amount: "10.00",
        type: "rental",
        method: "stripe",
        status: "cancelled",
        stripeCheckoutSessionId: "cs_mkt_expired",
        stripeAccountId: ACCOUNT,
        origin: "customer_session",
        currency: "EUR",
      });
      return { id, bookingAttemptId: "7c9e6679-7425-40de-944b-e07fc1f90ae7" };
    }

    test("the checkout's payment session, while the checkout holds the attempt, never waits for the reservation the failure holds", async () => {
      const { id, bookingAttemptId } = await bookingWithExpiredSession();
      const observer = await database.connect();
      /** Every transaction seen waiting while the payment session ran. */
      const seen: LockWaiter[] = [];
      let failure: Promise<unknown> | undefined;
      let checkout: unknown;

      try {
        checkout = await services
          .checkoutMarketplaceBooking({
            input: {
              holdId: id,
              bookingAttemptId,
              successUrl: "https://marketplace.test/success",
              cancelUrl: "https://marketplace.test/cancel",
            },
            adapter: {
              ...adapters.marketplaceCheckoutAdapter,
              createCheckout: async (input) => {
                // The checkout holds the attempt. The failure of the booking's first
                // session takes the reservation's lock, then waits for the attempt.
                failure = services
                  .failMarketplaceBookingAttempt(id, async () => {})
                  .then(
                    () => "finished",
                    (error: unknown) => error,
                  );
                await waitForLockWaits(observer, database.name, 1);
                // The payment session runs while both are held; its waits are read until it ends.
                let ended = false;
                const session = adapters.marketplaceCheckoutAdapter
                  .createCheckout(input)
                  .finally(() => {
                    ended = true;
                  });
                while (!ended) {
                  seen.push(...(await readLockWaiters(observer, database.name)));
                  await new Promise((resolve) => setTimeout(resolve, 10));
                }
                return session;
              },
            },
          })
          .catch((error: unknown) => error);
        await failure;
      } finally {
        await observer.end();
      }

      // While the payment session ran, the failure waited for the attempt the
      // checkout holds, and nothing waited for the reservation the failure holds.
      const waitedForReservation = seen.filter((waiter) =>
        waiter.waitsFor.some((row) => row.table === "reservations" && row.id === id),
      );
      assert.deepEqual(waitedForReservation, [], "no transaction waited for the reservation");
      assert.ok(
        seen.some((waiter) =>
          waiter.waitsFor.some((row) => row.table === "marketplace_booking_attempts"),
        ),
        "the failure was seen waiting for the attempt",
      );
      assert.ok(
        seen.every((waiter) =>
          waiter.waitsFor.every((row) => row.table === "marketplace_booking_attempts"),
        ),
        JSON.stringify(seen),
      );

      // Both end: the checkout with its new session, the failure once it commits.
      assert.deepEqual(checkout, {
        checkoutUrl: "https://checkout.stripe.test/cs_mkt_new",
        reservationId: id,
      });
      assert.equal(await failure, "finished");

      // The new session's payment is the booking's open one.
      const rows = await louezDb.db
        .select({
          status: louezDb.payments.status,
          session: louezDb.payments.stripeCheckoutSessionId,
        })
        .from(louezDb.payments)
        .where(eq(louezDb.payments.reservationId, id));
      assert.deepEqual(
        rows.sort((a, b) => String(a.session).localeCompare(String(b.session))),
        [
          { status: "cancelled", session: "cs_mkt_expired" },
          { status: "pending", session: "cs_mkt_new" },
        ],
      );
      // The failure read the payments once it held the attempt: the new session may
      // still be paid, so the booking and its attempt are kept.
      const [booking] = await louezDb.db
        .select({ status: louezDb.reservations.status })
        .from(louezDb.reservations)
        .where(eq(louezDb.reservations.id, id));
      assert.equal(booking?.status, "pending");
      const [attempt] = await louezDb.db
        .select({ status: louezDb.marketplaceBookingAttempts.status })
        .from(louezDb.marketplaceBookingAttempts)
        .where(eq(louezDb.marketplaceBookingAttempts.reservationId, id));
      assert.equal(attempt?.status, "checkout_pending");
    });
  },
);
