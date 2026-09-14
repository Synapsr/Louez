import type { MetadataRoute } from "next";

import { and, asc, desc, eq } from "drizzle-orm";

import { db, products } from "@louez/db";

import { getCanonicalUrl } from "@/lib/seo";
import { loadCatalogCategories } from "@/lib/storefront/catalog.queries";
import { hasRichTextContent } from "@/lib/util.rich-text";
import { buildStoreSitemap } from "@/lib/util.sitemap";
import { resolveStoreFromHost } from "@/lib/util.storefront-host";

// A storefront rarely holds more than a few hundred products, so a single
// sitemap is enough. Cap it well under the 50 000 URL limit anyway.
const MAX_PRODUCT_URLS = 5_000;

/**
 * Per-store sitemap, resolved from the incoming host.
 *
 * Product pages are not linked from any navigation menu and category pages
 * only from the home tiles, so without this file crawlers only ever reach
 * them through the catalog grid.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const store = await resolveStoreFromHost();

  if (!store) {
    return [];
  }

  const [storeProducts, { categories }] = await Promise.all([
    db.query.products.findMany({
      columns: { id: true, slug: true, updatedAt: true },
      where: and(eq(products.storeId, store.id), eq(products.status, "active")),
      orderBy: [asc(products.displayOrder), desc(products.createdAt)],
      limit: MAX_PRODUCT_URLS,
    }),
    loadCatalogCategories(store.id),
  ]);

  return buildStoreSitemap({
    store: {
      slug: store.slug,
      updatedAt: store.updatedAt,
      hasTerms: hasRichTextContent(store.cgv),
    },
    products: storeProducts,
    categories,
    canonicalUrl: getCanonicalUrl,
  });
}
