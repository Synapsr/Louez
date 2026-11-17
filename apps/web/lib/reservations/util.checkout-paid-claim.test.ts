import assert from "node:assert/strict";
import { test } from "node:test";

import { buildStorefrontUrl } from "@/lib/util.storefront-url";

import {
  CHECKOUT_PAID_TTL_MS,
  checkoutPaidCookieOptions,
  openCheckoutPaidClaim,
  sealCheckoutPaidClaim,
} from "./util.checkout-paid-claim";

// What the checkout's return hands the paid page: the store, the reservation
// and the Stripe session, in a cookie only the server can write. Every time
// here is passed in, never read from the clock.

const SECRET = "a-secret-of-enough-length-for-the-test-123456";
const SEALED_AT = new Date("2031-06-10T09:00:00.000Z");
const claim = {
  storeId: "store_paid",
  reservationId: "res_paid",
  stripeCheckoutSessionId: "cs_test_paid",
};
const later = (ms: number) => new Date(SEALED_AT.getTime() + ms);
const seal = () => sealCheckoutPaidClaim(claim, { secret: SECRET, now: SEALED_AT });

test("a sealed claim opens with the same secret while it lasts", () => {
  assert.deepEqual(openCheckoutPaidClaim(seal(), { secret: SECRET, now: SEALED_AT }), claim);
  assert.deepEqual(
    openCheckoutPaidClaim(seal(), { secret: SECRET, now: later(CHECKOUT_PAID_TTL_MS - 1) }),
    claim,
  );
});

test("a claim past its lifetime does not open", () => {
  assert.equal(
    openCheckoutPaidClaim(seal(), { secret: SECRET, now: later(CHECKOUT_PAID_TTL_MS) }),
    null,
  );
});

test("another secret does not open it", () => {
  assert.equal(
    openCheckoutPaidClaim(seal(), {
      secret: "another-secret-of-enough-length-1234567",
      now: SEALED_AT,
    }),
    null,
  );
});

test("a claim edited in the browser does not open", () => {
  const [payload, signature] = seal().split(".");
  const decoded = JSON.parse(Buffer.from(payload ?? "", "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
  const edits = [
    { ...decoded, r: "res_someone_else" },
    { ...decoded, s: "store_other" },
    { ...decoded, x: Number(decoded.x) + 24 * 60 * 60 * 1000 },
  ];
  for (const edit of edits) {
    const forged = `${Buffer.from(JSON.stringify(edit)).toString("base64url")}.${signature}`;
    assert.equal(openCheckoutPaidClaim(forged, { secret: SECRET, now: SEALED_AT }), null);
  }
});

test("anything else in the cookie does not open", () => {
  for (const value of ["", "garbage", ".", "a.b.c", `${seal()}x`, undefined]) {
    assert.equal(openCheckoutPaidClaim(value, { secret: SECRET, now: SEALED_AT }), null);
  }
});

test("without a secret nothing is sealed or opened", () => {
  assert.throws(() => sealCheckoutPaidClaim(claim, { secret: "", now: SEALED_AT }));
  assert.equal(openCheckoutPaidClaim(seal(), { secret: "", now: SEALED_AT }), null);
});

test("the cookie is HttpOnly, Lax, host-only, and lives as long as the claim", () => {
  const options = checkoutPaidCookieOptions({
    paidUrl: "https://shop.louez.test/checkout/paid",
    secure: true,
  });
  assert.deepEqual(options, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/checkout/paid",
    maxAge: CHECKOUT_PAID_TTL_MS / 1000,
  });
  assert.equal("domain" in options, false);
});

test("the cookie's path is the paid page's own, on every storefront shape", () => {
  const shapes = [
    // {slug}.{appDomain}
    { standalone: false, appDomain: "louez.test", origin: "https://app.louez.test" },
    // Local path-based routing: /{slug}/…
    { standalone: false, appDomain: "localhost:3000", origin: "http://localhost:3000" },
    // A single-store instance on its own domain.
    { standalone: true, appDomain: "location.test", origin: "https://location.test" },
  ];
  const paths = shapes.map((shape) => {
    const paidUrl = buildStorefrontUrl({
      slug: "shop",
      path: "/checkout/paid",
      protocol: "https",
      ...shape,
    });
    return checkoutPaidCookieOptions({ paidUrl, secure: true }).path;
  });
  assert.deepEqual(paths, ["/checkout/paid", "/shop/checkout/paid", "/checkout/paid"]);
});
