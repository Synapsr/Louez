import type { MetadataRoute } from 'next';

import { and, asc, desc, eq } from 'drizzle-orm';

import { db, products } from '@louez/db';

import { getCanonicalUrl } from '@/lib/seo';
import { resolveStoreFromHost } from '@/lib/util.storefront-host';

// A storefront rarely holds more than a few hundred products, so a single
// sitemap is enough. Cap it well under the 50 000 URL limit anyway.
const MAX_PRODUCT_URLS = 5_000;

/**
 * Per-store sitemap, resolved from the incoming host.
 *
 * Product pages are not linked from any navigation menu, so without this file
 * crawlers only ever reach them through the catalog grid.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const store = await resolveStoreFromHost();

  if (!store) {
    return [];
  }

  const storeProducts = await db.query.products.findMany({
    columns: { id: true, updatedAt: true },
    where: and(
      eq(products.storeId, store.id),
      eq(products.status, 'active'),
    ),
    orderBy: [asc(products.displayOrder), desc(products.createdAt)],
    limit: MAX_PRODUCT_URLS,
  });

  const lastProductUpdate = storeProducts.reduce<Date | undefined>(
    (latest, product) =>
      product.updatedAt && (!latest || product.updatedAt > latest)
        ? product.updatedAt
        : latest,
    undefined,
  );

  return [
    {
      url: getCanonicalUrl(store.slug),
      lastModified: lastProductUpdate ?? store.updatedAt ?? undefined,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: getCanonicalUrl(store.slug, '/catalog'),
      lastModified: lastProductUpdate ?? store.updatedAt ?? undefined,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    ...storeProducts.map((product) => ({
      url: getCanonicalUrl(store.slug, `/product/${product.id}`),
      lastModified: product.updatedAt ?? undefined,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
    {
      url: getCanonicalUrl(store.slug, '/terms'),
      changeFrequency: 'yearly' as const,
      priority: 0.2,
    },
    {
      url: getCanonicalUrl(store.slug, '/legal'),
      changeFrequency: 'yearly' as const,
      priority: 0.2,
    },
  ];
}
