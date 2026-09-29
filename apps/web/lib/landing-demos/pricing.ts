import type { ComponentProps } from "react";
import { addDays, format } from "date-fns";

import type {
  ProductFormValues,
  SeasonalPricingData,
} from "@/app/(dashboard)/dashboard/products/types";
import type { PromoCodesManager } from "@/app/(dashboard)/dashboard/settings/promo-codes/promo-codes-manager";
import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import type { Locale } from "@/i18n/config";
import { DEMO_RULES, getDemoProducts } from "@/lib/landing-demos/fixtures";
import { getDemoToday } from "@/lib/landing-demos/reservations";
import { getPricingDemoText } from "@/lib/landing-demos/text.pricing";

export const createDemoPricingValues = (locale?: Locale): ProductFormValues => {
  const product = getDemoProducts(locale)[0];
  const price = Number(product.price);
  return {
    name: product.name,
    description: "",
    categoryIds: product.categoryIds,
    price: product.price,
    basePriceDuration: { price: product.price, duration: 1, unit: DEMO_RULES.pricingMode },
    deposit: product.deposit ?? "",
    quantity: String(product.quantity),
    status: "active",
    stockKind: "returnable",
    pricingKind: "duration",
    pricingMode: DEMO_RULES.pricingMode,
    rateTiers: [
      { id: "demo-rate-three-days", price: (price * 3 * 0.9).toFixed(2), duration: 3, unit: "day" },
      { id: "demo-rate-seven-days", price: (price * 7 * 0.8).toFixed(2), duration: 7, unit: "day" },
    ],
    enforceStrictTiers: true,
    taxSettings: { inheritFromStore: true },
    promotion: null,
  };
};

/** The current summer, or the next one if it has already ended. */
export const createDemoPricingSeasons = (
  period: RentalPeriodValue,
  locale?: Locale,
): SeasonalPricingData[] => {
  const today = getDemoToday(period);
  const year = today.getFullYear() + (today.getMonth() > 7 ? 1 : 0);
  const base = createDemoPricingValues(locale);
  const price = Number(base.price) * 1.25;
  return [
    {
      id: "demo-summer",
      name: getPricingDemoText(locale).summer,
      startDate: format(new Date(year, 5, 1), "yyyy-MM-dd"),
      endDate: format(new Date(year, 7, 31), "yyyy-MM-dd"),
      price: price.toFixed(2),
      tiers: (base.rateTiers ?? []).map((tier, index) => ({
        id: `demo-summer-${tier.id}`,
        period: tier.duration * 1440,
        price: (Number(tier.price) * 1.25).toFixed(2),
        minDuration: null,
        discountPercent: null,
        displayOrder: index,
      })),
    },
  ];
};

export const createDemoPromoCodes = (
  period: RentalPeriodValue,
): ComponentProps<typeof PromoCodesManager>["codes"] => {
  const today = getDemoToday(period);
  const base = {
    description: null,
    minimumAmount: "40.00",
    currentUsageCount: 12,
    maxUsageCount: 100,
    startsAt: addDays(today, -30),
    expiresAt: addDays(today, 60),
    isActive: true,
    createdAt: addDays(today, -30),
  };
  return [
    { ...base, id: "demo-promo-active", code: "VELO15", type: "percentage", value: "15.00" },
    {
      ...base,
      id: "demo-promo-expired",
      code: "PRINTEMPS10",
      type: "percentage",
      value: "10.00",
      expiresAt: addDays(today, -1),
    },
    {
      ...base,
      id: "demo-promo-exhausted",
      code: "NANTES5",
      type: "fixed",
      value: "5.00",
      currentUsageCount: 25,
      maxUsageCount: 25,
    },
  ];
};
