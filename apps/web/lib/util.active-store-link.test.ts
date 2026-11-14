import assert from "node:assert/strict";
import test from "node:test";

import {
  activeStoreSwitchPath,
  dashboardReturnPath,
  isSameOriginPost,
} from "./util.active-store-link";

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
  assert.equal(
    at(activeStoreSwitchPath(at("/online-store/legal?store=s1")) ?? "").searchParams.get("next"),
    "/online-store/legal",
  );
});

test("other URLs are left alone", () => {
  for (const path of [
    "/dashboard/products/p1",
    "/dashboards?store=s1",
    "/online-stores?store=s1",
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
  assert.equal(dashboardReturnPath("/online-store/legal?store=s1"), "/online-store/legal");
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

const APP = "https://app.example";
const posted = (headers: Record<string, string>) => isSameOriginPost(new Headers(headers), [APP]);

test("a post from this app's own pages is accepted: its origin, same-origin when the browser says", () => {
  assert.equal(posted({ origin: APP }), true);
  assert.equal(posted({ origin: APP, "sec-fetch-site": "same-origin" }), true);
});

test("a page that sends no referrer posts with a null origin: accepted only when the browser says same-origin", () => {
  // What a browser sends from a `no-referrer` page of this app.
  assert.equal(posted({ origin: "null", "sec-fetch-site": "same-origin" }), true);
  // A null origin alone says nothing, and another site's form says cross-site.
  assert.equal(posted({ origin: "null" }), false);
  assert.equal(posted({ origin: "null", "sec-fetch-site": "cross-site" }), false);
  assert.equal(posted({ origin: "null", "sec-fetch-site": "same-site" }), false);
  assert.equal(posted({ origin: "null", "sec-fetch-site": "none" }), false);
});

test("another origin, or none, is refused whatever else is sent", () => {
  assert.equal(posted({ origin: "https://other.example" }), false);
  assert.equal(posted({ origin: "https://other.example", "sec-fetch-site": "same-origin" }), false);
  assert.equal(posted({ origin: APP, "sec-fetch-site": "cross-site" }), false);
  assert.equal(posted({ origin: APP, "sec-fetch-site": "same-site" }), false);
  assert.equal(posted({}), false);
  assert.equal(posted({ "sec-fetch-site": "same-origin" }), false);
});
