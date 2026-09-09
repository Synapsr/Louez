"use client";

import { useTranslations } from "next-intl";

import type { StorefrontCatalogProduct } from "@/lib/storefront/storefront.types";
import { getDetailedDuration } from "@/lib/utils/duration";
import {
  getDisplayableMaxDiscount,
  getEffectiveDiscountPercent,
} from "@/lib/utils/util.discount-visibility";
import { getStorefrontProductPrice } from "@/lib/utils/util.storefront-product-pricing";
import { getStorefrontPricingSummary } from "@/lib/utils/util.storefront-pricing";

import { usePeriodLabel } from "@/hooks/use-period-label";

import { useDiscountVisibility, useStoreMaxDiscountPercent } from "@/contexts/store-context";

import type { ProductCardPeriod } from "./util.product-card";

export interface ProductCardPricing {
  amount: number;
  /** List price to strike through; only when the store advertises the markdown. */
  compareAt: number | null;
  /** Suffix after the slash: base period without dates, rented duration with dates. */
  per: string | null;
  /** Plain suffix, for a forfait. */
  label: string | null;
  /** Whole percent for the promo badge; 0 when nothing is advertised. */
  promoPercent: number;
}

/**
 * What a card prints. Without dates: the base rate and the best discount a
 * longer rental unlocks. With dates: the period total for one unit, priced
 * by the cart's engine, struck through when a visible discount applied.
 * The store's display cap hides anything above it in both cases.
 */
export const useProductCardPricing = (
  product: StorefrontCatalogProduct,
  period?: ProductCardPeriod | null,
): ProductCardPricing => {
  const t = useTranslations();
  const formatPeriodLabel = usePeriodLabel();
  const isDiscountVisible = useDiscountVisibility();
  const maxDiscountPercent = useStoreMaxDiscountPercent();
  const isFixed = product.pricingKind === "fixed";
  const fixedLabel = isFixed ? t("storefront.product.fixedPricingLabel") : null;

  if (!period) {
    const summary = getStorefrontPricingSummary(product);

    return {
      amount: summary.displayPrice,
      compareAt: null,
      per:
        summary.displayPeriodMinutes == null
          ? null
          : formatPeriodLabel(summary.displayPeriodMinutes),
      label: fixedLabel,
      promoPercent: Math.floor(getDisplayableMaxDiscount(summary, maxDiscountPercent)),
    };
  }

  const result = getStorefrontProductPrice({
    product,
    startDate: period.startDate,
    endDate: period.endDate,
    quantity: 1,
  });
  const percent = getEffectiveDiscountPercent(result);
  const showsDiscount = result.savings > 0 && isDiscountVisible(percent);
  const { days, hours, totalHours } = getDetailedDuration(period.startDate, period.endDate);
  const durationLabel =
    days === 0
      ? t("common.hours", { count: totalHours })
      : hours === 0
        ? t("common.days", { count: days })
        : `${t("common.days", { count: days })} ${t("common.hours", { count: hours })}`;

  return {
    amount: result.subtotal,
    compareAt: showsDiscount ? result.originalSubtotal : null,
    per: isFixed ? null : durationLabel,
    label: fixedLabel,
    promoPercent: showsDiscount ? Math.floor(percent) : 0,
  };
};
