"use client";

import { useCallback } from "react";

import type { StockQuantityLimit } from "@louez/utils";

import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";

import type { ProductPageProduct } from "@/lib/storefront/product-page.loader";
import type { AccessoryLink } from "@/lib/storefront/storefront.types";
import {
  buildRequiredAccessoryCartInputs,
  selectOptionalAccessories,
} from "@/lib/utils/cart-required-accessories";
import { type CartLineInput, toCartLineInput } from "@/lib/utils/util.cart-line-input";

import { useAnalytics } from "@/contexts/analytics-context";
import { useCartActions, useCartDrawer } from "@/contexts/cart-context";

export interface AddToCartSelection {
  period: RentalPeriodValue;
  quantity: number;
  maxQuantity: StockQuantityLimit;
  /** The values chosen; an axis left open stays open, for the store to pick. */
  selectedAttributes: Record<string, string>;
  /** Optional accessories the customer ticked. */
  extraIds: ReadonlySet<string>;
}

interface UseAddToCartOptions {
  product: ProductPageProduct;
  accessories: AccessoryLink[];
  openDrawer?: boolean;
}

/**
 * Turns the booking panel's selection into cart lines: one line for the
 * selection as chosen (line identity is `productId + selection`), the
 * required accessories riding along, one line per ticked extra. The period
 * becomes the cart's period before the lines land, so every line is priced
 * on it; the drawer then opens.
 */
export const useAddToCart = ({ product, accessories, openDrawer = true }: UseAddToCartOptions) => {
  const { addItem, setPeriod, setPricingMode } = useCartActions();
  const drawer = useCartDrawer();
  const { trackEvent } = useAnalytics();

  return useCallback(
    (selection: AddToCartSelection): void => {
      const lineProduct = { ...product, accessories };
      const lines: CartLineInput[] = [
        toCartLineInput(lineProduct, {
          quantity: selection.quantity,
          maxQuantity: selection.maxQuantity === null ? null : Math.max(1, selection.maxQuantity),
          selectedAttributes: selection.selectedAttributes,
          requiredAccessories: buildRequiredAccessoryCartInputs(accessories),
        }),
      ];

      for (const extra of selectOptionalAccessories(accessories)) {
        if (selection.extraIds.has(extra.id)) {
          lines.push(
            toCartLineInput(extra, {
              quantity: 1,
              maxQuantity: extra.quantity,
              requiredAccessories: [],
            }),
          );
        }
      }

      const startDate = selection.period.start.toISOString();
      const endDate = selection.period.end.toISOString();
      setPeriod(startDate, endDate);
      setPricingMode(product.pricingMode);
      for (const line of lines) {
        addItem(line, { startDate, endDate });
      }

      trackEvent({
        eventType: "add_to_cart",
        metadata: {
          productId: product.id,
          quantity: selection.quantity,
          startDate,
          endDate,
          extras: [...selection.extraIds],
        },
      });
      if (openDrawer) drawer.open();
    },
    [accessories, addItem, drawer, openDrawer, product, setPeriod, setPricingMode, trackEvent],
  );
};
