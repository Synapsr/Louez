import assert from "node:assert/strict";
import test from "node:test";
import { getDemoParentOrigins, isDemoPath, isDemoScene } from "./policy";
import { buildDemoSecurityHeaders, buildSecurityHeaders } from "../util.security-headers";
import { readPublicEnvRuntime } from "../validators/validator.public-env";

test("runtime marketing origins enable framing and playback without opening business routes", () => {
  const runtime: Record<string, string | undefined> = {
    NEXT_PUBLIC_APP_URL: "https://app.louez.app",
    NEXT_PUBLIC_APP_DOMAIN: "louez.app",
    NEXT_PUBLIC_LOUEZ_DEMO_PARENT_ORIGINS:
      " https://louez.d5.lumy.cloud/, https://louez.io, https://louez.app ",
  };
  const config = readPublicEnvRuntime({ readEnv: (name) => runtime[name] });
  const options = {
    appDomain: config.NEXT_PUBLIC_APP_DOMAIN,
    appUrl: config.NEXT_PUBLIC_APP_URL,
    demoParentOrigins: config.NEXT_PUBLIC_LOUEZ_DEMO_PARENT_ORIGINS,
    isDevelopment: false,
  };
  const allowed = getDemoParentOrigins(options.appDomain, false, options.demoParentOrigins);
  assert.deepEqual(allowed, [
    "https://louez.app",
    "https://www.louez.app",
    "https://louez.d5.lumy.cloud",
    "https://louez.io",
  ]);
  const csp =
    buildDemoSecurityHeaders(options).find((header) => header.key === "Content-Security-Policy")
      ?.value ?? "";
  assert.ok(csp.includes(`frame-ancestors 'self' ${allowed.join(" ")};`));
  assert.match(csp, /connect-src https:\/\/app\.louez\.app\/demos\/landing\/;/);
  const businessHeaders = buildSecurityHeaders(options);
  assert.equal(
    businessHeaders.find((header) => header.key === "X-Frame-Options")?.value,
    "SAMEORIGIN",
  );
  assert.doesNotMatch(
    businessHeaders.find((header) => header.key === "Content-Security-Policy")?.value ?? "",
    /louez\.d5\.lumy\.cloud/,
  );
  delete runtime.NEXT_PUBLIC_LOUEZ_DEMO_PARENT_ORIGINS;
  const otherDeployment = readPublicEnvRuntime({ readEnv: (name) => runtime[name] });
  assert.equal(
    getDemoParentOrigins(
      otherDeployment.NEXT_PUBLIC_APP_DOMAIN,
      false,
      otherDeployment.NEXT_PUBLIC_LOUEZ_DEMO_PARENT_ORIGINS,
    ).includes("https://louez.d5.lumy.cloud"),
    false,
  );
});

test("demo parents require explicit HTTPS origins", () => {
  for (const origin of [
    "*",
    "https://*.lumy.cloud",
    "http://louez.d5.lumy.cloud",
    "https://example.com/path",
    "https://example.com?query=1",
    "https://example.com#fragment",
    "https://user:password@example.com",
    "https://example.com; frame-ancestors *",
  ]) {
    const runtime: Record<string, string | undefined> = {
      NEXT_PUBLIC_APP_URL: "https://app.louez.app",
      NEXT_PUBLIC_APP_DOMAIN: "louez.app",
      NEXT_PUBLIC_LOUEZ_DEMO_PARENT_ORIGINS: origin,
    };
    assert.throws(() => readPublicEnvRuntime({ readEnv: (name) => runtime[name] }), origin);
  }
});

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
