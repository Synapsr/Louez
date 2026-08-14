"use client";

import { useRouter } from "next/navigation";

import {
  ALL_CATEGORIES_VALUE,
  type CategoryBrowseEntry,
  CategoryBrowseGrid,
} from "@/components/storefront/category-browse-grid";

import { useStorefrontUrl } from "@/hooks/use-storefront-url";

interface HomeCategoryBrowseProps {
  entries: CategoryBrowseEntry[];
  storeSlug: string;
}

/**
 * Homepage entry point for "categories" browse mode.
 *
 * The cards are built on the server (no dates are selected here, so there is no
 * availability to compute); this wrapper only exists to turn the grid's
 * `onSelect` callback into a catalog navigation.
 */
export function HomeCategoryBrowse({ entries, storeSlug }: HomeCategoryBrowseProps) {
  const router = useRouter();
  const { getUrl } = useStorefrontUrl(storeSlug);

  const handleSelect = (categoryId: string) => {
    // "all" is the plain catalog; every other value — real ids and the reserved
    // "uncategorized" — is handled by the catalog's `?category=` filter.
    const path =
      categoryId === ALL_CATEGORIES_VALUE
        ? "/catalog"
        : `/catalog?category=${encodeURIComponent(categoryId)}`;

    router.push(getUrl(path));
  };

  return (
    <CategoryBrowseGrid
      entries={entries}
      isAvailabilityLoading={false}
      showTotalsOnly
      showTitle={false}
      onSelect={handleSelect}
    />
  );
}
