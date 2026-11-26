import assert from "node:assert/strict";
import { afterEach, before, mock, test } from "node:test";
import { NextRequest, type NextResponse } from "next/server";

import { EMBED_MODE_HEADER } from "@/lib/embed/util.embed-request";
import { clientTrackingFor } from "@/lib/util.client-tracking";

process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
process.env.NEXT_PUBLIC_APP_DOMAIN = "example.com";
process.env.LOUEZ_MODE = "platform";
process.env.NEXT_PUBLIC_FROMHELLO_API_URL = "https://engagement.example.net";
process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL = "https://stats.example.net/script.js";

let proxy: typeof import("./proxy").proxy;
before(async () => {
  ({ proxy } = await import("./proxy"));
});

afterEach(() => {
  process.env.LOUEZ_MODE = "platform";
  delete process.env.PREVIEW_STORE_SLUG;
  mock.restoreAll();
});

// Reconstruct what Next forwards, including deletions from the incoming request.
const forwardedHeaders = (response: NextResponse): Headers => {
  const overridden = response.headers.get("x-middleware-override-headers");
  assert.notEqual(overridden, null, "the proxy must forward sanitized request headers");
  const headers = new Headers();
  for (const name of overridden?.split(",") ?? []) {
    const value = response.headers.get(`x-middleware-request-${name}`);
    if (value !== null) headers.set(name, value);
  }
  return headers;
};

const visit = (path: string, host = "app.example.com") =>
  proxy(
    new NextRequest(`https://${host}${path}`, {
      headers: { host, "x-store-slug": "forged", [EMBED_MODE_HEADER]: "1", accept: "text/html" },
    }),
  );

const assertNoStore = (response: NextResponse) => {
  const headers = forwardedHeaders(response);
  assert.equal(headers.get("x-store-slug"), null);
  assert.equal(headers.get("accept"), "text/html");
  assert.equal(response.headers.get("x-store-slug"), null);
  assert.equal(headers.get(EMBED_MODE_HEADER), null);
};

const assertTracking = (response: NextResponse, embed: boolean) => {
  const headers = forwardedHeaders(response);
  assert.equal(headers.get(EMBED_MODE_HEADER), embed ? "1" : null);
  assert.deepEqual(clientTrackingFor({ headers, isPublicDemo: false, inDemoStore: false }), {
    productAnalytics: true,
    marketingTrackers: !embed,
  });
  const csp = response.headers.get("content-security-policy") ?? "";
  for (const origin of ["https://engagement.example.net", "https://stats.example.net"]) {
    for (const directive of ["script-src", "connect-src"]) {
      const sources = csp.split("; ").find((value) => value.startsWith(`${directive} `)) ?? "";
      assert.equal(sources.split(" ").includes(origin), !embed, `${directive}: ${origin}`);
    }
    if (embed) assert.equal(csp.includes(origin), false);
  }
  assert.match(csp, /script-src[^;]*https:\/\/eu-assets\.i\.posthog\.com/);
  assert.match(csp, /connect-src[^;]*https:\/\/eu\.i\.posthog\.com/);
  assert.match(csp, embed ? /frame-ancestors \*/ : /frame-ancestors 'self'/);
  assert.equal(response.headers.get("x-frame-options"), embed ? null : "SAMEORIGIN");
};

test("direct dashboard and apex paths discard caller-supplied store attribution", async () => {
  for (const host of ["app.example.com", "example.com", "www.example.com"]) {
    for (const path of ["/dashboard", "/shop/about", "/"]) {
      const response = await visit(path, host);
      assert.equal(response.headers.get("x-middleware-rewrite"), null);
      assertNoStore(response);
      assertTracking(response, false);
    }
  }
});

test("dashboard store switching, demos and handoffs discard caller-supplied store attribution", async () => {
  for (const path of ["/dashboard?store=s1", "/demos/landing/rental", "/handoffs/token"]) {
    assertNoStore(await visit(path));
  }
});

test("storefront hosts replace caller-supplied attribution with the resolved slug", async () => {
  const response = await visit("/about", "shop.example.com");
  assert.equal(forwardedHeaders(response).get("x-store-slug"), "shop");
  assert.equal(new URL(response.headers.get("x-middleware-rewrite") ?? "").pathname, "/shop/about");
});

test("local preview rewrites identify only the configured store", async () => {
  process.env.PREVIEW_STORE_SLUG = "preview-shop";
  const response = await visit("/about", "localhost:3000");
  assert.equal(forwardedHeaders(response).get("x-store-slug"), "preview-shop");
});

test("standalone dashboard, fresh install and storefront sanitize store attribution", async () => {
  process.env.LOUEZ_MODE = "standalone";
  const fetch = mock.method(globalThis, "fetch", async () => new Response(null, { status: 404 }));
  for (const path of ["/dashboard", "/dashboard?store=s1", "/", "/shop/about"]) {
    assertNoStore(await visit(path));
  }
  assertTracking(await visit("/dashboard"), false);
  const directEmbed = await visit("/shop/embed");
  assert.equal(forwardedHeaders(directEmbed).get("x-store-slug"), null);
  assertTracking(directEmbed, true);
  fetch.mock.mockImplementation(async () => Response.json({ slug: "solo" }));
  const response = await visit("/about");
  assert.equal(forwardedHeaders(response).get("x-store-slug"), "solo");
  assert.equal(new URL(response.headers.get("x-middleware-rewrite") ?? "").pathname, "/solo/about");
  assertTracking(response, false);
  const embed = await visit("/embed");
  assert.equal(forwardedHeaders(embed).get("x-store-slug"), "solo");
  assertTracking(embed, true);
  assertTracking(await visit("/shop/embed"), false);
});

test("direct widget URLs align forwarded headers, tracking policy and CSP", async () => {
  for (const host of ["app.example.com", "example.com", "www.example.com"]) {
    for (const path of ["/shop/embed", "/shop/embed/", "/shop/embed/availability"]) {
      const response = await visit(path, host);
      assert.equal(response.headers.get("x-middleware-rewrite"), null);
      assert.equal(forwardedHeaders(response).get("x-store-slug"), null);
      assertTracking(response, true);
    }
  }
});

test("rewritten storefront widgets align forwarded headers, tracking policy and CSP", async () => {
  for (const path of ["/embed", "/embed/", "/embed/availability", "/about", "/shop/embed"]) {
    const response = await visit(path, "shop.example.com");
    assert.equal(forwardedHeaders(response).get("x-store-slug"), "shop");
    assert.equal(
      new URL(response.headers.get("x-middleware-rewrite") ?? "").pathname,
      `/shop${path}`,
    );
    assertTracking(response, path.startsWith("/embed"));
  }
});

test("local preview widgets use the rewritten route namespace", async () => {
  process.env.PREVIEW_STORE_SLUG = "preview-shop";
  for (const path of ["/embed", "/about", "/shop/embed"]) {
    const response = await visit(path, "localhost:3000");
    assert.equal(forwardedHeaders(response).get("x-store-slug"), "preview-shop");
    assertTracking(response, path === "/embed");
  }
});

test("fixed app routes and lookalike paths never acquire widget mode or widget CSP", async () => {
  for (const path of [
    "/dashboard/embed",
    "/dashboard/settings/embed",
    "/dev/embed",
    "/online-store/embed",
    "/login/embed",
    "/oauth/embed",
    "/invitation/embed",
    "/demo/embed",
    "/demos/embed",
    "/account/embed",
    "/shop/embedded",
    "/shop/about/embed",
    "/embed",
  ]) {
    assertTracking(await visit(path), false);
  }
  for (const path of ["/handoffs/embed", "/partner/embed"]) {
    const response = await visit(path);
    assert.equal(forwardedHeaders(response).get(EMBED_MODE_HEADER), null);
    assert.doesNotMatch(
      response.headers.get("content-security-policy") ?? "",
      /frame-ancestors \*/,
    );
  }
});
