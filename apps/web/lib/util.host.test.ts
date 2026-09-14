import assert from "node:assert/strict";
import test from "node:test";

import { getStorefrontSlugFromHost, getSubdomain, isLoopbackHost } from "./util.host";

const rule = { appDomain: "louez.io", dashboardSubdomain: "app" };

test("getSubdomain reads the labels in front of the app domain", () => {
  assert.equal(getSubdomain("ddm.louez.io", "louez.io"), "ddm");
  assert.equal(getSubdomain("app.louez.io", "louez.io"), "app");
  assert.equal(getSubdomain("a.b.louez.io", "louez.io"), "a.b");
  assert.equal(getSubdomain("ddm.louez.io:3000", "louez.io:3000"), "ddm");
});

test("getSubdomain returns null for the apex, localhost and loopback hosts", () => {
  assert.equal(getSubdomain("louez.io", "louez.io"), null);
  assert.equal(getSubdomain("localhost:3000", "localhost:3000"), null);
  assert.equal(getSubdomain("127.0.0.1:3000", "localhost:3000"), null);
  assert.equal(getSubdomain("", "louez.io"), null);
});

test("getSubdomain supports local wildcard domains", () => {
  assert.equal(getSubdomain("ddm.localhost:3000", "localhost:3000"), "ddm");
  assert.equal(
    getSubdomain("ar-mor-location.feat.louez.localify", "feat.louez.localify"),
    "ar-mor-location",
  );
});

test("isLoopbackHost recognises every loopback spelling", () => {
  assert.equal(isLoopbackHost("localhost"), true);
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("::1"), true);
  assert.equal(isLoopbackHost("[::1]"), true);
  assert.equal(isLoopbackHost("louez.io"), false);
  assert.equal(isLoopbackHost("ddm.localhost"), false);
});

test("getStorefrontSlugFromHost keeps only store subdomains", () => {
  assert.equal(getStorefrontSlugFromHost("ddm.louez.io", rule), "ddm");
  assert.equal(getStorefrontSlugFromHost("ddm.louez.io:443", rule), "ddm");
  assert.equal(getStorefrontSlugFromHost("app.louez.io", rule), null);
  assert.equal(getStorefrontSlugFromHost("www.louez.io", rule), null);
  assert.equal(getStorefrontSlugFromHost("louez.io", rule), null);
  assert.equal(getStorefrontSlugFromHost("localhost:3000", rule), null);
});

test("getStorefrontSlugFromHost honours a custom dashboard subdomain", () => {
  const custom = { appDomain: "louez.io", dashboardSubdomain: "app-dev" };
  assert.equal(getStorefrontSlugFromHost("app-dev.louez.io", custom), null);
  assert.equal(getStorefrontSlugFromHost("app.louez.io", custom), "app");
});
