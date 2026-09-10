"use client";

import { useMemo } from "react";

import { isFixedPriceProduct } from "@louez/utils";

import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";

import type { ProductPageProduct } from "@/lib/storefront/product-page.loader";
import type { AccessoryLink } from "@/lib/storefront/storefront.types";
import { getEffectiveDiscountPercent } from "@/lib/utils/util.discount-visibility";
import {
  getStorefrontProductPrice,
  parseStorefrontDecimal,
} from "@/lib/utils/util.storefront-product-pricing";

import { useDiscountVisibility } from "@/contexts/store-context";

/** An accessory line the cart will carry alongside the product. */
export interface BookingExtra {
  accessory: AccessoryLink;
  /** Units of the accessory: `requiredQuantity × product quantity` for a required one. */
  quantity: number;
}

export interface BookingExtraPrice {
  id: string;
  name: string;
  quantity: number;
  /** Line amount for all `quantity` units. */
  amount: number;
}

export interface BookingPrice {
  /** True once the product can be priced: a forfait always, a rental once dates are set. */
  isPriced: boolean;
  /** Product lines only, discount applied. */
  subtotal: number;
  /** Product lines before the discount; equals `subtotal` when none is shown. */
  originalSubtotal: number;
  /** Whole percent to advertise, or `null` when nothing is shown (none, or above the store cap). */
  discountPercent: number | null;
  extras: BookingExtraPrice[];
  /** Product + extras, deposit excluded. */
  total: number;
  /** Hold on the card, never charged: `deposit × quantity`, extras' deposits included. */
  deposit: number;
}

interface UseBookingPriceOptions {
  product: ProductPageProduct;
  period: RentalPeriodValue | null;
  quantity: number;
  extras: BookingExtra[];
}

/**
 * Preview of what the cart will charge for the panel's selection, priced by
 * the cart's own engine so the panel, the drawer and the server agree. The
 * discount only shows when the store advertises it (display cap).
 */
export const useBookingPrice = ({
  product,
  period,
  quantity,
  extras,
}: UseBookingPriceOptions): BookingPrice => {
  const isDiscountVisible = useDiscountVisibility();

  return useMemo<BookingPrice>(() => {
    const isFixed = isFixedPriceProduct(product);
    const isPriced = isFixed || period !== null;
    // The cart holds every line's deposit, the required accessories' included.
    const deposit =
      (parseStorefrontDecimal(product.deposit) ?? 0) * quantity +
      extras.reduce(
        (sum, { accessory, quantity: extraQuantity }) =>
          sum + (parseStorefrontDecimal(accessory.deposit) ?? 0) * extraQuantity,
        0,
      );

    if (!isPriced) {
      return {
        isPriced,
        subtotal: 0,
        originalSubtotal: 0,
        discountPercent: null,
        extras: [],
        total: 0,
        deposit,
      };
    }

    const result = getStorefrontProductPrice({
      product,
      startDate: period?.start,
      endDate: period?.end,
      quantity,
    });
    const showsDiscount =
      result.savings > 0 && isDiscountVisible(getEffectiveDiscountPercent(result));
    const extraPrices = extras.map(({ accessory, quantity: extraQuantity }) => ({
      id: accessory.id,
      name: accessory.name,
      quantity: extraQuantity,
      amount: getStorefrontProductPrice({
        product: accessory,
        startDate: period?.start,
        endDate: period?.end,
        quantity: extraQuantity,
      }).subtotal,
    }));
    const extrasTotal = extraPrices.reduce((sum, extra) => sum + extra.amount, 0);

    return {
      isPriced,
      subtotal: result.subtotal,
      originalSubtotal: showsDiscount ? result.originalSubtotal : result.subtotal,
      discountPercent:
        showsDiscount && result.discountPercent ? Math.floor(result.discountPercent) : null,
      extras: extraPrices,
      total: result.subtotal + extrasTotal,
      deposit,
    };
  }, [extras, isDiscountVisible, period, product, quantity]);
};
