"use client";
import type { ReactNode, Ref } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@louez/ui";
import { calculateDurationMinutes, isFixedPriceProduct, pricingModeToMinutes } from "@louez/utils";
import { useStoreTimezone } from "@/contexts/store-context";
import { usePricingNow } from "@/hooks/use-pricing-now";
import { usePeriodLabel } from "@/hooks/use-period-label";
import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import { BookingAttributeSelects } from "@/components/storefront/product/booking-attribute-selects";
import { ExtrasList } from "@/components/storefront/product/extras-list";
import { QuantityStepper } from "@/components/storefront/product/quantity-stepper";
import type { ProductPageBooking, ProductPageProduct } from "@/lib/storefront/product-page.loader";
import type { AccessoryLink } from "@/lib/storefront/storefront.types";
import type { RentalPeriodRules } from "@/lib/utils/util.rental-period";
import { parseStorefrontDecimal } from "@/lib/utils/util.storefront-product-pricing";
import {
  getSeasonalCalendarPricing,
  getSeasonalDurationParts,
} from "@/lib/utils/util.storefront-seasonal-pricing";
import { BookingPeriodField } from "./booking-period-field";
import { ProductSummary } from "./product-summary";
import { PriceSummary } from "./price-summary";
import { StickyBookingBar } from "./sticky-booking-bar";
import type { BookingPrice } from "./use-booking-price";

export interface BookingPanelViewProps {
  product: ProductPageProduct;
  booking: ProductPageBooking;
  information: ReactNode;
  period: RentalPeriodValue | null;
  periodRules: RentalPeriodRules;
  periodFieldRef?: Ref<HTMLDivElement>;
  isPeriodOpen: boolean;
  setIsPeriodOpen: (open: boolean) => void;
  setPeriodOverride: (period: RentalPeriodValue) => void;
  quantity: number;
  maxQuantity: number | null;
  isSelectionUnavailable?: boolean;
  setRequestedQuantity: (quantity: number) => void;
  attributeValues: Record<string, string[]>;
  selectedAttributes: Record<string, string>;
  setSelectedAttributes: (attributes: Record<string, string>) => void;
  selectionHint?: string;
  requiredAccessories: AccessoryLink[];
  extraIds: ReadonlySet<string>;
  cartProductIds: ReadonlySet<string>;
  price: BookingPrice;
  isFirstCheck?: boolean;
  ctaLabel: string;
  isCtaDisabled?: boolean;
  blockedReason?: string | null;
  handleReserve: () => void;
  getCategoryHref?: (href: string) => string;
}

/** Shared booking column; availability, cart writes and analytics stay in its container. */
export const BookingPanelView = ({
  product,
  booking,
  information,
  period,
  periodRules,
  periodFieldRef,
  isPeriodOpen,
  setIsPeriodOpen,
  setPeriodOverride,
  quantity,
  maxQuantity,
  isSelectionUnavailable,
  setRequestedQuantity,
  attributeValues,
  selectedAttributes,
  setSelectedAttributes,
  selectionHint,
  requiredAccessories,
  extraIds,
  cartProductIds,
  price,
  isFirstCheck,
  ctaLabel,
  isCtaDisabled,
  blockedReason,
  handleReserve,
  getCategoryHref,
}: BookingPanelViewProps) => {
  const t = useTranslations();
  const formatPeriodLabel = usePeriodLabel();
  const promotionTimezone = useStoreTimezone();
  const promotionNow = usePricingNow();
  const hasAxes = booking.attributeAxes.length > 0;
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

  return (
    <>
      <div className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <ProductSummary
          product={product}
          getCategoryHref={getCategoryHref}
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
            max={maxQuantity}
            onChange={setRequestedQuantity}
            disabled={isSelectionUnavailable}
            hint={
              isFirstCheck
                ? t("storefront.product.booking.checking")
                : period && maxQuantity !== null
                  ? t("storefront.product.booking.availableForDates", {
                      count: maxQuantity,
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
            <Button
              data-demo-target="product-reserve"
              size="lg"
              className="w-full"
              onClick={handleReserve}
              disabled={isCtaDisabled}
            >
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
