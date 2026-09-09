import type { CategoryBrowseEntry } from "@/components/storefront/category-browse-grid";
import {
  ALL_CATEGORIES_VALUE,
  MIN_BROWSABLE_CATEGORIES,
  UNCATEGORIZED_CATEGORY_VALUE,
} from "@/lib/storefront/catalog.constants";

export interface BrowseCategoryRow {
  id: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
}

/** One row per (active product, category) pair; `categoryId` is null for a product in no category. */
export interface BrowseProductLinkRow {
  productId: string;
  images: string[] | null;
  categoryId: string | null;
}

export interface CategoryBrowseLabels {
  others: string;
  othersDescription: string;
  all: string;
}

interface CategoryBucket {
  count: number;
  /** First product visual, in display order, for a category without an image. */
  imageUrl: string | null;
}

export interface CategoryBuckets {
  byCategoryId: Map<string, CategoryBucket>;
  uncategorized: CategoryBucket;
  productCount: number;
}

/** The catalog link of a tile: the plain catalog for "all", a `?category=` filter otherwise. */
export const buildCategoryBrowseHref = (categoryId: string): string =>
  categoryId === ALL_CATEGORIES_VALUE
    ? "/catalog"
    : `/catalog?category=${encodeURIComponent(categoryId)}`;

/** Sizes every bucket and remembers a visual for it. Rows must arrive in display order. */
export const bucketProductLinks = (rows: readonly BrowseProductLinkRow[]): CategoryBuckets => {
  const byCategoryId = new Map<string, CategoryBucket>();
  const uncategorized: CategoryBucket = { count: 0, imageUrl: null };
  const productIds = new Set<string>();

  for (const row of rows) {
    productIds.add(row.productId);
    const firstImage = row.images?.[0] ?? null;

    if (!row.categoryId) {
      uncategorized.count += 1;
      uncategorized.imageUrl ??= firstImage;
      continue;
    }

    const bucket = byCategoryId.get(row.categoryId);
    if (bucket) {
      bucket.count += 1;
      bucket.imageUrl ??= firstImage;
    } else {
      byCategoryId.set(row.categoryId, { count: 1, imageUrl: firstImage });
    }
  }

  return { byCategoryId, uncategorized, productCount: productIds.size };
};

interface BuildCategoryBrowseEntriesInput {
  categories: readonly BrowseCategoryRow[];
  productLinks: readonly BrowseProductLinkRow[];
  labels: CategoryBrowseLabels;
}

/**
 * Tiles of the home page in "categories" browse mode: one per populated
 * category, "Autres" when products belong to none, "Tous les produits" last,
 * each with its catalog link. Empty when fewer than two categories are
 * populated — a single tile is a detour, the product grid does better.
 */
export const buildCategoryBrowseEntries = ({
  categories,
  productLinks,
  labels,
}: BuildCategoryBrowseEntriesInput): CategoryBrowseEntry[] => {
  const buckets = bucketProductLinks(productLinks);

  const entries: CategoryBrowseEntry[] = [];
  for (const category of categories) {
    const bucket = buckets.byCategoryId.get(category.id);
    if (!bucket || bucket.count === 0) continue;
    entries.push({
      id: category.id,
      name: category.name,
      description: category.description ?? null,
      imageUrl: category.imageUrl || bucket.imageUrl,
      availableCount: bucket.count,
      totalCount: bucket.count,
      variant: "category",
      href: buildCategoryBrowseHref(category.id),
    });
  }

  if (entries.length < MIN_BROWSABLE_CATEGORIES) return [];

  if (buckets.uncategorized.count > 0) {
    entries.push({
      id: UNCATEGORIZED_CATEGORY_VALUE,
      name: labels.others,
      description: labels.othersDescription,
      imageUrl: buckets.uncategorized.imageUrl,
      availableCount: buckets.uncategorized.count,
      totalCount: buckets.uncategorized.count,
      variant: "uncategorized",
      href: buildCategoryBrowseHref(UNCATEGORIZED_CATEGORY_VALUE),
    });
  }

  entries.push({
    id: ALL_CATEGORIES_VALUE,
    name: labels.all,
    description: null,
    imageUrl: null,
    availableCount: buckets.productCount,
    totalCount: buckets.productCount,
    variant: "all",
    href: buildCategoryBrowseHref(ALL_CATEGORIES_VALUE),
  });

  return entries;
};
