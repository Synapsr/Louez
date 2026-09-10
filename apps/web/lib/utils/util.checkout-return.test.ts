import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCheckoutHref, getCheckoutReturnHref } from "./util.checkout-return";

test("round-trips all catalog parameters through checkout", () => {
  const search = new URLSearchParams({
    search: "vélo cargo",
    category: "bikes",
    availableOnly: "0",
    quantity: "2",
    sort: "priceDesc",
    minPrice: "10",
    startDate: "2026-09-17T07:00:00.000Z",
    endDate: "2026-09-17T16:00:00.000Z",
  });
  search.append("attr", "size:M");
  search.append("attr", "color:blue");
  const checkout = new URL(
    buildCheckoutHref("/catalog", search.toString()),
    "https://example.test",
  );
  assert.equal(getCheckoutReturnHref(checkout.searchParams.get("returnTo")), `/catalog?${search}`);
});
test("direct checkout and other routes use a safe catalog fallback", () => {
  assert.equal(buildCheckoutHref("/product/one", "search=x"), "/checkout");
  for (const value of [
    null,
    "",
    "https://evil.test",
    "//evil.test",
    "/checkout",
    "/catalogue",
    "/catalog/../checkout",
  ]) {
    assert.equal(getCheckoutReturnHref(value), "/catalog");
  }
});
