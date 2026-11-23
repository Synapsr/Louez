"use client";

import { useMemo, useState } from "react";

import type { StorefrontCatalogProduct } from "@/lib/storefront/storefront.types";
import { type CartLineInput, toCartLineInput } from "@/lib/utils/util.cart-line-input";
import { parseRentalPeriod } from "@/lib/utils/util.rental-period";
import { deriveAttributeValues } from "@/lib/utils/util.variant-combinations";

import { QuickAddVariantView } from "./quick-add-variant-view";
import { useProductAvailability } from "./use-product-availability";
import { useProductCardPricing } from "./use-product-card-pricing";
import { clampBookingQuantity, resolveBookingCapacity } from "./util.booking-capacity";
import { type ProductCardPeriod, getProductStockLimit } from "./util.product-card";

interface QuickAddVariantStepProps {
  product: StorefrontCatalogProduct;
  period: ProductCardPeriod;
  onConfirm: (lines: CartLineInput[]) => void;
}

/**
 * The variant a card cannot ask for: the product recalled at the top, one
 * select per axis fed by the combinations free on the period, and how
 * many units. Leaving an axis open is allowed, as on the product page: the
 * line stays open, and the store picks the units among those that match.
 */
export const QuickAddVariantStep = ({ product, period, onConfirm }: QuickAddVariantStepProps) => {
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [requestedQuantity, setRequestedQuantity] = useState(1);

  const periodValue = useMemo(
    () => parseRentalPeriod(period.startDate, period.endDate),
    [period.endDate, period.startDate],
  );
  const pricing = useProductCardPricing(product, period);
  const availability = useProductAvailability(product.id, periodValue);
  const axes = useMemo(() => product.bookingAttributeAxes ?? [], [product.bookingAttributeAxes]);
  const combinations = useMemo(() => availability.combinations ?? [], [availability.combinations]);
  const values = useMemo(
    () =>
      deriveAttributeValues(axes, {
        combinations: availability.combinations,
        units: product.units,
      }),
    [availability.combinations, axes, product.units],
  );
  const capacity = resolveBookingCapacity({
    baseMaxQuantity: getProductStockLimit(product),
    periodMaxQuantity: availability.maxQuantity,
    axes,
    combinations,
    selectedAttributes: selected,
  });
  const quantity = clampBookingQuantity(requestedQuantity, capacity.maxQuantity);
  const isChecking = availability.maxQuantity === undefined && availability.isChecking;

  const confirm = () => {
    onConfirm([
      toCartLineInput(product, {
        quantity,
        maxQuantity: capacity.maxQuantity === null ? null : Math.max(1, capacity.maxQuantity),
        selectedAttributes: selected,
      }),
    ]);
  };

  return (
    <QuickAddVariantView
      product={product}
      pricing={pricing}
      axes={axes}
      values={values}
      selected={selected}
      onSelectedChange={setSelected}
      quantity={quantity}
      maxQuantity={capacity.maxQuantity}
      onQuantityChange={setRequestedQuantity}
      isChecking={isChecking}
      disabled={isChecking || capacity.isSelectionUnavailable}
      onConfirm={confirm}
    />
  );
};
