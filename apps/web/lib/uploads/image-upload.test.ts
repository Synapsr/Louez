import assert from "node:assert/strict";
import { test } from "node:test";

import { IMAGE_UPLOAD_CONFIG, getImageUploadIssue } from "./image-upload";

test("applies the upload limit for each image kind", () => {
  assert.equal(
    getImageUploadIssue({ size: IMAGE_UPLOAD_CONFIG.logo.maxSize + 1, type: "image/png" }, "logo"),
    "tooLarge",
  );
  assert.equal(
    getImageUploadIssue({ size: IMAGE_UPLOAD_CONFIG.hero.maxSize, type: "image/webp" }, "hero"),
    null,
  );
  assert.equal(
    getImageUploadIssue(
      { size: IMAGE_UPLOAD_CONFIG.category.maxSize, type: "image/jpeg" },
      "category",
    ),
    null,
  );
});

test("rejects active and unsupported image formats", () => {
  assert.equal(getImageUploadIssue({ size: 100, type: "image/svg+xml" }, "logo"), "invalidType");
  assert.equal(getImageUploadIssue({ size: 100, type: "image/avif" }, "product"), "invalidType");
});
