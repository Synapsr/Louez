import assert from "node:assert/strict";
import { afterEach, before, describe, test } from "node:test";

import { NextRequest } from "next/server";

// The proxy's share of the self-host gating (louez-billing docs/plans/design.md §7.2):
// with LOUEZ_BILLING off, billing pages answer 404 before any layout sends the visitor
// to the login, and no referral cookie is captured.

process.env.SKIP_ENV_VALIDATION = "true";
process.env.LOUEZ_MODE = "platform";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
process.env.NEXT_PUBLIC_APP_DOMAIN = "localhost:3000";

const REFERRAL_CODE = "LOUEZABCDEFG";

describe("proxy billing gate", () => {
  let proxy: typeof import("./proxy").proxy;

  before(async () => {
    ({ proxy } = await import("./proxy"));
  });

  afterEach(() => {
    delete process.env.LOUEZ_BILLING;
    delete process.env.BILLING_SERVICE_URL;
  });

  const visit = (path: string, host = "localhost:3000") =>
    proxy(new NextRequest(new URL(path, `http://${host}`), { headers: { host } }));

  test("billing pages answer 404 when billing is off, for anyone", async () => {
    for (const path of [
      "/dashboard/settings/subscription",
      "/dashboard/subscription?plans=1",
      "/dashboard/billing",
      "/dashboard/billing/return",
      "/dashboard/settings/billing",
      "/dashboard/settings/referrals",
      "/dashboard/ai-credits",
      "/dashboard/settings/admin",
      "/admin",
      "/admin/finance",
      "/onboarding/billing",
    ]) {
      const response = await visit(path);
      assert.equal(response.status, 404, path);
    }
  });

  test("other pages, and billing pages with billing on, pass through", async () => {
    for (const path of [
      "/dashboard",
      "/dashboard/settings/payments",
      "/dashboard/sms",
      "/administration",
      "/onboarding",
      "/onboarding/stripe",
    ]) {
      assert.notEqual((await visit(path)).status, 404, path);
    }
    process.env.LOUEZ_BILLING = "cloud";
    for (const path of ["/dashboard/settings/subscription", "/admin/finance"]) {
      assert.notEqual((await visit(path)).status, 404, path);
    }
  });

  test("Louez Cloud's terms answer 404 when billing is off, a store's terms never", async () => {
    // The dashboard host and the root host serve app/(legal)/terms.
    assert.equal((await visit("/terms")).status, 404, "dashboard host");
    assert.equal((await visit("/terms", "www.localhost:3000")).status, 404, "root host");
    assert.notEqual((await visit("/privacy")).status, 404, "the privacy policy stays");
    // A storefront's /terms is the store's own terms and conditions.
    const storefront = await visit("/terms", "shop.localhost:3000");
    assert.notEqual(storefront.status, 404);
    assert.match(storefront.headers.get("x-middleware-rewrite") ?? "", /\/shop\/terms$/);

    process.env.LOUEZ_BILLING = "cloud";
    assert.notEqual((await visit("/terms")).status, 404);
    assert.notEqual((await visit("/terms", "www.localhost:3000")).status, 404);
  });

  test("on a standalone instance only a fresh install's /terms is Louez's", async () => {
    const realFetch = globalThis.fetch;
    process.env.LOUEZ_MODE = "standalone";
    try {
      // No onboarded store yet: /terms would reach Louez Cloud's terms page.
      globalThis.fetch = async () => new Response(null, { status: 404 });
      assert.equal((await visit("/terms")).status, 404);
      // With its store, /terms is the store's terms and conditions.
      globalThis.fetch = async () => Response.json({ slug: "solo" });
      const withStore = await visit("/terms");
      assert.notEqual(withStore.status, 404);
      assert.match(withStore.headers.get("x-middleware-rewrite") ?? "", /\/solo\/terms$/);
    } finally {
      globalThis.fetch = realFetch;
      process.env.LOUEZ_MODE = "platform";
    }
  });

  test("with the billing service, its pages join form-action; elsewhere nothing changes", async () => {
    // README §10 step 2 and §12: in service mode only.
    const formAction = async () =>
      /form-action ([^;]*)/.exec(
        (await visit("/dashboard")).headers.get("Content-Security-Policy") ?? "",
      )?.[1];
    assert.equal(await formAction(), "'self'");
    process.env.BILLING_SERVICE_URL = "https://billing.example.test";
    assert.equal(await formAction(), "'self'", "LOUEZ_BILLING off");
    process.env.LOUEZ_BILLING = "cloud";
    assert.equal(await formAction(), "'self' https://billing.example.test");
    delete process.env.BILLING_SERVICE_URL;
    assert.equal(await formAction(), "'self'", "cloud without the service");
  });

  test("the billing hand-off keeps its own CSP and frame policy; the return does not", async () => {
    process.env.LOUEZ_BILLING = "cloud";
    process.env.BILLING_SERVICE_URL = "https://billing.example.test";
    for (const path of ["/dashboard/billing", "/dashboard/billing/?to=%2Fdetails"]) {
      const response = await visit(path);
      assert.equal(response.headers.get("Content-Security-Policy"), null, path);
      assert.equal(response.headers.get("X-Frame-Options"), null, path);
      assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff", path);
    }
    for (const path of ["/dashboard/billing/return", "/dashboard/settings/billing"]) {
      const response = await visit(path);
      assert.match(response.headers.get("Content-Security-Policy") ?? "", /form-action/, path);
      assert.equal(response.headers.get("X-Frame-Options"), "SAMEORIGIN", path);
    }
    // On a storefront host the same path is a store page, not the hand-off.
    const storefront = await visit("/dashboard/billing", "shop.localhost:3000");
    assert.match(
      storefront.headers.get("x-middleware-rewrite") ?? "",
      /\/shop\/dashboard\/billing$/,
    );
    assert.match(storefront.headers.get("Content-Security-Policy") ?? "", /form-action/);
    assert.equal(storefront.headers.get("X-Frame-Options"), "SAMEORIGIN");
    // Outside service mode the proxy's headers are as before, on its 404 too.
    for (const billing of [undefined, "cloud"]) {
      if (billing) process.env.LOUEZ_BILLING = billing;
      else delete process.env.LOUEZ_BILLING;
      delete process.env.BILLING_SERVICE_URL;
      const response = await visit("/dashboard/billing");
      assert.match(response.headers.get("Content-Security-Policy") ?? "", /form-action 'self';/);
      assert.equal(response.headers.get("X-Frame-Options"), "SAMEORIGIN");
    }
  });

  test("a referral code is captured only when billing is on", async () => {
    const off = await visit(`/login?ref=${REFERRAL_CODE}`);
    assert.equal(off.cookies.get("louez_referral"), undefined);

    process.env.LOUEZ_BILLING = "cloud";
    const on = await visit(`/login?ref=${REFERRAL_CODE}`);
    assert.equal(on.cookies.get("louez_referral")?.value, REFERRAL_CODE);
  });
});
