"use client";

import { useMemo } from "react";

import {
  debounce,
  parseAsArrayOf,
  parseAsString,
  parseAsStringLiteral,
  useQueryStates,
} from "nuqs";

import { ProductsFiltersView } from "./products-filters-view";

import {
  type CategoryFilterOption,
} from "./category-filter-combobox";
import {
  PRODUCT_STATUS_FILTERS,
  type ProductCounts,
  type ProductStatusFilter,
} from "./types";

/**
 * Products list filters, kept in the URL so links stay shareable.
 *
 * `category` holds a comma-separated list of ids (nuqs' array format), which
 * keeps older single-category links (`?category=<id>`) working.
 * Navigation is shallow: the list itself is refetched by React Query.
 *
 * `search` updates the state on every keystroke so the input stays responsive,
 * but only writes the URL once typing pauses. Callers debounce the fetch.
 */
export function useProductsFilters() {
  const [state, setFilters] = useQueryStates(
    {
      status: parseAsStringLiteral(PRODUCT_STATUS_FILTERS).withDefault("all"),
      category: parseAsArrayOf(parseAsString).withDefault([]),
      search: parseAsString.withDefault(""),
    },
    { history: "push", shallow: true, clearOnDefault: true },
  );

  // `all` is the legacy "no category filter" value of the former single select
  const categoryIds = useMemo(
    () => state.category.filter((id) => id && id !== "all"),
    [state.category],
  );

  return {
    status: state.status,
    categoryIds,
    search: state.search,
    setStatus: (status: ProductStatusFilter) => void setFilters({ status }),
    setCategoryIds: (category: string[]) => void setFilters({ category }),
    // Typing replaces the history entry instead of pushing one per word
    setSearch: (search: string) =>
      void setFilters(
        { search },
        search ? { history: "replace", limitUrlUpdates: debounce(300) } : { history: "replace" },
      ),
  };
}

interface ProductsFiltersProps {
  categories: CategoryFilterOption[];
  counts: ProductCounts;
  isLoadingCategories?: boolean;
}

export const ProductsFilters = ({ categories, counts, isLoadingCategories }: ProductsFiltersProps) => {
  const filters = useProductsFilters();
  return <ProductsFiltersView categories={categories} counts={counts} isLoadingCategories={isLoadingCategories} {...filters} />;
};
