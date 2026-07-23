import assert from "node:assert/strict";
import { test } from "node:test";

import {
  IMAGE_UPLOAD_CONFIG,
  getImageKeyFromUrl,
  getImageUploadIssue,
} from "./image-upload";

test("applies the upload limit for each image kind", () => {
  assert.equal(
    getImageUploadIssue(
      { size: IMAGE_UPLOAD_CONFIG.logo.maxSize + 1, type: "image/png" },
      "logo",
    ),
    "tooLarge",
  );
  assert.equal(
    getImageUploadIssue(
      { size: IMAGE_UPLOAD_CONFIG.hero.maxSize, type: "image/webp" },
      "hero",
    ),
    null,
  );
});

test("rejects active and unsupported image formats", () => {
  assert.equal(
    getImageUploadIssue({ size: 100, type: "image/svg+xml" }, "logo"),
    "invalidType",
  );
  assert.equal(
    getImageUploadIssue({ size: 100, type: "image/avif" }, "product"),
    "invalidType",
  );
});

test("extracts only the scoped filename from a stored image URL", () => {
  assert.equal(
    getImageKeyFromUrl(
      "https://uploads.example.com/store-id/products/image-1.webp?cache=1",
    ),
    "image-1.webp",
  );
  assert.equal(getImageKeyFromUrl("not-a-url"), null);
});
