"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { startOfMonth } from "date-fns";

import { useRentalDateCore } from "@/components/storefront/date-picker/core/use-rental-date-core";
import { buildCalendarAvailabilityCandidates } from "@/components/storefront/date-picker/util.calendar-availability";
import { useStorePeriodRules } from "@/contexts/store-context";
import { useCartState } from "@/contexts/cart-context";
import { useMediaQuery } from "@/hooks/use-media-query";
import { storefrontQueries } from "@/lib/queries/storefront.queries";

import { cn } from "@louez/utils";

import type { StorefrontCatalogProduct } from "@/lib/storefront/storefront.types";

import { ProductCard } from "./product-card";
import { productGridClassName } from "./product-grid.constants";
import { useQuickAdd } from "./quick-add-provider";
import {
  type ProductCardAvailability,
  type ProductCardPeriod,
  buildProductHref,
  getQuickAddLimit,
} from "./util.product-card";

/** Cards that get `priority`: the first row or two, above the fold. */
export const PRODUCT_GRID_PRIORITY_COUNT = 4;

interface ProductGridProps {
  products: StorefrontCatalogProduct[];
  /** Period the visitor is browsing: cards price it, link with it and add on it. */
  period?: ProductCardPeriod | null;
  /** Server availability per product id, for the period. */
  availabilityByProductId?: ReadonlyMap<string, ProductCardAvailability>;
  className?: string;
}

/**
 * One grid for the home page, the catalog and related products. Every
 * bookable product gets a quick add; what the add still needs (dates, a
 * variant, extras) is asked by the dialog the `QuickAddProvider` holds.
 */
export const ProductGrid = ({
  products,
  period,
  availabilityByProductId,
  className,
}: ProductGridProps) => {
  const quickAdd = useQuickAdd();
  const queryClient = useQueryClient();
  const rules = useStorePeriodRules();
  const { period: cartPeriod } = useCartState();
  const isDesktop = useMediaQuery("(min-width: 640px)");
  const core = useRentalDateCore({
    ...rules,
    minRentalMinutes: rules.minRentalMinutes ?? 60,
  });
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPrefetch = () => {
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };
  useEffect(
    () => () => {
      if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
    },
    [],
  );
  const prefetchDates = (productId: string) => {
    if (period || cartPeriod) return;
    const candidates = buildCalendarAvailabilityCandidates({
      core,
      rules,
      month: startOfMonth(core.minDate),
      months: isDesktop ? 2 : 1,
    });
    if (candidates.length === 0) return;
    void queryClient.prefetchQuery(
      storefrontQueries.calendar({
        productId,
        periods: candidates.map(({ startDate, endDate }) => ({ startDate, endDate })),
      }),
    );
  };

  return (
    <ul className={cn(productGridClassName, className)} data-slot="product-grid">
      {products.map((product, index) => {
        const availability = availabilityByProductId?.get(product.id) ?? null;
        const quickAddLimit = getQuickAddLimit(product, availability);

        return (
          <li
            key={product.id}
            className="flex"
            onMouseEnter={() => {
              cancelPrefetch();
              if (quickAddLimit !== undefined) {
                hoverTimer.current = setTimeout(() => prefetchDates(product.id), 150);
              }
            }}
            onMouseLeave={cancelPrefetch}
            onFocus={() => {
              cancelPrefetch();
              if (quickAddLimit !== undefined) prefetchDates(product.id);
            }}
          >
            <ProductCard
              product={product}
              href={buildProductHref(product.id, period)}
              period={period}
              availability={availability}
              priority={index < PRODUCT_GRID_PRIORITY_COUNT}
              onQuickAdd={
                quickAddLimit !== undefined
                  ? () => quickAdd.start(product, quickAddLimit, period ?? null)
                  : undefined
              }
              className="w-full"
            />
          </li>
        );
      })}
    </ul>
  );
};
