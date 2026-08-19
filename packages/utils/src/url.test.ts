import assert from "node:assert/strict";
import { test } from "node:test";

import { toAbsoluteUrl } from "./url";

test("resolves a site-relative media URL against the public app origin", () => {
  assert.equal(
    toAbsoluteUrl("/files/store/products/product.webp", "https://app.louez.io/"),
    "https://app.louez.io/files/store/products/product.webp",
  );
});

test("leaves already-absolute media URLs untouched", () => {
  assert.equal(
    toAbsoluteUrl(
      "https://louez.s3.fr-par.scw.cloud/store/products/product.webp",
      "https://app.louez.io",
    ),
    "https://louez.s3.fr-par.scw.cloud/store/products/product.webp",
  );
});

test("leaves protocol-relative and non-root-relative values untouched", () => {
  assert.equal(
    toAbsoluteUrl("//cdn.example.com/product.webp", "https://app.louez.io"),
    "//cdn.example.com/product.webp",
  );
  assert.equal(toAbsoluteUrl("files/product.webp", "https://app.louez.io"), "files/product.webp");
});
