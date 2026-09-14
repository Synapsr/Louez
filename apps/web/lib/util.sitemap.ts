import type { MetadataRoute } from "next";

export interface SitemapStore {
  slug: string;
  updatedAt?: Date | null;
  /** Whether the store wrote its own terms; the placeholder page is not indexable. */
  hasTerms: boolean;
}

export interface SitemapProduct {
  id: string;
  /** URL segment; the id stands in for rows predating slugs. */
  slug?: string | null;
  updatedAt?: Date | null;
}

export interface SitemapCategory {
  id: string;
  slug?: string | null;
  /** A category with nothing to rent renders an empty catalog. */
  productCount: number;
}

export interface SitemapInput {
  store: SitemapStore;
  products: readonly SitemapProduct[];
  categories: readonly SitemapCategory[];
  /** Canonical URL of a store path, see `getCanonicalUrl`. */
  canonicalUrl: (slug: string, path?: string) => string;
}

const latestDate = (dates: readonly (Date | null | undefined)[]): Date | undefined =>
  dates.reduce<Date | undefined>(
    (latest, date) => (date && (!latest || date > latest) ? date : latest),
    undefined,
  );

/**
 * The URLs of one storefront, in the order a crawler should care about
 * them: home, catalog, categories, products, then the information and
 * legal pages. Pure, so the shape is testable without a database.
 */
export const buildStoreSitemap = ({
  store,
  products,
  categories,
  canonicalUrl,
}: SitemapInput): MetadataRoute.Sitemap => {
  const url = (path?: string) => canonicalUrl(store.slug, path);
  const lastProductUpdate = latestDate(products.map((product) => product.updatedAt));
  const storeUpdate = store.updatedAt ?? undefined;
  const catalogUpdate = lastProductUpdate ?? storeUpdate;

  return [
    { url: url(), lastModified: catalogUpdate, changeFrequency: "weekly", priority: 1 },
    { url: url("/catalog"), lastModified: catalogUpdate, changeFrequency: "daily", priority: 0.9 },
    ...categories
      .filter((category) => category.productCount > 0)
      .map((category) => ({
        url: url(`/catalog?category=${encodeURIComponent(category.slug ?? category.id)}`),
        lastModified: catalogUpdate,
        changeFrequency: "weekly" as const,
        priority: 0.8,
      })),
    ...products.map((product) => ({
      url: url(`/product/${product.slug ?? product.id}`),
      lastModified: product.updatedAt ?? undefined,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    { url: url("/about"), lastModified: storeUpdate, changeFrequency: "monthly", priority: 0.6 },
    { url: url("/contact"), lastModified: storeUpdate, changeFrequency: "monthly", priority: 0.5 },
    ...(store.hasTerms
      ? [{ url: url("/terms"), changeFrequency: "yearly" as const, priority: 0.2 }]
      : []),
    { url: url("/legal"), changeFrequency: "yearly", priority: 0.2 },
  ];
};
