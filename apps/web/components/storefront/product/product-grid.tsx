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

import type { StorefrontCatalogProduct } from "@/lib/storefront/storefront.types";

import { ProductGridView } from "./product-grid-view";
export { PRODUCT_GRID_PRIORITY_COUNT } from "./product-grid-view";
import { useQuickAdd } from "./quick-add-provider";
import { type ProductCardAvailability, type ProductCardPeriod } from "./util.product-card";

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
    <ProductGridView
      products={products}
      period={period}
      availabilityByProductId={availabilityByProductId}
      className={className}
      onQuickAdd={(product, limit, selectedPeriod) =>
        quickAdd.start(product, limit, selectedPeriod)
      }
      onProductHover={(product, limit) => {
        cancelPrefetch();
        if (limit !== undefined)
          hoverTimer.current = setTimeout(() => prefetchDates(product.id), 150);
      }}
      onProductLeave={cancelPrefetch}
      onProductFocus={(product, limit) => {
        cancelPrefetch();
        if (limit !== undefined) prefetchDates(product.id);
      }}
    />
  );
};
