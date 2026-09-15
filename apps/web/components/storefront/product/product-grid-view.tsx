"use client";
import { cn } from "@louez/utils";
import type { StorefrontCatalogProduct } from "@/lib/storefront/storefront.types";
import { ProductCard } from "./product-card";
import { productGridClassName } from "./product-grid.constants";
import {
  type ProductCardAvailability,
  type ProductCardPeriod,
  buildProductHref,
  getQuickAddLimit,
} from "./util.product-card";
export const PRODUCT_GRID_PRIORITY_COUNT = 4;
export interface ProductGridViewProps {
  products: StorefrontCatalogProduct[];
  /** Period the visitor is browsing: cards price it, link with it and add on it. */
  period?: ProductCardPeriod | null;
  /** Server availability per product id, for the period. */
  availabilityByProductId?: ReadonlyMap<string, ProductCardAvailability>;
  className?: string;
  onQuickAdd: (
    product: StorefrontCatalogProduct,
    limit: number | null,
    period: ProductCardPeriod | null,
  ) => void;
  getProductHref?: (product: StorefrontCatalogProduct) => string;
  onProductHover?: (product: StorefrontCatalogProduct, limit: number | null | undefined) => void;
  onProductLeave?: () => void;
  onProductFocus?: (product: StorefrontCatalogProduct, limit: number | null | undefined) => void;
}

export const ProductGridView = ({
  products,
  period,
  availabilityByProductId,
  className,
  onQuickAdd,
  getProductHref,
  onProductHover,
  onProductLeave,
  onProductFocus,
}: ProductGridViewProps) => {
  return (
    <ul className={cn(productGridClassName, className)} data-slot="product-grid">
      {products.map((product, index) => {
        const availability = availabilityByProductId?.get(product.id) ?? null;
        const quickAddLimit = getQuickAddLimit(product, availability);

        return (
          <li
            key={product.id}
            className="flex"
            data-product-id={product.id}
            onMouseEnter={() => onProductHover?.(product, quickAddLimit)}
            onMouseLeave={onProductLeave}
            onFocus={() => onProductFocus?.(product, quickAddLimit)}
          >
            <ProductCard
              product={product}
              href={getProductHref ? getProductHref(product) : buildProductHref(product, period)}
              period={period}
              availability={availability}
              priority={index < PRODUCT_GRID_PRIORITY_COUNT}
              onQuickAdd={
                quickAddLimit !== undefined
                  ? () => onQuickAdd(product, quickAddLimit, period ?? null)
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
