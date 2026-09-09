"use client";

import { useCallback, useMemo } from "react";

import { useSearchParams } from "next/navigation";

import { useStorefrontBasePath } from "@/contexts/store-context";
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

export const useCatalogParams = (): CatalogParams => {
  const searchParams = useSearchParams();
  const basePath = useStorefrontBasePath() ?? "";
  const filters = useMemo(() => readCatalogFilters(searchParams), [searchParams]);

  const update = useCallback(
    (patch: CatalogFiltersPatch) => {
      const next = applyCatalogParams(new URLSearchParams(window.location.search), patch);
      window.history.replaceState(
        null,
        "",
        resolveStorefrontHref(basePath, buildCatalogHref(next)),
      );
    },
    [basePath],
  );

  return { filters, update };
};
