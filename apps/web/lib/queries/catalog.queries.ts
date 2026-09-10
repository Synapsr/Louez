import { createORPCReactQueryUtils } from "@orpc/react-query";

import {
  loadMoreCatalogProducts,
  type LoadMoreCatalogProductsInput,
} from "@/app/(storefront)/[slug]/catalog/actions";
import { DEFAULT_CATALOG_SORT } from "@/lib/storefront/catalog.constants";
import type { CatalogProductFilters } from "@/lib/storefront/catalog.queries";

const catalog = createORPCReactQueryUtils(
  { products: (input: LoadMoreCatalogProductsInput) => loadMoreCatalogProducts(input) },
  { path: ["storefront", "catalog"] },
);

export const catalogQueries = {
  key: () => catalog.key(),
  pages: (slug: string, filters: CatalogProductFilters) =>
    catalog.products.infiniteOptions({
      input: (cursor: string | null) => ({
        slug,
        category: filters.category ?? null,
        search: filters.search.trim(),
        minPrice: filters.minPrice ?? null,
        maxPrice: filters.maxPrice ?? null,
        quantity: filters.quantity ?? null,
        availableOnly: filters.availableOnly ?? true,
        attributes: Object.fromEntries(
          Object.entries(filters.attributes ?? {}).map(([axis, values]) => [
            axis,
            [...new Set(values)].sort(),
          ]),
        ),
        startDate: filters.startDate ?? null,
        endDate: filters.endDate ?? null,
        sort: filters.sort ?? DEFAULT_CATALOG_SORT,
        cursor,
      }),
      initialPageParam: null,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
    }),
};
