import {
  applyProductPromotion,
  calculateFixedPrice,
  calculateDurationMinutes,
  calculateRateBasedPrice,
  calculateSeasonalAwarePrice,
  findApplicableTier,
  isRateBasedProduct,
} from "@louez/utils";

import type { PricingMode, PricingTier, Rate } from "@louez/types";

import type { Product, ProductPricingDetails, SelectedProduct } from "../types";

/** The periods of a mode between two dates: any started period counts in full. */
export function durationForMode(startDate: Date, endDate: Date, mode: PricingMode): number {
  const diffMs = endDate.getTime() - startDate.getTime();
  if (mode === "hour") {
    return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60)));
  }
  if (mode === "week") {
    return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24 * 7)));
  }
  return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

interface ProductLinePricingInput {
  product: Product;
  selectedItem?: SelectedProduct;
  startDate: Date | undefined;
  endDate: Date | undefined;
  timezone: string | undefined;
}

/**
 * The price the creation form shows for a product line, over the dates
 * chosen: the amount it totals and sends as the total it showed
 * (`createManualReservation` compares it with its own). A line priced from
 * the catalogue applies the product's promotion in force today, by the
 * checkout's own function (`applyProductPromotion`, as `priceCatalogLine`
 * applies it): its price is the discounted one, shown next to the price
 * before. A price typed by hand is never discounted; the catalogue's price it
 * replaces, the promotion included, stays its reference.
 */
export function productLinePricing(
  input: ProductLinePricingInput & { now?: Date },
): ProductPricingDetails {
  const regular = regularLinePricing(input);
  const catalogue =
    regular.hasPriceOverride && input.selectedItem
      ? regularLinePricing({
          ...input,
          selectedItem: { ...input.selectedItem, priceOverride: undefined },
        })
      : regular;
  const promoted = applyProductPromotion(
    catalogue.lineSubtotal,
    input.product.promotion,
    input.timezone,
    input.now,
  );
  if (!promoted.promotion) return regular;

  const calculatedPrice =
    promoted.subtotal /
    Math.max(1, input.selectedItem?.quantity ?? 1) /
    Math.max(1, catalogue.productDuration);
  if (regular.hasPriceOverride) return { ...regular, calculatedPrice };

  const lineSavings = regular.lineOriginalSubtotal - promoted.subtotal;
  return {
    ...regular,
    calculatedPrice,
    effectivePrice: calculatedPrice,
    hasDiscount: true,
    // The reduction shown is the whole one, from the price before to the price applied.
    applicableTierDiscountPercent: null,
    lineSubtotal: promoted.subtotal,
    lineSavings,
    reductionPercent:
      regular.lineOriginalSubtotal > 0
        ? Math.round((lineSavings / regular.lineOriginalSubtotal) * 100)
        : null,
  };
}

/** The line's price from the catalogue's rates, before any promotion. */
function regularLinePricing(input: ProductLinePricingInput): ProductPricingDetails {
  const { product, selectedItem, startDate, endDate, timezone } = input;
  const productPricingMode = product.pricingMode ?? "day";
  const basePrice = parseFloat(product.price);
  const hasPriceOverride = Boolean(selectedItem?.priceOverride);
  const quantity = selectedItem?.quantity ?? 1;
  const rateBased = isRateBasedProduct({ basePeriodMinutes: product.basePeriodMinutes });

  const productDuration =
    product.pricingKind === "fixed"
      ? 1
      : startDate && endDate
        ? durationForMode(startDate, endDate, productPricingMode)
        : 0;

  if (product.pricingKind === "fixed") {
    const fixedResult = calculateFixedPrice(
      {
        basePrice,
        deposit: parseFloat(product.deposit || "0"),
        pricingMode: productPricingMode,
      },
      quantity,
    );
    const overrideUnitPrice = selectedItem?.priceOverride?.unitPrice;
    const effectivePrice =
      hasPriceOverride && overrideUnitPrice != null ? overrideUnitPrice : basePrice;
    const lineSubtotal = effectivePrice * quantity;

    return {
      productPricingMode,
      productDuration: 1,
      basePrice,
      calculatedPrice: basePrice,
      effectivePrice,
      hasPriceOverride,
      hasDiscount: false,
      applicableTierDiscountPercent: null,
      hasTieredPricing: false,
      isRateBased: false,
      lineSubtotal,
      lineOriginalSubtotal: fixedResult.originalSubtotal,
      lineSavings: fixedResult.originalSubtotal - lineSubtotal,
      reductionPercent: 0,
      ratePlan: null,
      basePeriodMinutes: null,
    };
  }

  const rates: Rate[] = (product.pricingTiers || [])
    .filter(
      (tier): tier is typeof tier & { period: number; price: string } =>
        typeof tier.period === "number" && tier.period > 0 && typeof tier.price === "string",
    )
    .map((tier, index) => ({
      id: tier.id,
      price: parseFloat(tier.price),
      period: tier.period,
      displayOrder: tier.displayOrder ?? index,
    }));

  const productTiers: PricingTier[] = product.pricingTiers.map((tier) => ({
    id: tier.id,
    minDuration: tier.minDuration ?? 1,
    discountPercent: parseFloat(tier.discountPercent ?? "0"),
    displayOrder: tier.displayOrder || 0,
  }));

  const hasSeasonalPricings = (product.seasonalPricings?.length ?? 0) > 0;

  // Seasonal-aware pricing path
  if (hasSeasonalPricings && startDate && endDate) {
    const seasonalResult = calculateSeasonalAwarePrice(
      {
        timezone,
        basePrice,
        basePeriodMinutes: product.basePeriodMinutes ?? null,
        deposit: parseFloat(product.deposit || "0"),
        pricingKind: product.pricingKind,
        pricingMode: productPricingMode,
        enforceStrictTiers: product.enforceStrictTiers ?? false,
        tiers: productTiers,
        rates,
      },
      product.seasonalPricings!,
      startDate,
      endDate,
      quantity,
    );

    const overrideUnitPrice = selectedItem?.priceOverride?.unitPrice;
    const lineSubtotal =
      hasPriceOverride && overrideUnitPrice != null
        ? overrideUnitPrice * productDuration * quantity
        : seasonalResult.subtotal;

    const dpPerUnitPerPeriod =
      productDuration > 0 ? seasonalResult.subtotal / quantity / productDuration : basePrice;

    return {
      productPricingMode,
      productDuration,
      basePrice,
      calculatedPrice: dpPerUnitPerPeriod,
      effectivePrice:
        hasPriceOverride && overrideUnitPrice != null ? overrideUnitPrice : dpPerUnitPerPeriod,
      hasPriceOverride,
      hasDiscount: seasonalResult.savings > 0,
      applicableTierDiscountPercent: null,
      hasTieredPricing: rates.length > 0 || productTiers.length > 0,
      isRateBased: rateBased,
      lineSubtotal,
      lineOriginalSubtotal: seasonalResult.originalSubtotal,
      lineSavings: seasonalResult.originalSubtotal - lineSubtotal,
      reductionPercent:
        seasonalResult.originalSubtotal > 0
          ? Math.round((seasonalResult.savings / seasonalResult.originalSubtotal) * 100)
          : null,
      ratePlan: null,
      basePeriodMinutes: product.basePeriodMinutes ?? null,
    };
  }

  // Rate-based pricing path (basePeriodMinutes > 0)
  if (rateBased && startDate && endDate) {
    const durationMins = calculateDurationMinutes(startDate, endDate);

    const rateResult = calculateRateBasedPrice(
      {
        basePrice,
        basePeriodMinutes: product.basePeriodMinutes!,
        deposit: parseFloat(product.deposit || "0"),
        rates,
        enforceStrictTiers: product.enforceStrictTiers ?? false,
      },
      durationMins,
      quantity,
    );

    // For price override: replace the computed subtotal with manual calculation
    const overrideUnitPrice = selectedItem?.priceOverride?.unitPrice;
    const lineSubtotal =
      hasPriceOverride && overrideUnitPrice != null
        ? overrideUnitPrice * productDuration * quantity
        : rateResult.subtotal;

    // calculatedPrice: computed per unit per period (for override dialog reference)
    const dpPerUnitPerPeriod =
      productDuration > 0 ? rateResult.subtotal / quantity / productDuration : basePrice;

    return {
      productPricingMode,
      productDuration,
      basePrice,
      calculatedPrice: dpPerUnitPerPeriod,
      effectivePrice:
        hasPriceOverride && overrideUnitPrice != null ? overrideUnitPrice : dpPerUnitPerPeriod,
      hasPriceOverride,
      hasDiscount: rateResult.savings > 0,
      applicableTierDiscountPercent: null,
      hasTieredPricing: rates.length > 0,
      isRateBased: true,
      lineSubtotal,
      lineOriginalSubtotal: rateResult.originalSubtotal,
      lineSavings: rateResult.originalSubtotal - lineSubtotal,
      reductionPercent: rateResult.reductionPercent,
      ratePlan: rateResult.plan,
      basePeriodMinutes: product.basePeriodMinutes ?? null,
    };
  }

  // Progressive/tiered pricing path
  const applicableTier =
    productDuration > 0 ? findApplicableTier(productTiers, productDuration) : null;
  const applicableTierDiscount = applicableTier?.discountPercent ?? 0;
  const calculatedPrice = applicableTier
    ? basePrice * (1 - applicableTierDiscount / 100)
    : basePrice;

  const effectivePrice = hasPriceOverride
    ? (selectedItem?.priceOverride?.unitPrice ?? calculatedPrice)
    : calculatedPrice;

  const lineSubtotal = effectivePrice * productDuration * quantity;
  const lineOriginalSubtotal = basePrice * productDuration * quantity;

  return {
    productPricingMode,
    productDuration,
    basePrice,
    calculatedPrice,
    effectivePrice,
    hasPriceOverride,
    hasDiscount: Boolean(applicableTier && applicableTierDiscount > 0),
    applicableTierDiscountPercent: applicableTier?.discountPercent ?? null,
    hasTieredPricing: productTiers.length > 0,
    isRateBased: false,
    lineSubtotal,
    lineOriginalSubtotal,
    lineSavings: lineOriginalSubtotal - lineSubtotal,
    reductionPercent: applicableTier?.discountPercent ?? null,
    ratePlan: null,
    basePeriodMinutes: null,
  };
}
