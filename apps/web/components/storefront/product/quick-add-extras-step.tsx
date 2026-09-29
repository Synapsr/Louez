"use client";

import { useMemo } from "react";
import { useCartActions, useCartState } from "@/contexts/cart-context";
import type { StorefrontCatalogProduct } from "@/lib/storefront/storefront.types";
import { toCartLineInput } from "@/lib/utils/util.cart-line-input";
import type { ProductCardPeriod } from "./util.product-card";
import { QuickAddExtrasStepView } from "./quick-add-extras-step-view";

interface QuickAddExtrasStepProps {
  product: StorefrontCatalogProduct;
  period: ProductCardPeriod | null;
  quantity?: number;
  onDone: () => void;
}

export const QuickAddExtrasStep = ({
  product,
  period,
  quantity = 1,
  onDone,
}: QuickAddExtrasStepProps) => {
  const { addItem } = useCartActions();
  const { items, period: cartPeriod } = useCartState();
  const cartProductIds = useMemo(
    () => new Set(items.map((item) => item.productId).filter((id) => id !== product.id)),
    [items, product.id],
  );
  return (
    <QuickAddExtrasStepView
      product={product}
      period={period}
      quantity={quantity}
      onDone={onDone}
      cartProductIds={cartProductIds}
      onAddExtras={(extras) => {
        const startDate = period?.startDate ?? cartPeriod?.startDate;
        const endDate = period?.endDate ?? cartPeriod?.endDate;
        if (!startDate || !endDate) return;
        for (const extra of extras) {
          addItem(
            toCartLineInput(extra, {
              quantity: 1,
              maxQuantity: extra.quantity,
              requiredAccessories: [],
            }),
            { startDate, endDate },
          );
        }
      }}
    />
  );
};
