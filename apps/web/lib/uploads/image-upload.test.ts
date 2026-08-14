import assert from "node:assert/strict";
import { test } from "node:test";

import {
  IMAGE_UPLOAD_CONFIG,
  canApplyProductImageOperation,
  getImageKeyFromUrl,
  getProductImageProcessingKind,
  getImageUploadIssue,
} from "./image-upload";

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

test("extracts only the scoped filename from a stored image URL", () => {
  assert.equal(
    getImageKeyFromUrl("https://uploads.example.com/store-id/products/image-1.webp?cache=1"),
    "image-1.webp",
  );
  assert.equal(getImageKeyFromUrl("not-a-url"), null);
});

test("identifies product images already processed by AI or background removal", () => {
  const aiImage = "https://uploads.example.com/store/products/run-id-ai.webp";
  const backgroundImage = "/files/store/products/run-id-bg.webp";

  assert.equal(getProductImageProcessingKind(aiImage), "ai-enhanced");
  assert.equal(getProductImageProcessingKind(backgroundImage), "background-removed");
  assert.equal(
    getProductImageProcessingKind("https://uploads.example.com/store/products/original.webp"),
    null,
  );

  assert.equal(canApplyProductImageOperation(aiImage, "enhance"), false);
  assert.equal(canApplyProductImageOperation(aiImage, "remove-background"), false);
  assert.equal(canApplyProductImageOperation(backgroundImage, "enhance"), true);
  assert.equal(canApplyProductImageOperation(backgroundImage, "remove-background"), false);
});
