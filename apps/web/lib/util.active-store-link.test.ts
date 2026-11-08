import assert from "node:assert/strict";
import test from "node:test";

import { activeStoreSwitchPath, dashboardReturnPath } from "./util.active-store-link";

const at = (path: string) => new URL(path, "https://app.louez.test");

test("a dashboard URL naming its store becomes the active-store route, with the way back", () => {
  const target = activeStoreSwitchPath(at("/dashboard/reservations/r1?view=items&store=s1"));
  const url = at(target ?? "");
  assert.equal(url.pathname, "/api/active-store");
  assert.equal(url.searchParams.get("store"), "s1");
  assert.equal(url.searchParams.get("next"), "/dashboard/reservations/r1?view=items");
  assert.equal(
    at(activeStoreSwitchPath(at("/dashboard?store=s1")) ?? "").searchParams.get("next"),
    "/dashboard",
  );
});

test("other URLs are left alone", () => {
  for (const path of [
    "/dashboard/products/p1",
    "/dashboards?store=s1",
    "/login?store=s1",
    "/?store=s1",
  ]) {
    assert.equal(activeStoreSwitchPath(at(path)), null, path);
  }
});

test("the way back is a dashboard path without the store, or the dashboard home", () => {
  assert.equal(
    dashboardReturnPath("/dashboard/customers/c1?tab=a"),
    "/dashboard/customers/c1?tab=a",
  );
  assert.equal(
    dashboardReturnPath("/dashboard/customers/c1?store=s1&tab=a"),
    "/dashboard/customers/c1?tab=a",
  );
  for (const next of [
    null,
    "",
    "https://evil.test/dashboard",
    "//evil.test/dashboard",
    "/\\\\evil.test",
    "/login",
    "/dashboardx",
    "dashboard",
  ]) {
    assert.equal(dashboardReturnPath(next), "/dashboard", String(next));
  }
});
