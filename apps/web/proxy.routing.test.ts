import assert from "node:assert/strict";
import { afterEach, before, mock, test } from "node:test";
import { NextRequest, type NextResponse } from "next/server";

process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
process.env.NEXT_PUBLIC_APP_DOMAIN = "example.com";
process.env.LOUEZ_MODE = "platform";

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
      headers: { host, "x-store-slug": "forged", accept: "text/html" },
    }),
  );

const assertNoStore = (response: NextResponse) => {
  const headers = forwardedHeaders(response);
  assert.equal(headers.get("x-store-slug"), null);
  assert.equal(headers.get("accept"), "text/html");
  assert.equal(response.headers.get("x-store-slug"), null);
};

test("direct dashboard and apex paths discard caller-supplied store attribution", async () => {
  for (const host of ["app.example.com", "example.com", "www.example.com"]) {
    for (const path of ["/dashboard", "/shop/about", "/"]) {
      const response = await visit(path, host);
      assert.equal(response.headers.get("x-middleware-rewrite"), null);
      assertNoStore(response);
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
  fetch.mock.mockImplementation(async () => Response.json({ slug: "solo" }));
  const response = await visit("/about");
  assert.equal(forwardedHeaders(response).get("x-store-slug"), "solo");
  assert.equal(new URL(response.headers.get("x-middleware-rewrite") ?? "").pathname, "/solo/about");
});
