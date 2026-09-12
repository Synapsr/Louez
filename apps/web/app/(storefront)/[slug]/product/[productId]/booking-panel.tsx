"use client";

import { type ReactNode, useMemo, useRef, useState } from "react";

import { useStoreTimezone as usePromotionTimezone } from "@/contexts/store-context";
import { usePricingNow } from "@/hooks/use-pricing-now";
import { useTranslations } from "next-intl";

import { Button, toastManager } from "@louez/ui";
import { calculateDurationMinutes, isFixedPriceProduct, pricingModeToMinutes } from "@louez/utils";

import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import { BookingAttributeSelects } from "@/components/storefront/product/booking-attribute-selects";
import { ExtrasList } from "@/components/storefront/product/extras-list";
import { useQuickAdd } from "@/components/storefront/product/quick-add-provider";
import { QuantityStepper } from "@/components/storefront/product/quantity-stepper";
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
import { parseStorefrontDecimal } from "@/lib/utils/util.storefront-product-pricing";
import { deriveAttributeValues } from "@/lib/utils/util.variant-combinations";

import { usePeriodLabel } from "@/hooks/use-period-label";

import { type CartPeriod, useCartState } from "@/contexts/cart-context";

import {
  getSeasonalCalendarPricing,
  getSeasonalDurationParts,
} from "@/lib/utils/util.storefront-seasonal-pricing";
import { BookingPeriodField } from "./booking-period-field";
import { ProductSummary } from "./product-summary";
import { PriceSummary } from "./price-summary";
import { StickyBookingBar } from "./sticky-booking-bar";
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
  const promotionTimezone = usePromotionTimezone();
  const promotionNow = usePricingNow();
  const t = useTranslations();
  const formatPeriodLabel = usePeriodLabel();
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

  const isFixed = isFixedPriceProduct(product);
  const basePer = isFixed
    ? null
    : formatPeriodLabel(
        product.basePeriodMinutes && product.basePeriodMinutes > 0
          ? product.basePeriodMinutes
          : pricingModeToMinutes(product.pricingMode),
      );
  const durationLabel = isFixed
    ? t("storefront.product.fixedPricingLabel")
    : period
      ? getSeasonalDurationParts(calculateDurationMinutes(period.start, period.end))
          .map((part) => formatPeriodLabel(part, { alwaysShowCount: true }))
          .join(" ")
      : null;

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
    <>
      <div className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <ProductSummary
          product={product}
          booking={booking}
          seasonalSegments={price.seasonalSegments}
          rentalPrice={
            price.isPriced
              ? (price.promotion?.originalSubtotal ?? price.subtotal) / quantity
              : undefined
          }
          rentalMinutes={period ? calculateDurationMinutes(period.start, period.end) : undefined}
        />
        <div className="flex flex-col gap-5 rounded-2xl bg-card p-4 shadow-card sm:p-6">
          <BookingPeriodField
            seasonalPricing={getSeasonalCalendarPricing(product, {
              timezone: promotionTimezone,
              now: promotionNow,
            })}
            ref={periodFieldRef}
            value={period}
            onChange={setPeriodOverride}
            open={isPeriodOpen}
            onOpenChange={setIsPeriodOpen}
            rules={periodRules}
          />

          {hasAxes ? (
            <BookingAttributeSelects
              axes={booking.attributeAxes}
              values={attributeValues}
              selected={selectedAttributes}
              onChange={setSelectedAttributes}
              hint={selectionHint}
            />
          ) : null}

          <QuantityStepper
            value={quantity}
            max={capacity.maxQuantity}
            onChange={setRequestedQuantity}
            disabled={capacity.isSelectionUnavailable}
            hint={
              isFirstCheck
                ? t("storefront.product.booking.checking")
                : period && capacity.maxQuantity !== null
                  ? t("storefront.product.booking.availableForDates", {
                      count: capacity.maxQuantity,
                    })
                  : undefined
            }
          />

          <ExtrasList
            accessories={requiredAccessories}
            quantity={quantity}
            selectedIds={extraIds}
            onToggle={() => {}}
            cartProductIds={cartProductIds}
          />

          <PriceSummary
            price={price}
            seasons={product.seasonalPricings}
            durationLabel={durationLabel}
          />

          <div className="hidden flex-col gap-1.5 lg:flex">
            <Button size="lg" className="w-full" onClick={handleReserve} disabled={isCtaDisabled}>
              {ctaLabel}
            </Button>
            {blockedReason ? (
              <p className="text-xs text-muted-foreground">{blockedReason}</p>
            ) : null}
          </div>
        </div>
        {information}
      </div>

      <StickyBookingBar
        amount={price.isPriced ? price.total : (parseStorefrontDecimal(product.price) ?? 0)}
        per={price.isPriced ? null : basePer}
        label={price.isPriced ? null : isFixed ? t("storefront.product.fixedPricingLabel") : null}
        ctaLabel={ctaLabel}
        onClick={handleReserve}
        disabled={isCtaDisabled}
        blockedReason={blockedReason}
      />
    </>
  );
};
