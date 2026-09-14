"use client";

import { useCallback } from "react";

import type { BookingAttributeAxis, CombinationAvailability } from "@louez/types";
import { allocateAcrossCombinations, type StockQuantityLimit } from "@louez/utils";

import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";

import type { ProductPageProduct } from "@/lib/storefront/product-page.loader";
import type { AccessoryLink } from "@/lib/storefront/storefront.types";
import { pickActiveVariantAttributes } from "@/lib/util.variant-visibility";
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
  selectedAttributes: Record<string, string>;
  /** `split` spreads a partial selection over the matching combinations, one line each. */
  allocationMode: "single" | "split";
  combinations: CombinationAvailability[];
  /** Optional accessories the customer ticked. */
  extraIds: ReadonlySet<string>;
}

export type AddToCartResult = { ok: true } | { ok: false; reason: "selection_unavailable" };

interface UseAddToCartOptions {
  product: ProductPageProduct;
  accessories: AccessoryLink[];
  axes: BookingAttributeAxis[];
  openDrawer?: boolean;
}

/**
 * Turns the booking panel's selection into cart lines: one line per
 * allocated combination (line identity is `productId + selection`), the
 * required accessories riding along, one line per ticked extra. The period
 * becomes the cart's period before the lines land, so every line is priced
 * on it; the drawer then opens.
 */
export const useAddToCart = ({
  product,
  accessories,
  axes,
  openDrawer = true,
}: UseAddToCartOptions) => {
  const { addItem, setPeriod, setPricingMode } = useCartActions();
  const drawer = useCartDrawer();
  const { trackEvent } = useAnalytics();

  return useCallback(
    (selection: AddToCartSelection): AddToCartResult => {
      const lineProduct = { ...product, accessories };
      const requiredAccessories = buildRequiredAccessoryCartInputs(accessories);
      const lines: CartLineInput[] = [];

      if (axes.length > 0 && selection.allocationMode === "split") {
        const allocations = allocateAcrossCombinations(
          axes,
          selection.combinations,
          selection.selectedAttributes,
          selection.quantity,
        );
        if (!allocations || allocations.length === 0) {
          return { ok: false, reason: "selection_unavailable" };
        }
        for (const allocation of allocations) {
          lines.push(
            toCartLineInput(lineProduct, {
              quantity: allocation.quantity,
              maxQuantity: Math.max(1, allocation.combination.availableQuantity || 0),
              selectedAttributes: pickActiveVariantAttributes(
                axes,
                allocation.combination.selectedAttributes,
              ),
              requiredAccessories,
            }),
          );
        }
      } else {
        lines.push(
          toCartLineInput(lineProduct, {
            quantity: selection.quantity,
            maxQuantity: selection.maxQuantity === null ? null : Math.max(1, selection.maxQuantity),
            selectedAttributes: selection.selectedAttributes,
            requiredAccessories,
          }),
        );
      }

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

      return { ok: true };
    },
    [
      accessories,
      addItem,
      axes,
      drawer,
      openDrawer,
      product,
      setPeriod,
      setPricingMode,
      trackEvent,
    ],
  );
};
