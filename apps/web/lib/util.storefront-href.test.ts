import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveStorefrontHref } from "./util.storefront-href";

test("leaves hrefs alone on a subdomain (empty basePath)", () => {
  assert.equal(resolveStorefrontHref("", "/catalog"), "/catalog");
  assert.equal(resolveStorefrontHref("", "/"), "/");
});

test("prefixes store-relative paths on the dashboard host", () => {
  assert.equal(resolveStorefrontHref("/ar-mor", "/catalog"), "/ar-mor/catalog");
  assert.equal(resolveStorefrontHref("/ar-mor", "/"), "/ar-mor/");
  assert.equal(
    resolveStorefrontHref("/ar-mor", "/catalog?startDate=2026-09-08"),
    "/ar-mor/catalog?startDate=2026-09-08",
  );
});

test("does not double a prefix that is already there", () => {
  assert.equal(resolveStorefrontHref("/ar-mor", "/ar-mor/catalog"), "/ar-mor/catalog");
  assert.equal(resolveStorefrontHref("/ar-mor", "/ar-mor"), "/ar-mor");
  assert.equal(resolveStorefrontHref("/ar-mor", "/ar-mor?x=1"), "/ar-mor?x=1");
  // A sibling store whose slug starts the same way is a different path.
  assert.equal(
    resolveStorefrontHref("/ar-mor", "/ar-morbihan/catalog"),
    "/ar-mor/ar-morbihan/catalog",
  );
});

test("passes external URLs, protocol-relative URLs and anchors through", () => {
  assert.equal(resolveStorefrontHref("/ar-mor", "https://example.com"), "https://example.com");
  assert.equal(resolveStorefrontHref("/ar-mor", "//cdn.example.com/x"), "//cdn.example.com/x");
  assert.equal(resolveStorefrontHref("/ar-mor", "mailto:a@b.c"), "mailto:a@b.c");
  assert.equal(resolveStorefrontHref("/ar-mor", "#reviews"), "#reviews");
});
