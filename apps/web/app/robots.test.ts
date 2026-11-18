import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

// A store subdomain of a platform instance, read without a request.
mock.module("next/headers", {
  namedExports: { headers: async () => new Headers({ "x-forwarded-proto": "https" }) },
});
mock.module("next/server", { namedExports: { connection: async () => {} } });
mock.module("@/lib/util.storefront-host", {
  namedExports: {
    isStorefrontHost: async () => true,
    getRequestHost: async () => "shop.louez.io",
  },
});

afterEach(() => {
  delete process.env.LOUEZ_SEARCH_INDEXING;
});

test("without the switch, a storefront's robots.txt allows crawling and names its sitemap", async () => {
  const { default: robots } = await import("./robots");
  const result = await robots();
  assert.equal(result.sitemap, "https://shop.louez.io/sitemap.xml");
  assert.ok(Array.isArray(result.rules));
  const everyone = result.rules.find((rule) => rule.userAgent === "*");
  assert.equal(everyone?.allow, "/");
});

test("a storefront's robots.txt names AI crawlers, allowed with the same private paths", async () => {
  const { default: robots } = await import("./robots");
  const result = await robots();
  assert.ok(Array.isArray(result.rules));
  const [ai, everyone] = result.rules;
  assert.ok(Array.isArray(ai.userAgent));
  for (const token of ["GPTBot", "OAI-SearchBot", "ClaudeBot", "PerplexityBot", "Google-Extended"]) {
    assert.ok(ai.userAgent.includes(token), token);
  }
  assert.equal(ai.allow, "/");
  assert.deepEqual(ai.disallow, everyone.disallow);
});

test("with LOUEZ_SEARCH_INDEXING=off, robots.txt disallows everything and names no sitemap", async () => {
  process.env.LOUEZ_SEARCH_INDEXING = "off";
  const { default: robots } = await import("./robots");
  assert.deepEqual(await robots(), { rules: { userAgent: "*", disallow: "/" } });
});
