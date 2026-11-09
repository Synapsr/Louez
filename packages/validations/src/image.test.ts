import assert from "node:assert/strict";
import { before, test } from "node:test";

let isOwnedImageUrl: typeof import("./image").isOwnedImageUrl;

before(async () => {
  // The env module reads these when it loads.
  process.env.S3_PUBLIC_URL = "/files";
  process.env.NODE_ENV = "production";
  ({ isOwnedImageUrl } = await import("./image"));
});

test("an image is owned when its path sits in the owner's folder", () => {
  assert.equal(isOwnedImageUrl("/files/storeA/categories/a.png", "storeA/categories"), true);
  assert.equal(isOwnedImageUrl("/files/storeB/categories/a.png", "storeA/categories"), false);
  assert.equal(isOwnedImageUrl("/files/storeA/categoriesX/a.png", "storeA/categories"), false);
});

test("a path that resolves elsewhere is never owned", () => {
  for (const path of [
    "/files/storeA/categories/../../storeB/categories/a.png",
    "/files/storeA/categories/./a.png",
    "/files/storeA/categories/%2e%2e/%2e%2e/storeB/categories/a.png",
    "/files/storeA/categories/..%2fstoreB%2fa.png",
    "/files/storeA/categories/..\\..\\storeB\\a.png",
  ]) {
    assert.equal(isOwnedImageUrl(path, "storeA/categories"), false, path);
  }
});
