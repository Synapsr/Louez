import "server-only";

import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";

import { and, eq, or } from "drizzle-orm";

import { db, products } from "@louez/db";

import { getStorefrontUrl } from "@/lib/storefront-url";
import { loadCatalogCategories } from "@/lib/storefront/catalog.queries";
import {
  buildCategorySlugPath,
  buildProductSlugPath,
  parseStorefrontPath,
} from "@/lib/storefront/util.legacy-storefront-url";

/** The active product a URL segment (slug or id) points at, or null. */
const readProductSlug = cache(async (storeId: string, ref: string) =>
  db.query.products.findFirst({
    columns: { slug: true },
    where: and(
      or(eq(products.slug, ref), eq(products.id, ref)),
      eq(products.storeId, storeId),
      eq(products.status, "active"),
    ),
  }),
);

/**
 * Answers a real 308 for a product or category still addressed by id, so
 * search engines move to the slug URL, and a real 404 for a product that is
 * gone, so stale URLs drop out of the index. Must run before anything
 * streams — from the store layout, ahead of its Suspense boundary — because
 * a redirect or a not-found thrown once the shell is on the wire only
 * becomes a meta refresh or a 200 shell. Pages keep their own redirect and
 * not-found as a fallback for hosts the proxy does not annotate.
 */
export const redirectLegacyStorefrontUrl = async (
  store: { id: string; slug: string },
  path: string | null,
): Promise<void> => {
  const target = path ? parseStorefrontPath(path) : null;
  if (!target) return;

  if (target.kind === "product") {
    const product = await readProductSlug(store.id, target.ref);
    if (!product) notFound();
    if (product.slug && product.slug !== target.ref) {
      permanentRedirect(
        getStorefrontUrl(store.slug, buildProductSlugPath(product.slug, target.search)),
      );
    }
    return;
  }

  const { categories } = await loadCatalogCategories(store.id);
  const category = categories.find(
    (entry) => entry.slug === target.categoryToken || entry.id === target.categoryToken,
  );
  if (category?.slug && category.slug !== target.categoryToken) {
    permanentRedirect(getStorefrontUrl(store.slug, buildCategorySlugPath(category, target.search)));
  }
};
