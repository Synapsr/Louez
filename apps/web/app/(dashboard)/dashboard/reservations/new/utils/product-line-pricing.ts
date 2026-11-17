import {
  priceCatalogLine,
  priceRegularCatalogLine,
  toPricingCatalogProduct,
  type PricingCatalogProduct,
} from "@louez/api/services/catalogue-line-pricing";
import {
  calculateDuration,
  calculateDurationMinutes,
  calculateRateBasedPrice,
  findApplicableTier,
  isRateBasedProduct,
} from "@louez/utils";

import type { Product, ProductPricingDetails, SelectedProduct } from "../types";

/**
 * The product as the server's catalogue holds it (`loadPricingCatalog`): the
 * same conversion of the same rows, the store's timezone with it.
 */
export function formCatalogueProduct(
  product: Product,
  timezone: string | undefined,
): PricingCatalogProduct {
  return {
    ...(timezone ? { timezone } : {}),
    ...toPricingCatalogProduct(
      {
        id: product.id,
        name: product.name,
        description: product.description ?? null,
        images: product.images,
        price: product.price,
        deposit: product.deposit,
        pricingKind: product.pricingKind,
        pricingMode: product.pricingMode ?? "day",
        basePeriodMinutes: product.basePeriodMinutes ?? null,
        enforceStrictTiers: product.enforceStrictTiers ?? false,
        stockKind: product.stockKind,
        quantity: product.quantity,
        trackUnits: product.trackUnits,
        bookingAttributeAxes: product.bookingAttributeAxes,
        taxSettings: product.taxSettings ?? null,
        promotion: product.promotion ?? null,
      },
      product.pricingTiers.map((tier) => ({
        id: tier.id,
        minDuration: tier.minDuration,
        discountPercent: tier.discountPercent,
        displayOrder: tier.displayOrder,
        period: tier.period ?? null,
        price: tier.price ?? null,
      })),
      product.seasonalPricings ?? [],
    ),
  };
}

/** The total of a price typed by hand for a line, before its one rounding: the server's and the form's. */
export function typedLineSubtotal(input: {
  unitPrice: number;
  quantity: number;
  pricingKind: Product["pricingKind"];
  pricingMode: Product["pricingMode"];
  startDate: Date;
  endDate: Date;
}): number {
  const periods =
    input.pricingKind === "fixed"
      ? 1
      : calculateDuration(input.startDate, input.endDate, input.pricingMode ?? "day");
  return input.unitPrice * periods * input.quantity;
}

/**
 * The price the creation form shows for a product line, over the dates
 * chosen: the amount it totals and sends as the total it showed
 * (`createManualReservation` compares it with its own). A line priced from
 * the catalogue is priced by the server's own functions
 * (`priceCatalogLine`, `catalogue-line-pricing.ts`), from the product as the
 * server's catalogue holds it, the product's promotion in force at `now`
 * included: the form's amount is the server's by construction. The rest
 * (the rate plan, the tier shown) only describes that price. A price typed
 * by hand is never discounted; the catalogue's price it replaces, the
 * promotion included, stays its reference.
 */
export function productLinePricing(input: {
  product: Product;
  selectedItem?: SelectedProduct;
  startDate: Date | undefined;
  endDate: Date | undefined;
  timezone: string | undefined;
  /** The instant a promotion is in force at: the one the server gave the page. */
  now: Date;
}): ProductPricingDetails {
  const { product, selectedItem, startDate, endDate, timezone, now } = input;
  const productPricingMode = product.pricingMode ?? "day";
  const basePrice = parseFloat(product.price);
  const quantity = selectedItem?.quantity ?? 1;
  const overrideUnitPrice = selectedItem?.priceOverride?.unitPrice;
  const hasPriceOverride = overrideUnitPrice != null;
  const fixed = product.pricingKind === "fixed";
  const seasonal = (product.seasonalPricings?.length ?? 0) > 0;
  const rateBased = isRateBasedProduct({ basePeriodMinutes: product.basePeriodMinutes });
  const hasTieredPricing = !fixed && product.pricingTiers.length > 0;
  const basePeriodMinutes = fixed ? null : (product.basePeriodMinutes ?? null);

  // No dates yet: a duration-priced line is not priced.
  if (!fixed && (!startDate || !endDate)) {
    return {
      productPricingMode,
      productDuration: 0,
      basePrice,
      calculatedPrice: basePrice,
      effectivePrice: overrideUnitPrice ?? basePrice,
      hasPriceOverride,
      hasDiscount: false,
      applicableTierDiscountPercent: null,
      hasTieredPricing,
      isRateBased: rateBased,
      lineSubtotal: 0,
      lineUnitPrice: 0,
      lineOriginalSubtotal: 0,
      lineSavings: 0,
      reductionPercent: null,
      ratePlan: null,
      basePeriodMinutes,
    };
  }

  // A fixed price does not depend on the dates: priced at the instant when none are chosen.
  const start = startDate ?? now;
  const end = endDate ?? now;
  const catalogue = formCatalogueProduct(product, timezone);
  const line = {
    productId: product.id,
    quantity,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
  };
  const regular = priceRegularCatalogLine(catalogue, line);
  const priced = priceCatalogLine(catalogue, line, now);
  const productDuration = fixed ? 1 : calculateDuration(start, end, productPricingMode);
  const calculatedPrice = priced.subtotal / Math.max(1, quantity) / Math.max(1, productDuration);
  const lineSubtotal = hasPriceOverride
    ? typedLineSubtotal({
        unitPrice: overrideUnitPrice,
        quantity,
        pricingKind: product.pricingKind,
        pricingMode: productPricingMode,
        startDate: start,
        endDate: end,
      })
    : priced.subtotal;
  const lineOriginalSubtotal = regular.originalSubtotal;
  const lineSavings = lineOriginalSubtotal - lineSubtotal;
  const promoted = !hasPriceOverride && Boolean(priced.promotion);
  const wholeReduction =
    lineOriginalSubtotal > 0 ? Math.round((lineSavings / lineOriginalSubtotal) * 100) : null;

  // What describes the price: the rate plan of a rate-based product, the tier a duration reached.
  const rate =
    rateBased && !seasonal && !fixed
      ? calculateRateBasedPrice(
          {
            basePrice,
            basePeriodMinutes: catalogue.basePeriodMinutes ?? 0,
            deposit: catalogue.deposit,
            rates: catalogue.rates,
            enforceStrictTiers: catalogue.enforceStrictTiers,
          },
          calculateDurationMinutes(start, end),
          quantity,
        )
      : null;
  const tierPercent =
    !fixed && !seasonal && !rateBased
      ? (findApplicableTier(catalogue.tiers, productDuration)?.discountPercent ?? null)
      : null;

  return {
    productPricingMode,
    productDuration,
    basePrice,
    calculatedPrice,
    effectivePrice: overrideUnitPrice ?? calculatedPrice,
    hasPriceOverride,
    hasDiscount: promoted || (!fixed && regular.savings > 0),
    // The reduction shown with a promotion is the whole one, from the price before to the price applied.
    applicableTierDiscountPercent: promoted ? null : tierPercent,
    hasTieredPricing,
    isRateBased: rateBased && !fixed,
    lineSubtotal,
    lineUnitPrice: overrideUnitPrice ?? priced.unitPrice,
    lineOriginalSubtotal,
    lineSavings,
    reductionPercent: promoted
      ? wholeReduction
      : fixed
        ? 0
        : rate
          ? rate.reductionPercent
          : seasonal
            ? wholeReduction
            : tierPercent,
    ratePlan: rate?.plan ?? null,
    basePeriodMinutes,
  };
}
