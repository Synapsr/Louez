"use client";

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

  return (
    <ul className={cn(productGridClassName, className)} data-slot="product-grid">
      {products.map((product, index) => {
        const availability = availabilityByProductId?.get(product.id) ?? null;
        const quickAddLimit = getQuickAddLimit(product, availability);

        return (
          <li key={product.id} className="flex">
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
