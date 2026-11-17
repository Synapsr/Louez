import { and, eq, inArray } from "drizzle-orm";

import type { Database } from "@louez/db";
import {
  productPricingTiers,
  productSeasonalPricing,
  productSeasonalPricingTiers,
  products,
} from "@louez/db/schema";

import {
  buildSeasonalPricingConfigs,
  toPricingCatalogProduct,
  type PricingCatalog,
  type PricingTierRow,
} from "./catalogue-line-pricing";

/**
 * Load every active product of the store referenced by `productIds` with its
 * pricing tiers and seasonal configs, in four queries regardless of cart size.
 * Missing ids are simply absent from the map.
 */
export const loadPricingCatalog = async (
  database: Pick<Database, "select">,
  params: {
    storeId: string;
    productIds: string[];
    timezone?: string;
    /** Also the store's products that are not active: an edit reprices a line whose product was archived since. */
    includeInactive?: boolean;
  },
): Promise<PricingCatalog> => {
  const productIds = [...new Set(params.productIds)];
  if (productIds.length === 0) {
    return new Map();
  }

  const productRows = await database
    .select()
    .from(products)
    .where(
      and(
        eq(products.storeId, params.storeId),
        params.includeInactive ? undefined : eq(products.status, "active"),
        inArray(products.id, productIds),
      ),
    );
  if (productRows.length === 0) {
    return new Map();
  }

  const foundIds = productRows.map((product) => product.id);
  const [tierRows, seasonalRows] = await Promise.all([
    database
      .select()
      .from(productPricingTiers)
      .where(inArray(productPricingTiers.productId, foundIds)),
    database
      .select()
      .from(productSeasonalPricing)
      .where(inArray(productSeasonalPricing.productId, foundIds)),
  ]);
  const seasonalTierRows =
    seasonalRows.length > 0
      ? await database
          .select()
          .from(productSeasonalPricingTiers)
          .where(
            inArray(
              productSeasonalPricingTiers.seasonalPricingId,
              seasonalRows.map((row) => row.id),
            ),
          )
      : [];

  const tiersByProductId = new Map<string, PricingTierRow[]>();
  for (const tier of tierRows) {
    const tiers = tiersByProductId.get(tier.productId) || [];
    tiers.push(tier);
    tiersByProductId.set(tier.productId, tiers);
  }
  const seasonalByProductId = buildSeasonalPricingConfigs(seasonalRows, seasonalTierRows);

  return new Map(
    productRows.map((product) => [
      product.id,
      {
        ...(params.timezone ? { timezone: params.timezone } : {}),
        ...toPricingCatalogProduct(
          product,
          tiersByProductId.get(product.id) || [],
          seasonalByProductId.get(product.id) || [],
        ),
      },
    ]),
  );
};
