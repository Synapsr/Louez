import assert from "node:assert/strict";
import { test } from "node:test";

import { isNavigationItemActive, isSubItemActive } from "./util.navigation-active";

const visibility = [{ href: "/dashboard/visibility" }, { href: "/dashboard/visibility/ai" }];

test("the home entry matches the home only; another entry matches its pages", () => {
  assert.equal(isNavigationItemActive("/dashboard", "/dashboard"), true);
  assert.equal(isNavigationItemActive("/dashboard/products", "/dashboard"), false);
  assert.equal(isNavigationItemActive("/dashboard/products/abc", "/dashboard/products"), true);
  assert.equal(isNavigationItemActive("/dashboard/productsx", "/dashboard/products"), false);
});

test("a sub-entry gives way to a deeper sibling that matches", () => {
  const [guide, ai] = visibility;
  assert.equal(isSubItemActive("/dashboard/visibility", guide, visibility), true);
  assert.equal(isSubItemActive("/dashboard/visibility", ai, visibility), false);
  assert.equal(isSubItemActive("/dashboard/visibility/ai", guide, visibility), false);
  assert.equal(isSubItemActive("/dashboard/visibility/ai", ai, visibility), true);
});
