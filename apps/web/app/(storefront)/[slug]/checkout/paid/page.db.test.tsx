import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, afterEach, before, beforeEach, describe, mock, test } from "node:test";

import React, { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import {
  CHECKOUT_PAID_COOKIE,
  CHECKOUT_PAID_TTL_MS,
  type CheckoutPaidClaim,
  sealCheckoutPaidClaim,
} from "@/lib/reservations/util.checkout-paid-claim";
import messages from "@/messages/fr.json";

// The page a customer without a session lands on after paying a checkout. Its
// URL carries nothing: the checkout's return hands it the store, the
// reservation and the Stripe session in a sealed, short-lived cookie, and the
// page checks that pair again against the reservation's payments. Without that
// cookie (missing, expired, forged, another store's), or for a pair that is
// not one of the reservation's payments in this store, it is the storefront's
// not-found, as an unknown reservation is. It says « reçu » only once the
// payment is recorded and asserts nothing about a payment otherwise; it says a
// confirmation e-mail went out only when the e-mail's `sent` log row exists.
// It opens no session and shows nothing of the customer.
//
// The page runs as the server runs it, on a database, at a fixed time. Its
// translations, the client-side link, the cart reset and the refresh are
// stand-ins that render what they receive; the privacy cases walk every prop
// the page hands any element, those stand-ins included, and its metadata.
// They do not cover the storefront layout's own payload, which every
// storefront page carries.

process.env.AUTH_SECRET = "a-secret-of-enough-length-for-the-paid-page-1234";
const SECRET = process.env.AUTH_SECRET;
const NOW = new Date("2031-06-01T09:00:00.000Z");

const directory = mkdtempSync(join(tmpdir(), "louez-checkout-paid-"));
after(() => rmSync(directory, { recursive: true }));

const STUBS_KEY = "__louezCheckoutPaidStubs";
const PAGE_STUBS: Record<string, string> = {
  "next-intl/server": "intl",
  "@/components/storefront/ui/storefront-link": "link",
  "@/components/storefront/account/reservation-cart-reset": "cartReset",
  "@/components/storefront/ui/storefront-page-refresh": "refresh",
};
for (const name of [...Object.values(PAGE_STUBS), "headers"]) {
  writeFileSync(
    join(directory, `${name}.cjs`),
    `module.exports = globalThis.${STUBS_KEY}.${name};`,
  );
}

/** The browser's cookies, as `next/headers` reads them. */
const jar = new Map<string, string>();

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
    ReservationCartReset: ({
      reservationId,
      settled,
    }: {
      reservationId: string;
      settled: boolean;
    }) => createElement("i", { "data-cart-reset": reservationId, "data-settled": String(settled) }),
  },
  refresh: { StorefrontPageRefresh: () => createElement("i", { "data-refresh": "" }) },
  headers: {
    cookies: async () => ({
      get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    }),
  },
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
    const stub =
      specifier === "next/headers"
        ? parent.endsWith("/lib/reservations/checkout-paid-cookie.ts")
          ? "headers"
          : undefined
        : parent.endsWith("/checkout/paid/page.tsx")
          ? PAGE_STUBS[specifier]
          : undefined;
    if (stub) {
      return { url: pathToFileURL(join(directory, `${stub}.cjs`)).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

// The customer's data, none of which the page may show or hand anything.
const CUSTOMER = {
  firstName: "Albertine",
  lastName: "Quilliec",
  email: "albertine.private@example.test",
  phone: "+33611223344",
  address: "17 rue des Mimosas",
  city: "Plouguerneau",
  postalCode: "29880",
};

const SLUG = "paid-shop";
const STORE = "store_paid";
const OTHER_SLUG = "paid-other";
const OTHER_STORE = "store_paid_other";

const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";

const customerIdOf = (storeId: string) => `cust_${storeId}`.slice(0, 21);

/** Every string and number the page hands an element, at any depth, stand-ins included. */
const collectProps = (node: unknown, found: string[] = []): string[] => {
  if (typeof node === "string" || typeof node === "number") {
    found.push(String(node));
  } else if (Array.isArray(node)) {
    for (const child of node) collectProps(child, found);
  } else if (isValidElement(node)) {
    if (node.key !== null) found.push(String(node.key));
    collectProps(node.props, found);
  } else if (typeof node === "object" && node !== null) {
    for (const value of Object.values(node)) collectProps(value, found);
  }
  return found;
};

describe(
  "the paid page of the storefront checkout (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let page: typeof import("./page");
    let counter = 0;
    const nextId = (prefix: string) => `${prefix}${++counter}`.padEnd(21, "x").slice(0, 21);

    const addStore = async (id: string, slug: string, name: string) => {
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
      });
      await louezDb.db
        .insert(louezDb.customers)
        .values({ id: customerIdOf(id), storeId: id, ...CUSTOMER });
    };

    /** A reservation of `storeId` with one payment of `paymentStatus` on its own Stripe session. */
    const reservationWithPayment = async (
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
        customerId: customerIdOf(storeId),
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
      const claim: CheckoutPaidClaim = {
        storeId,
        reservationId: id,
        stripeCheckoutSessionId: sessionId,
      };
      return { id, sessionId, number, claim };
    };

    const logConfirmationEmail = async (
      storeId: string,
      reservationId: string,
      status: "sent" | "failed",
    ) => {
      await louezDb.db.insert(louezDb.emailLogs).values({
        id: nextId("mail_"),
        storeId,
        reservationId,
        customerId: customerIdOf(storeId),
        to: CUSTOMER.email,
        subject: "Réservation confirmée",
        templateType: "reservation_confirmation",
        status,
      });
    };

    /** The browser holds the return's cookie for `claim`, sealed at `sealedAt`. */
    const holdClaim = (claim: CheckoutPaidClaim, sealedAt = NOW) => {
      jar.set(
        CHECKOUT_PAID_COOKIE,
        sealCheckoutPaidClaim(claim, { secret: SECRET, now: sealedAt }),
      );
    };

    const pageElement = (slug = SLUG) => page.default({ params: Promise.resolve({ slug }) });

    const render = async (slug = SLUG): Promise<string> =>
      renderToStaticMarkup(await pageElement(slug));

    const assertNotFound = async (slug = SLUG) =>
      assert.rejects(render(slug), (error: unknown) => {
        assert.equal((error as { digest?: string }).digest, NOT_FOUND);
        return true;
      });

    /** Neither the page's tree, its HTML nor its metadata hold any of these. */
    const assertHoldsNone = async (html: string, forbidden: string[], element: unknown) => {
      const props = collectProps(element);
      const metadata = JSON.stringify(
        await page.generateMetadata({ params: Promise.resolve({ slug: SLUG }) }),
      );
      for (const value of forbidden) {
        assert.ok(!html.includes(value), `the page shows ${value}`);
        assert.ok(
          !props.some((prop) => prop.includes(value)),
          `the page hands an element ${value}`,
        );
        assert.ok(!metadata.includes(value), `the page's metadata holds ${value}`);
      }
      assert.doesNotMatch(html, /@/, "the page shows an e-mail address");
      assert.doesNotMatch(html, /contract|invoice|\/documents\//i, "the page links a document");
    };

    const privateValues = (storeId: string, sessionId: string) => [
      ...Object.values(CUSTOMER),
      customerIdOf(storeId),
      sessionId,
    ];

    before(async () => {
      database = await createTestDatabase("checkout_paid_page");
      louezDb = await import("@louez/db");
      page = await import("./page");
      await addStore(STORE, SLUG, "Kayaks de la Baie");
      await addStore(OTHER_STORE, OTHER_SLUG, "Vélos du Port");
    });

    beforeEach(() => {
      jar.clear();
      mock.timers.enable({ apis: ["Date"], now: NOW });
    });

    afterEach(() => mock.timers.reset());

    after(async () => {
      Reflect.deleteProperty(globalThis, STUBS_KEY);
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    test("with the return's cookie, a recorded payment reads received, and nothing of the customer", async () => {
      const paid = await reservationWithPayment(STORE);
      holdClaim(paid.claim);
      const element = await pageElement();
      const html = renderToStaticMarkup(element);

      assert.match(html, /Paiement reçu/);
      assert.ok(html.includes(paid.number), "the reservation's number");
      assert.ok(html.includes("Kayaks de la Baie"), "the store's name");
      await assertHoldsNone(html, privateValues(STORE, paid.sessionId), element);
    });

    test("without a sent log row, the page says nothing of an e-mail", async () => {
      const paid = await reservationWithPayment(STORE);
      await logConfirmationEmail(STORE, paid.id, "failed");
      holdClaim(paid.claim);

      const html = await render();
      assert.match(html, /Paiement reçu/);
      assert.doesNotMatch(html, /e-mail/);
    });

    test("with the confirmation's sent log row, the page says it was sent", async () => {
      const paid = await reservationWithPayment(STORE);
      await logConfirmationEmail(STORE, paid.id, "sent");
      holdClaim(paid.claim);

      assert.match(await render(), /Une confirmation vous a été envoyée par e-mail\./);
    });

    test("its one button asks the e-mail code of this reservation's own customer", async () => {
      const paid = await reservationWithPayment(STORE);
      holdClaim(paid.claim);
      const html = await render();
      const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
      const redirect = encodeURIComponent(`/account/reservations/${paid.id}?event=paid`);

      assert.deepEqual(hrefs, [`/account/login?redirect=${redirect}&amp;owner=1`]);
      assert.match(html, /Voir ma réservation/);
    });

    test("a recorded payment lets the cart reset run for this reservation", async () => {
      const paid = await reservationWithPayment(STORE);
      holdClaim(paid.claim);
      const html = await render();

      assert.ok(html.includes(`data-cart-reset="${paid.id}"`));
      assert.match(html, /data-settled="true"/);
    });

    for (const [label, state] of [
      ["a payment not recorded", { reservationStatus: "pending", paymentStatus: "pending" }],
      [
        "a cancelled reservation whose payment is still pending",
        { reservationStatus: "cancelled", paymentStatus: "pending" },
      ],
      ["a failed payment", { reservationStatus: "pending", paymentStatus: "failed" }],
    ] as const) {
      test(`${label} asserts nothing about a payment having been made`, async () => {
        const unverified = await reservationWithPayment(STORE, state);
        holdClaim(unverified.claim);
        const element = await pageElement();
        const html = renderToStaticMarkup(element);

        assert.match(html, /Paiement pas encore vérifié/);
        assert.match(html, /S&#x27;il a bien été effectué/);
        assert.doesNotMatch(html, /reçu|en cours de confirmation|e-mail/);
        assert.ok(html.includes(unverified.number));
        assert.match(html, /data-settled="false"/, "the cart stays until the payment is recorded");
        assert.match(html, /data-refresh/);
        await assertHoldsNone(html, privateValues(STORE, unverified.sessionId), element);
      });
    }

    test("without the cookie, the page is the not-found", async () => {
      await reservationWithPayment(STORE);
      await assertNotFound();
    });

    test("a cookie past its lifetime is the not-found", async () => {
      const paid = await reservationWithPayment(STORE);
      holdClaim(paid.claim, new Date(NOW.getTime() - CHECKOUT_PAID_TTL_MS));
      await assertNotFound();
    });

    test("a cookie written or edited in the browser is the not-found", async () => {
      const paid = await reservationWithPayment(STORE);
      const sealed = sealCheckoutPaidClaim(paid.claim, { secret: SECRET, now: NOW });
      const [, signature] = sealed.split(".");
      const forged = Buffer.from(
        JSON.stringify({ s: STORE, r: paid.id, c: paid.sessionId, x: NOW.getTime() + 60_000 }),
      ).toString("base64url");

      jar.set(CHECKOUT_PAID_COOKIE, `${forged}.${signature}`);
      await assertNotFound();
      jar.set(
        CHECKOUT_PAID_COOKIE,
        sealCheckoutPaidClaim(paid.claim, {
          secret: "another-secret-of-enough-length-12345",
          now: NOW,
        }),
      );
      await assertNotFound();
    });

    test("another store's cookie is the not-found on this store", async () => {
      const foreign = await reservationWithPayment(OTHER_STORE);
      holdClaim(foreign.claim);
      await assertNotFound(SLUG);
    });

    test("a cookie naming this store for another store's reservation is the not-found", async () => {
      const foreign = await reservationWithPayment(OTHER_STORE);
      holdClaim({ ...foreign.claim, storeId: STORE });
      await assertNotFound(SLUG);
    });

    test("a cookie with a wrong or another reservation's session id is the not-found", async () => {
      const paid = await reservationWithPayment(STORE);
      const other = await reservationWithPayment(STORE);

      holdClaim({ ...paid.claim, stripeCheckoutSessionId: "cs_test_guessed" });
      await assertNotFound();
      holdClaim({ ...paid.claim, stripeCheckoutSessionId: other.sessionId });
      await assertNotFound();
    });

    test("a cookie for an unknown reservation is the not-found", async () => {
      holdClaim({
        storeId: STORE,
        reservationId: "res_unknown",
        stripeCheckoutSessionId: "cs_test_x",
      });
      await assertNotFound();
    });

    test("an unknown store is the not-found", async () => {
      const paid = await reservationWithPayment(STORE);
      holdClaim(paid.claim);
      await assertNotFound("no-such-shop");
    });
  },
);
