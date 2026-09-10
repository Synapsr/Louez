import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveCatalogNavigation } from "./util.catalog-navigation";

const saved =
  "/catalog?search=cargo&category=old&availableOnly=0&sort=priceDesc&attr=size%3AM&attr=color%3Ared";

test("catalog links restore the full query; categories override only their criterion", () => {
  assert.equal(resolveCatalogNavigation("/catalog", saved), saved);
  const result = new URL(
    resolveCatalogNavigation("/catalog?category=new", saved),
    "https://example.test",
  );
  assert.equal(result.searchParams.get("category"), "new");
  assert.equal(result.searchParams.get("search"), "cargo");
  assert.deepEqual(result.searchParams.getAll("attr"), ["size:M", "color:red"]);
});
test("product and checkout links carry the catalog through reloads and new tabs", () => {
  for (const href of ["/product/abc?startDate=2026-09-17", "/checkout"]) {
    const result = new URL(resolveCatalogNavigation(href, saved), "https://example.test");
    assert.equal(result.searchParams.get("returnTo"), saved);
    if (href.startsWith("/product"))
      assert.equal(result.searchParams.get("startDate"), "2026-09-17");
  }
  assert.equal(
    resolveCatalogNavigation("/checkout?returnTo=%2Fcatalog%3Fsearch%3Dother", saved),
    "/checkout?returnTo=%2Fcatalog%3Fsearch%3Dother",
  );
});
test("other destinations and plain catalog defaults remain unchanged", () => {
  for (const href of ["/", "/account", "https://example.test/catalog", "#contact"]) {
    assert.equal(resolveCatalogNavigation(href, saved), href);
  }
  assert.equal(resolveCatalogNavigation("/product/abc", "/catalog"), "/product/abc");
  assert.equal(resolveCatalogNavigation("/catalog", "//external.test"), "/catalog");
});
