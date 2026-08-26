import { and, eq, inArray } from 'drizzle-orm';

import {
  db,
  productSeasonalPricing,
  productSeasonalPricingTiers,
  productAccessories,
  products,
  stores,
} from '@louez/db';
import type {
  PricingKind,
  PricingMode,
  StockKind,
  UnitAttributes,
} from '@louez/types';
import {
  type SeasonalPricingConfig,
  matchesSelectedAttributes,
} from '@louez/utils';

import { getStorefrontAvailability } from './availability';
import { ApiServiceError } from './errors';

interface ResolveStorefrontCartParams {
  storeSlug: string;
  lines: Array<{
    lineId: string;
    parentLineId?: string;
    productId: string;
    quantity: number;
    startDate: string;
    endDate: string;
    selectedAttributes?: UnitAttributes;
  }>;
}

type CartLineResolution =
  | {
      status: 'resolved';
      lineId: string;
      productId: string;
      productName: string;
      productImage: string | null;
      price: number;
      deposit: number;
      maxQuantity: number;
      quantity: number;
      pricingKind: PricingKind;
      stockKind: StockKind;
      parentLineId?: string;
      required: boolean;
      requiredQuantity: number | null;
      requiredAccessories: Array<{
        productId: string;
        required: true;
        quantity: number;
      }>;
      pricingMode: PricingMode;
      productPricingMode: PricingMode;
      basePeriodMinutes: number | null;
      enforceStrictTiers: boolean;
      pricingTiers: Array<{
        id: string;
        minDuration: number;
        discountPercent: number;
        period: number | null;
        price: number | null;
      }>;
      seasonalPricings?: SeasonalPricingConfig[];
    }
  | {
      status: 'unavailable';
      lineId: string;
      productId: string;
      reason:
        | 'product_unavailable'
        | 'insufficient_stock'
        | 'required_accessory_unavailable';
      maxQuantity?: number;
      parentLineId?: string;
    };

function getPrimaryProductImage(images: unknown): string | null {
  if (!Array.isArray(images)) {
    return null;
  }

  const image = images.find(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  return image || null;
}

async function getSeasonalPricings(productIds: string[]) {
  if (productIds.length === 0) {
    return new Map<string, SeasonalPricingConfig[]>();
  }

  const seasonalPricingsRaw = await db
    .select()
    .from(productSeasonalPricing)
    .where(inArray(productSeasonalPricing.productId, productIds));

  if (seasonalPricingsRaw.length === 0) {
    return new Map<string, SeasonalPricingConfig[]>();
  }

  const seasonalPricingIds = seasonalPricingsRaw.map(
    (seasonalPricing) => seasonalPricing.id,
  );
  const seasonalPricingTiersRaw = await db
    .select()
    .from(productSeasonalPricingTiers)
    .where(
      inArray(
        productSeasonalPricingTiers.seasonalPricingId,
        seasonalPricingIds,
      ),
    );

  const tiersBySeasonalPricingId = new Map<
    string,
    typeof seasonalPricingTiersRaw
  >();
  for (const tier of seasonalPricingTiersRaw) {
    const tiers = tiersBySeasonalPricingId.get(tier.seasonalPricingId) || [];
    tiers.push(tier);
    tiersBySeasonalPricingId.set(tier.seasonalPricingId, tiers);
  }

  const byProductId = new Map<string, SeasonalPricingConfig[]>();
  for (const seasonalPricing of seasonalPricingsRaw) {
    const tiers = tiersBySeasonalPricingId.get(seasonalPricing.id) || [];
    const current = byProductId.get(seasonalPricing.productId) || [];

    current.push({
      id: seasonalPricing.id,
      name: seasonalPricing.name,
      startDate: seasonalPricing.startDate,
      endDate: seasonalPricing.endDate,
      basePrice: Number(seasonalPricing.price),
      tiers: tiers
        .filter(
          (tier) => tier.minDuration !== null && tier.discountPercent !== null,
        )
        .map((tier) => ({
          id: tier.id,
          minDuration: tier.minDuration!,
          discountPercent: Number(tier.discountPercent!),
          displayOrder: tier.displayOrder ?? 0,
        })),
      rates: tiers
        .filter((tier) => tier.period !== null && tier.price !== null)
        .map((tier) => ({
          id: tier.id,
          period: tier.period!,
          price: Number(tier.price!),
          displayOrder: tier.displayOrder ?? 0,
        })),
    });

    byProductId.set(seasonalPricing.productId, current);
  }

  return byProductId;
}

export async function resolveStorefrontCart(
  params: ResolveStorefrontCartParams,
): Promise<{ lines: CartLineResolution[] }> {
  const { storeSlug, lines } = params;

  if (lines.length === 0) {
    return { lines: [] };
  }

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, storeSlug),
    columns: { id: true },
  });

  if (!store) {
    throw new ApiServiceError('NOT_FOUND', 'errors.storeNotFound');
  }

  const productIds = [...new Set(lines.map((line) => line.productId))];
  const storeProducts = await db.query.products.findMany({
    where: and(
      eq(products.storeId, store.id),
      eq(products.status, 'active'),
      inArray(products.id, productIds),
    ),
    with: {
      pricingTiers: true,
    },
  });

  const productsById = new Map(
    storeProducts.map((product) => [product.id, product]),
  );
  const requiredAccessoryLinks = await db
    .select({
      parentProductId: productAccessories.productId,
      accessoryProductId: productAccessories.accessoryId,
      quantity: productAccessories.quantity,
    })
    .from(productAccessories)
    .innerJoin(products, eq(productAccessories.productId, products.id))
    .where(
      and(
        eq(products.storeId, store.id),
        eq(productAccessories.required, true),
        inArray(productAccessories.productId, productIds),
      ),
    );
  const requiredAccessoriesByParentId = new Map<
    string,
    typeof requiredAccessoryLinks
  >();
  for (const link of requiredAccessoryLinks) {
    requiredAccessoriesByParentId.set(link.parentProductId, [
      ...(requiredAccessoriesByParentId.get(link.parentProductId) ?? []),
      link,
    ]);
  }
  const lineById = new Map(lines.map((line) => [line.lineId, line]));
  const availabilityProductIds = [
    ...new Set([
      ...productIds,
      ...requiredAccessoryLinks.map((link) => link.accessoryProductId),
    ]),
  ];
  const seasonalPricingsByProductId = await getSeasonalPricings(
    storeProducts.map((product) => product.id),
  );

  const availabilityByPeriod = new Map<
    string,
    Awaited<ReturnType<typeof getStorefrontAvailability>>
  >();
  const getAvailability = async (startDate: string, endDate: string) => {
    const key = `${startDate}:${endDate}`;
    const existing = availabilityByPeriod.get(key);
    if (existing) {
      return existing;
    }

    const availability = await getStorefrontAvailability({
      storeSlug,
      startDate,
      endDate,
      productIds: availabilityProductIds,
    });
    availabilityByPeriod.set(key, availability);
    return availability;
  };

  const resolvedLines: CartLineResolution[] = [];

  for (const line of lines) {
    const product = productsById.get(line.productId);
    if (!product) {
      resolvedLines.push({
        status: 'unavailable',
        lineId: line.lineId,
        parentLineId: line.parentLineId,
        productId: line.productId,
        reason: 'product_unavailable',
      });
      continue;
    }

    const availability = await getAvailability(line.startDate, line.endDate);
    const productAvailability = availability.products.find(
      (item) => item.productId === line.productId,
    );
    const ownMaxQuantity =
      product.trackUnits && productAvailability?.combinations?.length
        ? productAvailability.combinations
            .filter((combination) =>
              matchesSelectedAttributes(
                line.selectedAttributes,
                combination.selectedAttributes,
              ),
            )
            .reduce(
              (sum, combination) => sum + combination.availableQuantity,
              0,
            )
        : (productAvailability?.availableQuantity ?? 0);
    const requiredAccessories =
      requiredAccessoriesByParentId.get(product.id) ?? [];
    const requiredAccessoryMaxQuantity = requiredAccessories.reduce(
      (maximum, link) => {
        const accessoryAvailability = availability.products.find(
          (item) => item.productId === link.accessoryProductId,
        );
        return Math.min(
          maximum,
          Math.floor(
            (accessoryAvailability?.availableQuantity ?? 0) /
              Math.max(1, link.quantity),
          ),
        );
      },
      Number.POSITIVE_INFINITY,
    );
    const maxQuantity = Math.min(ownMaxQuantity, requiredAccessoryMaxQuantity);

    if (maxQuantity < line.quantity) {
      resolvedLines.push({
        status: 'unavailable',
        lineId: line.lineId,
        parentLineId: line.parentLineId,
        productId: line.productId,
        reason:
          requiredAccessoryMaxQuantity < line.quantity
            ? 'required_accessory_unavailable'
            : 'insufficient_stock',
        maxQuantity,
      });
      continue;
    }

    const parentLine = line.parentLineId
      ? lineById.get(line.parentLineId)
      : undefined;
    const requiredLink = parentLine
      ? requiredAccessoryLinks.find(
          (link) =>
            link.parentProductId === parentLine.productId &&
            link.accessoryProductId === line.productId,
        )
      : undefined;

    resolvedLines.push({
      status: 'resolved',
      lineId: line.lineId,
      productId: product.id,
      productName: product.name,
      productImage: getPrimaryProductImage(product.images),
      price: Number(product.price),
      deposit: Number(product.deposit || 0),
      maxQuantity: Math.max(1, maxQuantity),
      quantity: line.quantity,
      pricingKind: product.pricingKind,
      stockKind: product.stockKind,
      parentLineId: line.parentLineId,
      required: Boolean(requiredLink),
      requiredQuantity: requiredLink
        ? Math.max(1, requiredLink.quantity)
        : null,
      requiredAccessories: requiredAccessories.map((link) => ({
        productId: link.accessoryProductId,
        required: true,
        quantity: Math.max(1, link.quantity),
      })),
      pricingMode: product.pricingMode,
      productPricingMode: product.pricingMode,
      basePeriodMinutes: product.basePeriodMinutes ?? null,
      enforceStrictTiers: product.enforceStrictTiers ?? false,
      pricingTiers: (product.pricingTiers || []).map((tier) => ({
        id: tier.id,
        minDuration: tier.minDuration ?? 1,
        discountPercent: Number(tier.discountPercent ?? 0),
        period: tier.period ?? null,
        price: tier.price !== null ? Number(tier.price) : null,
      })),
      seasonalPricings:
        seasonalPricingsByProductId.get(product.id) || undefined,
    });
  }

  return { lines: resolvedLines };
}
