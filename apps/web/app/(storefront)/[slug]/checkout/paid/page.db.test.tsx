import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, describe, test } from "node:test";

import React, { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import messages from "@/messages/fr.json";

// The page a customer without a session lands on after paying a checkout. Its
// URL may be held by anyone (history, a shared screen, a referrer): it opens
// no session, shows nothing of the customer, and shows anything at all only
// for a reservation of this store and the Stripe session of one of its own
// payments. Any other pair answers the storefront's not-found, as an unknown
// reservation does. The page is rendered as the server renders it, on a
// database; only the translations, the client-side link, the cart reset and
// the refresh are replaced by stand-ins that render what they receive.

const directory = mkdtempSync(join(tmpdir(), "louez-checkout-paid-"));
after(() => rmSync(directory, { recursive: true }));

const STUBS_KEY = "__louezCheckoutPaidStubs";
const STUBBED: Record<string, string> = {
  "next-intl/server": "intl",
  "@/components/storefront/ui/storefront-link": "link",
  "@/components/storefront/account/reservation-cart-reset": "cartReset",
  "@/components/storefront/ui/storefront-page-refresh": "refresh",
};
for (const name of Object.values(STUBBED)) {
  writeFileSync(
    join(directory, `${name}.cjs`),
    `module.exports = globalThis.${STUBS_KEY}.${name};`,
  );
}

// tsx loads the shared UI package through CommonJS with the classic JSX runtime.
Object.assign(globalThis, { React });
Reflect.set(globalThis, STUBS_KEY, {
  intl: {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: "fr", messages, namespace: namespace as never }),
  },
  link: {
    StorefrontLink: ({ href, children, ...props }: { href: string; children?: ReactNode }) =>
      createElement("a", { ...props, href }, children),
  },
  cartReset: {
    ReservationCartReset: ({ event }: { event: string | null }) =>
      createElement("i", { "data-cart-reset": event ?? "none" }),
  },
  refresh: { StorefrontPageRefresh: () => createElement("i", { "data-refresh": "" }) },
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
    const stub = STUBBED[specifier];
    if (stub && parent.endsWith("/checkout/paid/page.tsx")) {
      return { url: pathToFileURL(join(directory, `${stub}.cjs`)).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

// The customer's data, none of which the page may show.
const CUSTOMER = {
  firstName: "Albertine",
  lastName: "Quilliec",
  email: "albertine.private@example.test",
  phone: "+33611223344",
  address: "17 rue des Mimosas",
  city: "Plouguerneau",
  postalCode: "29880",
};
const CUSTOMER_TRACES = Object.values(CUSTOMER);

const SLUG = "paid-shop";
const STORE = "store_paid";
const OTHER_SLUG = "paid-other";
const OTHER_STORE = "store_paid_other";
const SILENT_SLUG = "paid-silent";
const SILENT_STORE = "store_paid_silent";

const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";

describe(
  "the paid page of the storefront checkout (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let page: typeof import("./page");
    let counter = 0;
    const nextId = (prefix: string) => `${prefix}${++counter}`.padEnd(21, "x").slice(0, 21);

    const addStore = async (
      id: string,
      slug: string,
      name: string,
      customerNotificationSettings?: Record<string, unknown>,
    ) => {
      await louezDb.db.insert(louezDb.stores).values({
        id,
        userId: `owner_${id}`.slice(0, 21),
        name,
        slug,
        // The store's own contact details, which differ from the customer's.
        email: `contact@${slug}.example.test`,
        phone: "+33298000000",
        address: "1 quai du Port",
        stripeAccountId: `acct_${id}`,
        stripeChargesEnabled: true,
        onboardingCompleted: true,
        settings: { reservationMode: "payment", currency: "EUR", advanceNoticeMinutes: 0 },
        ...(customerNotificationSettings ? { customerNotificationSettings } : {}),
      } as typeof louezDb.stores.$inferInsert);
      await louezDb.db.insert(louezDb.customers).values({
        id: `cust_${id}`.slice(0, 21),
        storeId: id,
        ...CUSTOMER,
      });
    };

    /** A reservation of `storeId` with one payment of `status` on Stripe session `sessionId`. */
    const paidReservation = async (
      storeId: string,
      {
        reservationStatus = "confirmed",
        paymentStatus = "completed",
      }: {
        reservationStatus?: "pending" | "confirmed" | "cancelled";
        paymentStatus?: "pending" | "completed" | "failed";
      } = {},
    ) => {
      const id = nextId("res_");
      const sessionId = `cs_test_${id}`;
      const number = `N${counter}-2031`;
      await louezDb.db.insert(louezDb.reservations).values({
        id,
        storeId,
        customerId: `cust_${storeId}`.slice(0, 21),
        number,
        status: reservationStatus,
        startDate: new Date("2031-06-10T09:00:00Z"),
        endDate: new Date("2031-06-12T09:00:00Z"),
        subtotalAmount: "120.00",
        depositAmount: "0.00",
        totalAmount: "120.00",
        currency: "EUR",
      });
      await louezDb.db.insert(louezDb.payments).values({
        id: nextId("pay_"),
        reservationId: id,
        amount: "120.00",
        currency: "EUR",
        type: "rental",
        method: "stripe",
        status: paymentStatus,
        stripeCheckoutSessionId: sessionId,
        origin: "checkout",
      });
      return { id, sessionId, number };
    };

    const render = async (
      slug: string,
      query: { reservation?: string; session_id?: string },
    ): Promise<string> => {
      const element = await page.default({
        params: Promise.resolve({ slug }),
        searchParams: Promise.resolve(query),
      });
      return renderToStaticMarkup(element);
    };

    const assertNotFound = async (
      slug: string,
      query: { reservation?: string; session_id?: string },
    ) =>
      assert.rejects(render(slug, query), (error: unknown) => {
        assert.equal((error as { digest?: string }).digest, NOT_FOUND);
        return true;
      });

    const assertNoCustomerData = (html: string) => {
      for (const trace of CUSTOMER_TRACES) {
        assert.ok(!html.includes(trace), `the page shows the customer's ${trace}`);
      }
      assert.doesNotMatch(html, /@/, "the page shows an e-mail address");
      assert.doesNotMatch(html, /contract|invoice|\/documents\//i, "the page links a document");
    };

    let paid: Awaited<ReturnType<typeof paidReservation>>;
    let other: Awaited<ReturnType<typeof paidReservation>>;
    let foreign: Awaited<ReturnType<typeof paidReservation>>;

    before(async () => {
      database = await createTestDatabase("checkout_paid_page");
      louezDb = await import("@louez/db");
      page = await import("./page");
      await addStore(STORE, SLUG, "Kayaks de la Baie");
      await addStore(OTHER_STORE, OTHER_SLUG, "Vélos du Port");
      await addStore(SILENT_STORE, SILENT_SLUG, "Paddles Discrets", {
        customer_reservation_confirmed: { enabled: false, email: false, sms: false },
      });
      paid = await paidReservation(STORE);
      other = await paidReservation(STORE);
      foreign = await paidReservation(OTHER_STORE);
    });

    after(async () => {
      Reflect.deleteProperty(globalThis, STUBS_KEY);
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    test("the right pair says the payment was received, and nothing of the customer", async () => {
      const html = await render(SLUG, { reservation: paid.id, session_id: paid.sessionId });

      assert.match(html, /Paiement reçu/);
      assert.ok(html.includes(paid.number), "the reservation's number");
      assert.ok(html.includes("Kayaks de la Baie"), "the store's name");
      assert.match(html, /Une confirmation vous a été envoyée par e-mail\./);
      assertNoCustomerData(html);
    });

    test("its one button signs in by e-mail code and comes back to the reservation", async () => {
      const html = await render(SLUG, { reservation: paid.id, session_id: paid.sessionId });
      const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
      const reservationPath = `/account/reservations/${paid.id}?event=paid`;

      assert.deepEqual(hrefs, [
        `/account/login?redirect=${encodeURIComponent(reservationPath).replace(/%20/g, "+")}`,
      ]);
      assert.match(html, /Voir ma réservation/);
    });

    test("the page empties the cart", async () => {
      const html = await render(SLUG, { reservation: paid.id, session_id: paid.sessionId });
      assert.match(html, /data-cart-reset="paid"/);
    });

    test("a pair whose payment is not recorded yet says it is being confirmed, never received", async () => {
      const confirming = await paidReservation(STORE, {
        reservationStatus: "pending",
        paymentStatus: "pending",
      });
      const html = await render(SLUG, {
        reservation: confirming.id,
        session_id: confirming.sessionId,
      });

      assert.doesNotMatch(html, /reçu/);
      assert.match(html, /en cours de confirmation/);
      assert.match(html, /Vous recevrez une confirmation par e-mail\./);
      assert.ok(html.includes(confirming.number));
      assert.match(html, /data-cart-reset="paid"/);
      assert.match(html, /data-refresh/);
      assertNoCustomerData(html);
    });

    test("a paid reservation the store could not confirm promises no e-mail", async () => {
      const unconfirmed = await paidReservation(STORE, { reservationStatus: "pending" });
      const html = await render(SLUG, {
        reservation: unconfirmed.id,
        session_id: unconfirmed.sessionId,
      });

      assert.match(html, /Paiement reçu/);
      assert.doesNotMatch(html, /e-mail/);
    });

    test("a store that sends no confirmation e-mail is never said to send one", async () => {
      const silent = await paidReservation(SILENT_STORE);
      const confirming = await paidReservation(SILENT_STORE, {
        reservationStatus: "pending",
        paymentStatus: "pending",
      });

      const received = await render(SILENT_SLUG, {
        reservation: silent.id,
        session_id: silent.sessionId,
      });
      const pending = await render(SILENT_SLUG, {
        reservation: confirming.id,
        session_id: confirming.sessionId,
      });

      assert.match(received, /Paiement reçu/);
      assert.doesNotMatch(received, /e-mail/);
      assert.match(pending, /en cours de confirmation/);
      assert.doesNotMatch(pending, /e-mail/);
    });

    test("a wrong session id answers not-found", async () => {
      await assertNotFound(SLUG, { reservation: paid.id, session_id: "cs_test_guessed" });
    });

    test("another reservation's session id answers not-found", async () => {
      await assertNotFound(SLUG, { reservation: paid.id, session_id: other.sessionId });
    });

    test("an unknown reservation answers not-found", async () => {
      await assertNotFound(SLUG, { reservation: "res_unknown", session_id: paid.sessionId });
    });

    test("a reservation of another store answers not-found on this one", async () => {
      await assertNotFound(SLUG, { reservation: foreign.id, session_id: foreign.sessionId });
    });

    test("a payment that failed answers not-found", async () => {
      const failed = await paidReservation(STORE, {
        reservationStatus: "pending",
        paymentStatus: "failed",
      });
      await assertNotFound(SLUG, { reservation: failed.id, session_id: failed.sessionId });
    });

    test("a reservation id alone, or no query, answers not-found", async () => {
      await assertNotFound(SLUG, { reservation: paid.id });
      await assertNotFound(SLUG, { session_id: paid.sessionId });
      await assertNotFound(SLUG, {});
    });

    test("an unknown store answers not-found", async () => {
      await assertNotFound("no-such-shop", { reservation: paid.id, session_id: paid.sessionId });
    });
  },
);
