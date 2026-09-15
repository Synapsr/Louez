import assert from "node:assert/strict";
import test from "node:test";
import { getDemoParentOrigins, isDemoPath, isDemoScene } from "./policy";
import { buildDemoSecurityHeaders, buildSecurityHeaders } from "../util.security-headers";

test("only the dedicated route and registered scenes are demos", () => {
  assert.equal(isDemoPath("/demos/landing/rental"), true);
  assert.equal(isDemoPath("/demos/landing-fake/rental"), false);
  assert.equal(isDemoPath("/dashboard/reservations/demo"), false);
  assert.equal(isDemoScene("rental"), true);
  assert.equal(isDemoScene("dashboard"), false);
});
test("production frames are limited to the marketing origins and cannot call business APIs", () => {
  const headers = buildDemoSecurityHeaders({
    appDomain: "louez.io",
    appUrl: "https://app.louez.io",
    isDevelopment: false,
  });
  const csp = headers.find((header) => header.key === "Content-Security-Policy")?.value ?? "";
  assert.equal(
    headers.some((header) => header.key === "X-Frame-Options"),
    false,
  );
  assert.match(csp, /frame-ancestors 'self' https:\/\/louez\.io https:\/\/www\.louez\.io;/);
  assert.match(csp, /connect-src https:\/\/app\.louez\.io\/demos\/landing\/;/);
  assert.match(csp, /form-action 'none'/);
  assert.doesNotMatch(csp, /localify/);
  const appHeaders = buildSecurityHeaders({ isDevelopment: false });
  assert.equal(appHeaders.find((header) => header.key === "X-Frame-Options")?.value, "SAMEORIGIN");
  assert.match(
    appHeaders.find((header) => header.key === "Content-Security-Policy")?.value ?? "",
    /frame-ancestors 'self'/,
  );
});
test("local embedding is enabled only in development", () => {
  assert.equal(
    getDemoParentOrigins("louez.io", false).includes("https://landing.louez-website.localify"),
    false,
  );
  assert.equal(
    getDemoParentOrigins("louez.io", true).includes("https://landing.louez-website.localify"),
    true,
  );
});
