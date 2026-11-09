import assert from "node:assert/strict";
import test from "node:test";

import { productLinks, storeLinks } from "@louez/api/platform/links";

// `@/env` reads the process environment once, at import: a platform
// deployment here, local path routing in urls.localhost.test.ts.
process.env.SKIP_ENV_VALIDATION = "true";
process.env.NEXT_PUBLIC_APP_DOMAIN = "louez.test";
process.env.NEXT_PUBLIC_APP_URL = "https://app.louez.test/";
process.env.LOUEZ_MODE = "platform";

const load = async () => (await import("./urls")).apiUrls;

const online = { id: "s1", slug: "ddm", onboardingCompleted: true };
const kayak = { id: "p1", slug: "kayak", status: "active" };

test("platform: the dashboard is on the app URL, the storefront on the store's subdomain", async () => {
  const urls = await load();
  assert.deepEqual(productLinks(urls, online, kayak), {
    dashboard: "https://app.louez.test/dashboard/products/p1?store=s1",
    storefront: "https://ddm.louez.test/product/kayak",
  });
  assert.deepEqual(storeLinks(urls, online), {
    dashboard: "https://app.louez.test/dashboard?store=s1",
    storefront: "https://ddm.louez.test",
  });
});

test("standalone: the storefront is the app URL's root, without the slug", async () => {
  const urls = await load();
  const previous = process.env.LOUEZ_MODE;
  process.env.LOUEZ_MODE = "standalone";
  try {
    assert.deepEqual(productLinks(urls, online, kayak), {
      dashboard: "https://app.louez.test/dashboard/products/p1?store=s1",
      storefront: "https://app.louez.test/product/kayak",
    });
  } finally {
    process.env.LOUEZ_MODE = previous;
  }
});

test("an inactive product, or a store in onboarding, links the dashboard only", async () => {
  const urls = await load();
  assert.deepEqual(productLinks(urls, online, { ...kayak, status: "draft" }), {
    dashboard: "https://app.louez.test/dashboard/products/p1?store=s1",
  });
  assert.deepEqual(
    productLinks(urls, { id: "s1", slug: "ddm", onboardingCompleted: false }, kayak),
    {
      dashboard: "https://app.louez.test/dashboard/products/p1?store=s1",
    },
  );
});
