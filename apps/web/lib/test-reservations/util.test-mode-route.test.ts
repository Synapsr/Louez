import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { testModeRoutePaths } from "./util.test-mode-route";

describe("the test-mode link's redirect", () => {
  test("goes to the store's home under its slug, the cookie on that path", () => {
    assert.deepEqual(testModeRoutePaths("ma-boutique", false), {
      home: "/ma-boutique/",
      cookiePath: "/ma-boutique",
    });
  });

  test("goes to the root on the store's own host", () => {
    assert.deepEqual(testModeRoutePaths("ma-boutique", true), { home: "/", cookiePath: "/" });
  });

  test("goes to the root when no store is found", () => {
    for (const slug of [null, undefined, ""]) {
      assert.deepEqual(testModeRoutePaths(slug, false), { home: "/", cookiePath: "/" });
    }
  });

  test("is never protocol-relative nor leaves the host", () => {
    for (const slug of ["/evil.example", "//evil.example", "\\evil.example", "a/../b", "%2F"]) {
      const { home, cookiePath } = testModeRoutePaths(slug, false);
      assert.match(home, /^\/[^/\\]/, slug);
      assert.equal(home.slice(1, -1).includes("/"), false, slug);
      assert.equal(cookiePath.slice(1).includes("/"), false, slug);
      assert.equal(new URL(home, "https://store.example").host, "store.example", slug);
    }
  });
});
