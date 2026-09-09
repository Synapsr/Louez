"use client";

import { useMemo, useState } from "react";

import { useTranslations } from "next-intl";

import { Button, DialogFooter, DialogPanel, toastManager } from "@louez/ui";
import { allocateAcrossCombinations } from "@louez/utils";

import { ProductImage } from "@/components/product/product-image";
import { Price } from "@/components/storefront/ui/price";

import type { StorefrontCatalogProduct } from "@/lib/storefront/storefront.types";
import { pickActiveVariantAttributes } from "@/lib/util.variant-visibility";
import { type CartLineInput, toCartLineInput } from "@/lib/utils/util.cart-line-input";
import { parseRentalPeriod } from "@/lib/utils/util.rental-period";
import { deriveAttributeValues } from "@/lib/utils/util.variant-combinations";

import { BookingAttributeSelects } from "./booking-attribute-selects";
import { QuantityStepper } from "./quantity-stepper";
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
 * many units. Leaving an axis open is allowed, as on the product page — the
 * cart then spreads the units over whichever combinations have them.
 */
export const QuickAddVariantStep = ({ product, period, onConfirm }: QuickAddVariantStepProps) => {
  const t = useTranslations("storefront");
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
    if (capacity.allocationMode === "split") {
      const allocations = allocateAcrossCombinations(axes, combinations, selected, quantity);
      if (!allocations || allocations.length === 0) {
        toastManager.add({ title: t("product.selectionUnavailable"), type: "error" });
        return;
      }
      onConfirm(
        allocations.map((allocation) =>
          toCartLineInput(product, {
            quantity: allocation.quantity,
            maxQuantity: Math.max(1, allocation.combination.availableQuantity || 0),
            selectedAttributes: pickActiveVariantAttributes(
              axes,
              allocation.combination.selectedAttributes,
            ),
          }),
        ),
      );
      return;
    }

    onConfirm([
      toCartLineInput(product, {
        quantity,
        maxQuantity: capacity.maxQuantity === null ? null : Math.max(1, capacity.maxQuantity),
        selectedAttributes: selected,
      }),
    ]);
  };

  return (
    <>
      <DialogPanel className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <ProductImage
            src={product.images?.[0]}
            alt=""
            sizes="64px"
            containerClassName="w-16 shrink-0 rounded-lg"
          />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="truncate font-medium text-sm">{product.name}</p>
            <Price
              amount={pricing.amount}
              compareAt={pricing.compareAt}
              per={pricing.per}
              label={pricing.label}
              size="sm"
            />
          </div>
        </div>

        <p className="text-muted-foreground text-sm">{t("quickAdd.optionsIntro")}</p>

        <BookingAttributeSelects
          axes={axes}
          values={values}
          selected={selected}
          onChange={setSelected}
          hint={
            isChecking
              ? t("product.booking.checking")
              : t("product.availableForSelection", { count: capacity.maxQuantity ?? 0 })
          }
        />

        <QuantityStepper
          value={quantity}
          max={capacity.maxQuantity}
          onChange={setRequestedQuantity}
          disabled={isChecking || capacity.isSelectionUnavailable}
        />
      </DialogPanel>
      <DialogFooter variant="bare">
        <Button
          className="w-full sm:w-auto"
          onClick={confirm}
          disabled={isChecking || capacity.isSelectionUnavailable}
        >
          {t("product.addToCart")}
        </Button>
      </DialogFooter>
    </>
  );
};
