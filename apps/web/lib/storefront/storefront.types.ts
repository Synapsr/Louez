import type { ProductPromotion } from "@louez/types";
import type { BookingAttributeAxis, PricingKind, PricingMode, StockKind } from "@louez/types";
import type { SeasonalPricingConfig } from "@louez/utils";

import type { AccessoryLink } from "@/lib/utils/cart-required-accessories";

export type { AccessoryLink };

/**
 * Pricing tier as the storefront queries project it. Decimal columns arrive
 * as strings. A rate-based tier carries `period` + `price`; a duration tier
 * carries `minDuration` + `discountPercent`, where a NULL `minDuration`
 * means "from 1 period".
 */
export interface StorefrontPricingTier {
  id: string;
  minDuration: number | null;
  discountPercent: string | number | null;
  period?: number | null;
  price?: string | number | null;
  displayOrder?: number | null;
}

/** The slice of a product that pricing reads. Every storefront surface projects at least this. */
export interface StorefrontProductPricing {
  price: string | number;
  promotion?: ProductPromotion | null;
  deposit?: string | number | null;
  pricingKind?: PricingKind | null;
  pricingMode?: PricingMode | null;
  basePeriodMinutes?: number | null;
  enforceStrictTiers?: boolean | null;
  pricingTiers?: StorefrontPricingTier[] | null;
  seasonalPricings?: SeasonalPricingConfig[] | null;
}

/** Tracked unit as the storefront projects it for variant selectors. */
export interface StorefrontProductUnit {
  lifecycleStatus: "active" | "retired" | null;
  /** True when the unit is in downtime at query time. */
  inDowntimeNow?: boolean;
  attributes: Record<string, string> | null;
}

/**
 * One product as the home page, catalog, rental grid and product card see
 * it. Structural on purpose: each page projects its own columns, and a
 * consumer that needs less picks from it.
 */
export interface StorefrontCatalogProduct extends StorefrontProductPricing {
  id: string;
  name: string;
  description?: string | null;
  images: string[] | null;
  price: string;
  deposit?: string | null;
  /** Bookable quantity; `null` when stock is not tracked. */
  quantity: number | null;
  stockKind?: StockKind | null;
  displayQuantity?: number;
  category?: { id?: string; name: string; order?: number | null } | null;
  videoUrl?: string | null;
  accessories?: AccessoryLink[];
  trackUnits?: boolean | null;
  bookingAttributeAxes?: BookingAttributeAxis[] | null;
  units?: StorefrontProductUnit[];
}
