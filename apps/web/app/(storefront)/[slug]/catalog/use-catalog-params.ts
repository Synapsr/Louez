"use client";

import { useCallback, useMemo } from "react";

import { useSearchParams } from "next/navigation";

import { useStorefrontBasePath } from "@/contexts/store-context";
import { isReservedCategoryValue } from "@/lib/storefront/catalog.constants";
import { resolveStorefrontHref } from "@/lib/util.storefront-href";
import {
  type CatalogFilters,
  type CatalogFiltersPatch,
  applyCatalogParams,
  buildCatalogHref,
  readCatalogFilters,
} from "@/lib/utils/util.rental-browse";

export interface CatalogParams {
  filters: CatalogFilters;
  update: (patch: CatalogFiltersPatch) => void;
}

interface CatalogParamsCategory {
  id: string;
  slug?: string | null;
}

/**
 * The URL says `?category=velos` (a slug, or an id on older links) while the
 * filters, the queries and the sidebar all speak in category ids. These two
 * translate at the boundary; a token matching no category passes through.
 */
const categoryTokenToId = (
  token: string | null,
  categories: readonly CatalogParamsCategory[],
): string | null => {
  if (!token || isReservedCategoryValue(token)) return token;
  return categories.find((entry) => entry.slug === token || entry.id === token)?.id ?? token;
};

const categoryIdToToken = (
  id: string | null | undefined,
  categories: readonly CatalogParamsCategory[],
): string | null | undefined => {
  if (!id || isReservedCategoryValue(id)) return id;
  const match = categories.find((entry) => entry.id === id);
  return match?.slug ?? id;
};

export const useCatalogParams = (categories: readonly CatalogParamsCategory[]): CatalogParams => {
  const searchParams = useSearchParams();
  const basePath = useStorefrontBasePath() ?? "";
  const filters = useMemo(() => {
    const read = readCatalogFilters(searchParams);
    return { ...read, category: categoryTokenToId(read.category, categories) };
  }, [searchParams, categories]);

  const update = useCallback(
    (patch: CatalogFiltersPatch) => {
      const urlPatch =
        "category" in patch
          ? { ...patch, category: categoryIdToToken(patch.category, categories) }
          : patch;
      const next = applyCatalogParams(new URLSearchParams(window.location.search), urlPatch);
      window.history.replaceState(
        null,
        "",
        resolveStorefrontHref(basePath, buildCatalogHref(next)),
      );
    },
    [basePath, categories],
  );

  return { filters, update };
};
