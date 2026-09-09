import type { StockQuantityLimit } from "@louez/utils";

import type { CartItem } from "@/contexts/cart-context";
import type { StorefrontCatalogProduct } from "@/lib/storefront/storefront.types";
import {
  buildRequiredAccessoryCartInputs,
  type RequiredAccessoryCartInput,
} from "@/lib/utils/cart-required-accessories";
import {
  getStorefrontPricingMode,
  normalizeStorefrontTiers,
  parseStorefrontDecimal,
} from "@/lib/utils/util.storefront-product-pricing";

/**
 * Product fields a cart line reads. Structural: a catalog product, a product
 * page product and an accessory link all satisfy it.
 */
export type CartLineProduct = Pick<
  StorefrontCatalogProduct,
  | "id"
  | "name"
  | "images"
  | "price"
  | "deposit"
  | "stockKind"
  | "pricingKind"
  | "pricingMode"
  | "basePeriodMinutes"
  | "enforceStrictTiers"
  | "pricingTiers"
  | "seasonalPricings"
  | "accessories"
>;

/** What `addItem` accepts: a cart line minus what the cart assigns itself. */
export type CartLineInput = Omit<
  CartItem,
  | "lineId"
  | "selectionSignature"
  | "startDate"
  | "endDate"
  | "parentLineId"
  | "requiredQuantity"
  | "unavailableReason"
> & {
  requiredAccessories?: RequiredAccessoryCartInput[];
};

export interface ToCartLineInputOptions {
  quantity: number;
  maxQuantity: StockQuantityLimit;
  /** Variant selection; omit or pass `{}` for a product without axes. */
  selectedAttributes?: Record<string, string>;
  /** Overrides the accessories derived from the product; an accessory line has none. */
  requiredAccessories?: RequiredAccessoryCartInput[];
  /** Overrides the first product image. */
  productImage?: string | null;
}

/**
 * Builds the line `addItem` receives from any storefront product shape.
 * One place parses the decimals, normalises the tiers and keeps
 * `enforceStrictTiers` and `seasonalPricings`, so every surface prices the
 * line the way the server will.
 */
export const toCartLineInput = (
  product: CartLineProduct,
  {
    quantity,
    maxQuantity,
    selectedAttributes,
    requiredAccessories,
    productImage,
  }: ToCartLineInputOptions,
): CartLineInput => {
  const seasonalPricings = product.seasonalPricings ?? [];

  return {
    productId: product.id,
    productName: product.name,
    productImage: productImage === undefined ? product.images?.[0] || null : productImage,
    price: parseStorefrontDecimal(product.price) ?? 0,
    deposit: parseStorefrontDecimal(product.deposit) ?? 0,
    quantity,
    maxQuantity,
    pricingKind: product.pricingKind ?? "duration",
    stockKind: product.stockKind ?? undefined,
    pricingMode: getStorefrontPricingMode(product),
    productPricingMode: product.pricingMode ?? null,
    basePeriodMinutes: product.basePeriodMinutes ?? null,
    enforceStrictTiers: product.enforceStrictTiers ?? false,
    pricingTiers: normalizeStorefrontTiers(product.pricingTiers),
    seasonalPricings: seasonalPricings.length > 0 ? seasonalPricings : undefined,
    selectedAttributes,
    requiredAccessories:
      requiredAccessories ?? buildRequiredAccessoryCartInputs(product.accessories ?? []),
  };
};
