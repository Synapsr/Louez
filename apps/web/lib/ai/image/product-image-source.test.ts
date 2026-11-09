import assert from "node:assert/strict";
import { test } from "node:test";

import { parseTrustedDemoProductImageUrl } from "./product-image-source";

test("accepts Louez product images hosted in Scaleway Object Storage", () => {
  assert.equal(
    parseTrustedDemoProductImageUrl(
      "https://louez.s3.fr-par.scw.cloud/store-id/products/image-1.webp",
    )?.pathname,
    "/store-id/products/image-1.webp",
  );
  assert.equal(
    parseTrustedDemoProductImageUrl(
      "https://louez-dev.s3.fr-par.scw.cloud/demo/ar-mor-location/products/tandem.jpg",
    )?.pathname,
    "/demo/ar-mor-location/products/tandem.jpg",
  );
});

test("rejects arbitrary or unsafe remote image sources", () => {
  assert.equal(parseTrustedDemoProductImageUrl("https://example.com/products/image.jpg"), null);
  assert.equal(
    parseTrustedDemoProductImageUrl("http://louez.s3.fr-par.scw.cloud/store-id/products/image.jpg"),
    null,
  );
  assert.equal(
    parseTrustedDemoProductImageUrl(
      "https://user:password@louez.s3.fr-par.scw.cloud/store-id/products/image.jpg",
    ),
    null,
  );
  assert.equal(
    parseTrustedDemoProductImageUrl("https://louez.s3.fr-par.scw.cloud/store-id/products/file.txt"),
    null,
  );
});
