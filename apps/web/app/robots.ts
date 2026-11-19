import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";

import { AI_ROBOTS_TOKENS } from "@louez/api/contracts/ai-visibility";

import { isSearchIndexingEnabled } from "@/lib/search-indexing";
import { isLoopbackHost } from "@/lib/util.host";
import { getRequestHost, isStorefrontHost } from "@/lib/util.storefront-host";

// Paths that hold nothing indexable. Storefront funnels (customer sessions,
// checkout, one-shot links) leak funnel URLs into search results; the
// dashboard/auth surface shares the host in standalone mode, so it must be
// listed here too — the platform dashboard host gets a disallow-all instead.
// Product images (/files/…) stay crawlable on purpose.
const PRIVATE_PATHS = [
  "/api/",
  // Storefront funnels (/checkout also covers /checkout/return,
  // /checkout/paid and /checkout/cancelled; /confirmation/{id} is a redirect to /account)
  "/account",
  "/checkout",
  "/pay/",
  "/authorize-deposit/",
  "/confirmation/",
  "/r/",
  "/review",
  "/embed",
  // Dashboard/auth surface (path-routed in standalone mode)
  "/dashboard",
  "/login",
  "/register",
  "/onboarding",
  "/invitation",
  "/multi-store",
  "/admin",
];

// The public REST API reference and its OpenAPI document
// (app/api/v1/[[...path]]/route.ts). Indexed on the app's host only, never
// once per storefront.
const API_REFERENCE_PATHS = ["/api/v1/docs", "/api/v1/openapi.json"];

export default async function robots(): Promise<MetadataRoute.Robots> {
  // Read at request time, so the prebuilt image honors LOUEZ_SEARCH_INDEXING.
  await connection();
  // A staging instance: nothing to crawl, and no sitemap to point at.
  if (!isSearchIndexingEnabled()) {
    return {
      rules: { userAgent: "*", disallow: "/" },
    };
  }

  // Dashboard, www and apex hosts: private application surface, and on a
  // platform deployment the dashboard also mirrors every storefront under
  // /{slug}. Keep the whole host out of the index, but for the API reference
  // (the longest matching rule wins).
  if (!(await isStorefrontHost())) {
    return {
      rules: { userAgent: "*", allow: API_REFERENCE_PATHS, disallow: "/" },
    };
  }

  const headerStore = await headers();
  const host = await getRequestHost();
  const forwardedProtocol = headerStore.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol || (isLoopbackHost(host.split(":")[0]) ? "http" : "https");

  return {
    rules: [
      // AI assistants' crawlers, named so a store reads as open to them: a
      // crawler follows its own group only, hence the same private paths.
      // Counted in « Se faire connaître » (docs/product/visibilite-boutiques.md).
      { userAgent: [...AI_ROBOTS_TOKENS], allow: "/", disallow: PRIVATE_PATHS },
      { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
    ],
    sitemap: `${protocol}://${host}/sitemap.xml`,
  };
}
