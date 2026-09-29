"use client";

import { useQuickAdd } from "@/components/storefront/product/quick-add-provider";
import { useCartState } from "@/contexts/cart-context";
import type { StorefrontCatalogProduct } from "@/lib/storefront/storefront.types";
import { RelatedProductsView } from "./related-products-view";

interface RelatedProductsProps {
  products: StorefrontCatalogProduct[];
  className?: string;
}

export const RelatedProducts = ({ products, className }: RelatedProductsProps) => {
  const { period } = useCartState();
  const quickAdd = useQuickAdd();
  return (
    <RelatedProductsView
      products={products}
      className={className}
      period={period}
      onQuickAdd={(product, limit) => quickAdd.start(product, limit, period)}
    />
  );
};
