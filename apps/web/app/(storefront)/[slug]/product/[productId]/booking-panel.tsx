"use client";

import { type ReactNode, useMemo, useRef, useState } from "react";

import { useTranslations } from "next-intl";

import { toastManager } from "@louez/ui";

import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import { useQuickAdd } from "@/components/storefront/product/quick-add-provider";
import { useProductAvailability } from "@/components/storefront/product/use-product-availability";
import {
  clampBookingQuantity,
  resolveBookingCapacity,
} from "@/components/storefront/product/util.booking-capacity";

import type { ProductPageBooking, ProductPageProduct } from "@/lib/storefront/product-page.loader";
import type { AccessoryLink } from "@/lib/storefront/storefront.types";
import {
  findBlockingRequiredAccessories,
  getRequiredAccessoryUnitQuantity,
  selectRequiredAccessories,
} from "@/lib/utils/cart-required-accessories";
import {
  formatDurationFromMinutes,
  validateMinRentalDurationMinutes,
} from "@/lib/utils/rental-duration";
import type { RentalPeriodRules } from "@/lib/utils/util.rental-period";
import { deriveAttributeValues } from "@/lib/utils/util.variant-combinations";

import { type CartPeriod, useCartState } from "@/contexts/cart-context";

import { BookingPanelView } from "./booking-panel-view";
import { useAddToCart } from "./use-add-to-cart";
import { useBookingPrice } from "./use-booking-price";

interface BookingPanelProps {
  product: ProductPageProduct;
  booking: ProductPageBooking;
  accessories: AccessoryLink[];
  /** Title, price and availability, rendered above the panel in its column. */
  information: ReactNode;
}

const toPeriodValue = (period: CartPeriod | null): RentalPeriodValue | null =>
  period ? { start: new Date(period.startDate), end: new Date(period.endDate) } : null;

/**
 * The booking column of the product page: period, variant, quantity,
 * extras, price, one button. The period starts from the cart's so a
 * visitor who already chose dates never re-enters them. Renders the phone
 * sticky bar as a sibling so it can pin to the bottom of the whole page.
 */
export const BookingPanel = ({ product, booking, accessories, information }: BookingPanelProps) => {
  const t = useTranslations();
  const { period: cartPeriod, items: cartItems } = useCartState();
  const periodFieldRef = useRef<HTMLDivElement>(null);

  const [periodOverride, setPeriodOverride] = useState<RentalPeriodValue | null>(null);
  const [isPeriodOpen, setIsPeriodOpen] = useState(false);
  const [requestedQuantity, setRequestedQuantity] = useState(1);
  const [selectedAttributes, setSelectedAttributes] = useState<Record<string, string>>({});
  const quickAdd = useQuickAdd();
  const requiredAccessories = useMemo(() => selectRequiredAccessories(accessories), [accessories]);
  const extraIds = useMemo<ReadonlySet<string>>(() => new Set(), []);

  // The cart's period is the default until the visitor edits the dates here.
  const period = useMemo(
    () => periodOverride ?? toPeriodValue(cartPeriod),
    [cartPeriod, periodOverride],
  );
  const periodRules: RentalPeriodRules = {
    pricingMode: product.pricingMode,
    businessHours: booking.businessHours,
    timezone: booking.timezone,
    advanceNoticeMinutes: booking.advanceNoticeMinutes,
    minRentalMinutes: booking.minRentalMinutes,
    maxRentalMinutes: booking.maxRentalMinutes,
  };

  const availability = useProductAvailability(product.id, period);
  const hasAxes = booking.attributeAxes.length > 0;
  const combinations = availability.combinations ?? booking.combinations;
  const attributeValues = useMemo(
    () =>
      availability.combinations
        ? deriveAttributeValues(booking.attributeAxes, {
            combinations: availability.combinations,
          })
        : booking.attributeValues,
    [availability.combinations, booking.attributeAxes, booking.attributeValues],
  );
  const capacity = resolveBookingCapacity({
    baseMaxQuantity: booking.maxQuantity,
    periodMaxQuantity: availability.maxQuantity,
    axes: booking.attributeAxes,
    combinations,
    selectedAttributes,
  });
  const quantity = clampBookingQuantity(requestedQuantity, capacity.maxQuantity);

  const cartProductIds = useMemo(
    () => new Set(cartItems.map((item) => item.productId)),
    [cartItems],
  );
  // Required accessories ride along at their own price, so the panel's total
  // must carry them at the quantity the cart will hold.
  const requiredExtras = useMemo(
    () =>
      requiredAccessories.map((accessory) => ({
        accessory,
        quantity: getRequiredAccessoryUnitQuantity(accessory) * quantity,
      })),
    [quantity, requiredAccessories],
  );
  const price = useBookingPrice({ product, period, quantity, extras: requiredExtras });
  const addToCart = useAddToCart({
    product,
    accessories,
    axes: booking.attributeAxes,
    openDrawer: false,
  });

  const isFirstCheck =
    period !== null && availability.isChecking && availability.maxQuantity === undefined;
  const blockingAccessories = findBlockingRequiredAccessories(accessories, quantity);
  const blockedReason = capacity.isSelectionUnavailable
    ? t("storefront.product.selectionUnavailable")
    : blockingAccessories.length > 0
      ? t("storefront.product.requiredAccessoryOutOfStock")
      : null;
  const ctaLabel = isFirstCheck
    ? t("storefront.product.booking.checking")
    : t("storefront.product.addToCart");
  const isCtaDisabled = blockedReason !== null || isFirstCheck;

  const openPeriodPicker = () => {
    setIsPeriodOpen(true);
    periodFieldRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const handleReserve = () => {
    if (!period) {
      openPeriodPicker();
      return;
    }

    const durationCheck = validateMinRentalDurationMinutes(
      period.start,
      period.end,
      booking.minRentalMinutes,
    );
    if (!durationCheck.valid) {
      toastManager.add({
        title: t("storefront.product.minDurationError", {
          duration: formatDurationFromMinutes(booking.minRentalMinutes),
        }),
        type: "error",
      });
      openPeriodPicker();
      return;
    }

    const result = addToCart({
      period,
      quantity,
      maxQuantity: capacity.maxQuantity,
      selectedAttributes,
      allocationMode: hasAxes ? capacity.allocationMode : "single",
      combinations,
      extraIds,
    });
    if (!result.ok) {
      toastManager.add({ title: t("storefront.product.selectionUnavailable"), type: "error" });
      return;
    }
    quickAdd.offerExtras(
      { ...product, accessories, quantity: capacity.maxQuantity },
      { startDate: period.start.toISOString(), endDate: period.end.toISOString() },
      quantity,
    );
  };

  const selectionHint = hasAxes
    ? `${t("storefront.product.availableForSelection", { count: capacity.maxQuantity ?? 0 })} · ${
        capacity.allocationMode === "single"
          ? t("storefront.product.quantityPerCombinationHint")
          : t("storefront.product.quantityCanSplitHint")
      }`
    : undefined;

  return (
    <BookingPanelView
      product={product}
      booking={booking}
      information={information}
      period={period}
      periodRules={periodRules}
      periodFieldRef={periodFieldRef}
      isPeriodOpen={isPeriodOpen}
      setIsPeriodOpen={setIsPeriodOpen}
      setPeriodOverride={setPeriodOverride}
      quantity={quantity}
      maxQuantity={capacity.maxQuantity}
      isSelectionUnavailable={capacity.isSelectionUnavailable}
      setRequestedQuantity={setRequestedQuantity}
      attributeValues={attributeValues}
      selectedAttributes={selectedAttributes}
      setSelectedAttributes={setSelectedAttributes}
      selectionHint={selectionHint}
      requiredAccessories={requiredAccessories}
      extraIds={extraIds}
      cartProductIds={cartProductIds}
      price={price}
      isFirstCheck={isFirstCheck}
      ctaLabel={ctaLabel}
      isCtaDisabled={isCtaDisabled}
      blockedReason={blockedReason}
      handleReserve={handleReserve}
    />
  );
};
