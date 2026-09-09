"use client";

import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";

import { storefrontQueries } from "@/lib/queries/storefront.queries";
import type { StorefrontCatalogProduct } from "@/lib/storefront/storefront.types";

import {
  type ProductCardAvailability,
  type ProductCardPeriod,
  toProductCardAvailability,
} from "./util.product-card";

const EMPTY_PERIOD: ProductCardPeriod = { startDate: "", endDate: "" };

/**
 * Availability of a grid's products for the browsed period, as the cards
 * show it. Empty without dates or while the server answers: the cards then
 * fall back to plain stock. Grids browsing the same period share one query,
 * so the catalog and the home page ask for it once.
 */
export const useProductCardAvailability = (
  products: readonly StorefrontCatalogProduct[],
  period: ProductCardPeriod | null,
): ReadonlyMap<string, ProductCardAvailability> => {
  const { data } = useQuery({
    ...storefrontQueries.availability(period ?? EMPTY_PERIOD),
    enabled: period !== null,
  });

  return useMemo(() => {
    const map = new Map<string, ProductCardAvailability>();
    if (!data) return map;

    const byProductId = new Map(data.products.map((entry) => [entry.productId, entry]));
    for (const product of products) {
      const entry = byProductId.get(product.id);
      if (!entry) continue;
      map.set(
        product.id,
        toProductCardAvailability({
          product,
          availableQuantity: entry.availableQuantity,
          reason: entry.reason,
        }),
      );
    }
    return map;
  }, [data, products]);
};
