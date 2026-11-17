import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { stripTypeScriptTypes } from "node:module";
import { z } from "zod";

// Stripe's return of the storefront checkout. Paying does not prove the payer
// owns the checkout e-mail: only a customer already signed in as the
// reservation's customer lands on the reservation; anyone else lands on the
// paid page, which opens no session. That page's URL carries nothing: the
// return hands it the pair in its own short-lived cookie, and only when the
// completion answered `completed` or threw. A payment Stripe did not take goes
// back to the resumable cancelled page; anything else to the home, cookieless.

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const compiled = stripTypeScriptTypes(
  source.slice(source.indexOf("const returnQuerySchema")).replace("export const GET", "const GET"),
);

const PAID_PAGE = "https://shop.example.test/checkout/paid";
const PAID_CLAIM = {
  storeId: "store",
  reservationId: "booking",
  stripeCheckoutSessionId: "cs_paid",
};
const RESERVATION_PAGE = "https://shop.example.test/account/reservations/booking?event=paid";

/** The one cookie the return may set: the paid page's claim, for this store, reservation and session. */
const assertPaidClaim = (result) => {
  assert.deepEqual(result.cookies, [
    {
      name: "louez_checkout_paid",
      value: JSON.stringify({ slug: "shop", ...PAID_CLAIM }),
      options: { path: "/checkout/paid" },
    },
  ]);
};

const runReturn = async (
  status,
  {
    search = "?reservation=booking&session_id=cs_paid",
    signedIn = false,
    store = { id: "store", slug: "shop" },
  } = {},
) => {
  const calls = { completions: 0, sessionChecks: [], cookies: [] };
  const dependencies = {
    "next/server": {
      NextResponse: {
        redirect: (url) => ({
          url,
          cookies: { set: (name, value, options) => calls.cookies.push({ name, value, options }) },
        }),
      },
    },
    "@/lib/reservations/checkout-paid-cookie": {
      checkoutPaidUrl: (slug) => `https://${slug}.example.test/checkout/paid`,
      buildCheckoutPaidCookie: (slug, claim) => ({
        name: "louez_checkout_paid",
        value: JSON.stringify({ slug, ...claim }),
        options: { path: "/checkout/paid" },
      }),
    },
    zod: { z },
    "@/lib/evlog": { log: { error() {} } },
    "@/lib/customer-auth/reservation-session": {
      hasReservationCustomerSession: async (storeId, reservationId) => {
        calls.sessionChecks.push([storeId, reservationId]);
        if (signedIn === "throws") throw new Error("database unavailable");
        return signedIn;
      },
    },
    "@/lib/reservations/complete-checkout-payment": {
      completeCheckoutPayment: async (input) => {
        calls.completions++;
        assert.equal(input.source, "return");
        assert.equal(input.storeId, "store");
        assert.equal(input.reservationId, "booking");
        assert.equal(input.stripeCheckoutSessionId, "cs_paid");
        if (status === "throws") throw new Error("Stripe unavailable");
        return { status };
      },
    },
    "@/lib/storefront/get-store-by-slug": { getStoreBySlug: async () => store },
    "@/lib/storefront-url": {
      getStorefrontUrl: (slug, path) => `https://${slug}.example.test${path}`,
    },
  };
  const GET = runInNewContext(`${compiled}; GET`, {
    ...Object.assign({}, ...Object.values(dependencies)),
  });
  const response = await GET(
    { nextUrl: new URL(`https://shop.example.test/checkout/return${search}`) },
    { params: Promise.resolve({ slug: "shop" }) },
  );
  return { url: response.url, ...calls };
};

test("a completed payment of the signed-in reservation customer lands on the reservation", async () => {
  const result = await runReturn("completed", { signedIn: true });
  assert.equal(result.url, RESERVATION_PAGE);
  assert.deepEqual(result.sessionChecks, [["store", "booking"]]);
  assert.deepEqual(result.cookies, []);
});

test("a completed payment without that customer's session lands on the paid page, which carries nothing", async () => {
  const result = await runReturn("completed", { signedIn: false });
  assert.equal(result.url, PAID_PAGE);
  assertPaidClaim(result);
});

test("a session check that fails lands on the paid page, never on the account", async () => {
  const result = await runReturn("completed", { signedIn: "throws" });
  assert.equal(result.url, PAID_PAGE);
  assertPaidClaim(result);
});

for (const signedIn of [true, false]) {
  test(`an unpaid checkout goes to the resumable cancellation (signed in: ${signedIn})`, async () => {
    const result = await runReturn("not_paid", { signedIn });
    assert.equal(result.url, "https://shop.example.test/checkout/cancelled?reservation=booking");
    assert.deepEqual(result.sessionChecks, []);
    assert.deepEqual(result.cookies, []);
  });
}

for (const status of ["payment_unavailable", "not_found"]) {
  test(`${status} lands on the storefront home and checks no session`, async () => {
    const result = await runReturn(status, { signedIn: true });
    assert.equal(result.url, "https://shop.example.test/");
    assert.deepEqual(result.sessionChecks, []);
    assert.deepEqual(result.cookies, []);
  });
}

test("a completion that throws lands the signed-in customer on the reservation's payment check", async () => {
  const result = await runReturn("throws", { signedIn: true });
  assert.equal(result.url, RESERVATION_PAGE);
  assert.deepEqual(result.cookies, []);
});

test("a completion that throws lands anyone else on the paid page, with the pair in its cookie", async () => {
  const result = await runReturn("throws", { signedIn: false });
  assert.equal(result.url, PAID_PAGE);
  assertPaidClaim(result);
});

for (const search of ["?reservation=booking", "?session_id=cs_paid", ""]) {
  test(`an incomplete query (${search || "none"}) never calls completion`, async () => {
    const result = await runReturn("completed", { search, signedIn: true });
    assert.equal(result.url, "https://shop.example.test/");
    assert.equal(result.completions, 0);
    assert.deepEqual(result.sessionChecks, []);
    assert.deepEqual(result.cookies, []);
  });
}

test("an unknown store never calls completion", async () => {
  const result = await runReturn("completed", { store: null, signedIn: true });
  assert.equal(result.url, "https://shop.example.test/");
  assert.equal(result.completions, 0);
  assert.deepEqual(result.sessionChecks, []);
  assert.deepEqual(result.cookies, []);
});
