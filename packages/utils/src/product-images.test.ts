import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appendProductImageVersion,
  canApplyProductImageOperation,
  collectProductImageUrls,
  createInitialProductImageHistory,
  findProductImageHistory,
  getImageKeyFromUrl,
  getProductImageProcessingKind,
  productImageVersions,
  removeProductImageHistory,
  removeProductImageVersion,
  selectProductImageVersion,
} from "./product-images";

test("keeps legacy images and every transformation in one history", () => {
  const initial = createInitialProductImageHistory(["/files/original.webp"]);
  const cropped = appendProductImageVersion(
    initial,
    "/files/original.webp",
    "/files/cropped.webp",
    "cropped",
  );
  const enhanced = appendProductImageVersion(
    cropped,
    "/files/cropped.webp",
    "/files/cropped-ai.webp",
    "ai-enhanced",
  );

  assert.deepEqual(
    findProductImageHistory(enhanced, "/files/cropped-ai.webp")?.versions.map(({ url }) => url),
    ["/files/original.webp", "/files/cropped.webp", "/files/cropped-ai.webp"],
  );
  assert.deepEqual(collectProductImageUrls(["/files/cropped-ai.webp"], enhanced), [
    "/files/cropped-ai.webp",
    "/files/original.webp",
    "/files/cropped.webp",
  ]);
});

test("removing a photo removes its complete version lineage", () => {
  const histories = createInitialProductImageHistory(["/files/first.webp", "/files/second.webp"]);

  assert.deepEqual(
    removeProductImageHistory(histories, "/files/first.webp").flatMap((history) =>
      history.versions.map(({ url }) => url),
    ),
    ["/files/second.webp"],
  );
});

test("removes one historical version but never the last version", () => {
  const initial = createInitialProductImageHistory(["/files/original.webp"]);
  const histories = appendProductImageVersion(
    initial,
    "/files/original.webp",
    "/files/original-ai.webp",
    "ai-enhanced",
  );
  const history = histories[0];
  assert.ok(history);

  const withoutAiVersion = removeProductImageVersion(
    histories,
    history.id,
    history.versions[1]?.id ?? "missing",
  );
  assert.deepEqual(
    withoutAiVersion[0]?.versions.map(({ url }) => url),
    ["/files/original.webp"],
  );

  const unchanged = removeProductImageVersion(
    withoutAiVersion,
    history.id,
    withoutAiVersion[0]?.versions[0]?.id ?? "missing",
  );
  assert.deepEqual(unchanged, withoutAiVersion);
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

test("names what a job appends after the job, for a photo with and without a lineage", () => {
  const fresh = appendProductImageVersion(
    [],
    "/files/a.webp",
    "/files/job1-ai.webp",
    "ai-enhanced",
    {
      versionId: "product-image-version-job1",
      historyId: "product-image-history-job1",
      sourceVersionId: "product-image-version-job1-source",
      createdAt: "2026-11-09T10:00:00.000Z",
    },
  );
  assert.deepEqual(fresh, [
    {
      id: "product-image-history-job1",
      versions: [
        {
          id: "product-image-version-job1-source",
          url: "/files/a.webp",
          kind: "original",
          createdAt: "2026-11-09T10:00:00.000Z",
        },
        {
          id: "product-image-version-job1",
          url: "/files/job1-ai.webp",
          kind: "ai-enhanced",
          createdAt: "2026-11-09T10:00:00.000Z",
        },
      ],
    },
  ]);

  const again = appendProductImageVersion(fresh, "/files/job1-ai.webp", "/files/job2-bg.webp", "background-removed", {
    versionId: "product-image-version-job2",
    historyId: "unused",
  });
  assert.equal(again.length, 1);
  assert.deepEqual(
    again[0]?.versions.map(({ id }) => id),
    ["product-image-version-job1-source", "product-image-version-job1", "product-image-version-job2"],
  );
});

test("shows each photo's versions, the one in use marked, with stable ids", () => {
  const histories = appendProductImageVersion([], "/files/a.webp", "/files/a-ai.webp", "ai-enhanced", {
    versionId: "v-ai",
    sourceVersionId: "v-a",
    historyId: "h-a",
  });
  const images = ["/files/a-ai.webp", "/files/b.webp"];
  const view = productImageVersions(images, histories);
  assert.deepEqual(
    view.map((photo) => ({
      imageUrl: photo.imageUrl,
      versions: photo.versions.map(({ id, current }) => [id, current]),
    })),
    [
      { imageUrl: "/files/a-ai.webp", versions: [["v-a", false], ["v-ai", true]] },
      { imageUrl: "/files/b.webp", versions: [["product-image-version-initial-1", true]] },
    ],
  );
  assert.deepEqual(productImageVersions(images, histories), view);
});

test("puts a version back in use in its photo's place, and refuses what it cannot find", () => {
  const histories = appendProductImageVersion([], "/files/a.webp", "/files/a-ai.webp", "ai-enhanced", {
    versionId: "v-ai",
    sourceVersionId: "v-a",
  });
  const images = ["/files/x.webp", "/files/a-ai.webp"];

  assert.deepEqual(selectProductImageVersion(images, histories, "v-a"), {
    ok: true,
    images: ["/files/x.webp", "/files/a.webp"],
    previousUrl: "/files/a-ai.webp",
    url: "/files/a.webp",
  });
  // The version in use: nothing changes.
  assert.deepEqual(selectProductImageVersion(images, histories, "v-ai"), {
    ok: true,
    images,
    previousUrl: "/files/a-ai.webp",
    url: "/files/a-ai.webp",
  });
  assert.deepEqual(selectProductImageVersion(images, histories, "nope"), {
    ok: false,
    reason: "version_not_found",
  });
  assert.deepEqual(selectProductImageVersion(["/files/x.webp"], histories, "v-a"), {
    ok: false,
    reason: "photo_not_in_use",
  });
});
