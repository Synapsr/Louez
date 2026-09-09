"use client";

import { ProductGrid } from "@/components/storefront/product/product-grid";
import { useProductCardAvailability } from "@/components/storefront/product/use-product-card-availability";
import { useCartState } from "@/contexts/cart-context";
import type { StorefrontCatalogProduct } from "@/lib/storefront/storefront.types";

interface HomeProductGridProps {
  products: StorefrontCatalogProduct[];
}

/**
 * The featured products of the home page, on the cart's period. The home
 * page carries no dates of its own, so the period the visitor picked in the
 * hero (or in the header) is what the cards price, badge and quick add on;
 * without dates they behave like the catalog does and lead to the product
 * page.
 */
export const HomeProductGrid = ({ products }: HomeProductGridProps) => {
  const { period } = useCartState();
  const availabilityByProductId = useProductCardAvailability(products, period);

  return (
    <ProductGrid
      products={products}
      period={period}
      availabilityByProductId={availabilityByProductId}
    />
  );
};
