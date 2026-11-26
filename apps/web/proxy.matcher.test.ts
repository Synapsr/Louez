import assert from "node:assert/strict";
import { before, test } from "node:test";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";

process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
process.env.NEXT_PUBLIC_APP_DOMAIN = "example.com";
process.env.LOUEZ_MODE = "platform";

let proxy: typeof import("./proxy").proxy;
let config: typeof import("./proxy").config;
before(async () => {
  ({ proxy, config } = await import("./proxy"));
});

const visit = (path: string) =>
  proxy(
    new NextRequest(`https://app.example.com${path}`, {
      headers: { host: "app.example.com", "x-store-slug": "forged" },
    }),
  );

test("Next's compiled matcher excludes only the API and internal asset segments", () => {
  for (const url of ["/api", "/api/health", "/_next/static/a.js", "/_next/image", "/favicon.ico"]) {
    assert.equal(unstable_doesMiddlewareMatch({ config, url }), false, url);
  }
});

test("Next's compiled matcher routes prefix-sharing paths through header sanitization", async () => {
  for (const path of [
    "/api-bikes/about",
    "/api-bikes/embed",
    "/ingest-shop/about",
    "/favicon.ico-shop/about",
    "/_next/static-shop/about",
    "/_next/image-shop/about",
    "/faviconXico",
  ]) {
    assert.equal(unstable_doesMiddlewareMatch({ config, url: path }), true, path);
    const response = await visit(path);
    assert.ok(response.headers.get("x-middleware-override-headers")?.split(",").includes("host"));
    assert.equal(response.headers.get("x-middleware-request-x-store-slug"), null, path);
  }
});

test("API and ingest pass-through uses complete segments, not storefront slug prefixes", async () => {
  for (const path of ["/api", "/api/health", "/ingest", "/ingest/batch"]) {
    const response = await visit(path);
    assert.equal(response.headers.get("x-middleware-rewrite"), null, path);
    assert.equal(response.headers.get("content-security-policy"), null, path);
  }
  for (const path of ["/api-bikes/about", "/api-bikes/embed", "/ingest-shop/about"]) {
    assert.ok((await visit(path)).headers.get("content-security-policy"), path);
  }
});
