import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { stripTypeScriptTypes } from "node:module";
import { z } from "zod";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const compiled = stripTypeScriptTypes(
  source.slice(source.indexOf("const returnQuerySchema")).replace("export const GET", "const GET"),
);

const runReturn = async (status, search = "?reservation=booking&session_id=session") => {
  let completions = 0;
  const dependencies = {
    "next/server": { NextResponse: { redirect: (url) => ({ url }) } },
    zod: { z },
    "@/lib/evlog": { log: { error() {} } },
    "@/lib/reservations/complete-checkout-payment": {
      completeCheckoutPayment: async (input) => {
        completions++;
        assert.equal(input.storeId, "store");
        assert.equal(input.reservationId, "booking");
        if (status === "throws") throw new Error("Stripe unavailable");
        return { status };
      },
    },
    "@/lib/storefront/get-store-by-slug": {
      getStoreBySlug: async () => ({ id: "store", slug: "shop" }),
    },
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
  return { ...response, completions };
};

for (const status of ["payment_unavailable", "not_found"]) {
  test(`${status} never grants customer access`, async () => {
    assert.equal((await runReturn(status)).url, "https://shop.example.test/");
  });
}

test("unpaid checkout goes to cancellation", async () => {
  assert.equal(
    (await runReturn("not_paid")).url,
    "https://shop.example.test/checkout/cancelled?reservation=booking",
  );
});

test("payment completion uses the protected account page without issuing a login token", async () => {
  assert.equal(
    (await runReturn("completed")).url,
    "https://shop.example.test/account/reservations/booking?event=paid",
  );
});

test("provider errors use the protected account page", async () => {
  assert.equal(
    (await runReturn("throws")).url,
    "https://shop.example.test/account/reservations/booking",
  );
});

test("missing payment evidence never calls completion", async () => {
  const result = await runReturn("completed", "?reservation=booking");
  assert.equal(result.url, "https://shop.example.test/");
  assert.equal(result.completions, 0);
});
