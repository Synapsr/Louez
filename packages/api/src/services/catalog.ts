import { and, asc, eq, gt, gte, inArray, isNotNull, or, sql } from "drizzle-orm";

import {
  categories,
  db,
  effectiveProductQuantitySql,
  marketplaceCatalogTombstones,
  productAccessories,
  productCategories,
  productPricingTiers,
  productSeasonalPricing,
  productSeasonalPricingTiers,
  productUnits,
  products,
  storeMarketplaceCategoryMappings,
  storeMarketplaceChannels,
  stores,
  variantDefinitions,
  variantValues,
} from "@louez/db";
import {
  calculateEffectivePrice,
  minutesToPriceDuration,
  normalizeAxisKey,
  perMinuteCost,
  pricingModeToMinutes,
  roundCurrency,
} from "@louez/utils";

import { ApiServiceError } from "./errors";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

type CatalogUrlBuilder = (storeSlug: string, path: string) => string;
type CatalogChannelStatus = "published" | "paused" | "disabled";
type PricingPeriod = "minute" | "hour" | "day" | "week";

interface CatalogListParams {
  cursor?: string;
  getCanonicalUrl: CatalogUrlBuilder;
  limit?: number;
}

interface CatalogCursor {
  id: string;
  updatedAt: Date;
}

interface CatalogTierSnapshot {
  minDuration: number;
  period: PricingPeriod;
  discountPercent: string | null;
  price: string | null;
  displayOrder: number;
}

export interface StoreSnapshot {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  logoUrl: string | null;
  currency: string;
  timezone: string;
  channel: {
    status: CatalogChannelStatus;
    publishedAt: string;
    updatedAt: string;
  };
  claimedBusinessId: string | null;
  categoryMappings: Array<{
    storeCategoryId: string;
    storeCategoryName: string;
    marketplaceCategorySlug: string;
  }>;
  storefrontUrl: string;
  updatedAt: string;
  version: number;
}

export interface ProductSnapshot {
  id: string;
  storeId: string;
  name: string;
  description: string | null;
  images: string[];
  videoUrl: string | null;
  marketplaceCategorySlug: string | null;
  storeCategoryIds: string[];
  pricing: {
    mode: "hour" | "day" | "week";
    basePrice: string;
    basePeriodMinutes: number;
    deposit: string;
    currency: string;
    enforceStrictTiers: boolean;
    tiers: CatalogTierSnapshot[];
    seasonal: Array<{
      name: string;
      startDate: string;
      endDate: string;
      price: string;
      tiers: CatalogTierSnapshot[];
    }>;
  };
  startingPrice: string;
  variantAxes: Array<{
    key: string;
    label: string;
    values: Array<{ label: string; colorHex: string | null }>;
  }>;
  quantity: number;
  accessoryProductIds: string[];
  bookingUrl: string;
  updatedAt: string;
  version: number;
}

const DEFAULT_VARIANT_ACTIVITY: ReadonlyArray<{
  active: boolean;
  aliases: readonly string[];
  key: string;
}> = [
  {
    key: "size",
    aliases: ["Taille", "Größe", "Talla", "Taglia", "Maat", "Rozmiar", "Tamanho"],
    active: true,
  },
  {
    key: "shoe-size",
    aliases: [
      "Pointure",
      "Shoe size",
      "Schuhgröße",
      "Número de calzado",
      "Numero di scarpe",
      "Schoenmaat",
      "Rozmiar buta",
      "Tamanho do calçado",
    ],
    active: false,
  },
  {
    key: "color",
    aliases: ["Couleur", "Farbe", "Colore", "Kleur", "Kolor", "Cor"],
    active: true,
  },
  {
    key: "material",
    aliases: ["Matière", "Material", "Materiale", "Materiaal", "Materiał"],
    active: false,
  },
];

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new ApiServiceError("BAD_REQUEST", "errors.invalidData");
  }
  return limit;
}

function encodeCursor(cursor: CatalogCursor): string {
  return Buffer.from(`${cursor.updatedAt.toISOString()}|${cursor.id}`, "utf8").toString(
    "base64url",
  );
}

function decodeCursor(value: string | undefined): CatalogCursor | null {
  if (!value) return null;

  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const separatorIndex = decoded.lastIndexOf("|");
    if (separatorIndex < 1) {
      throw new Error("Invalid cursor");
    }

    const updatedAt = new Date(decoded.slice(0, separatorIndex));
    const id = decoded.slice(separatorIndex + 1);
    if (Number.isNaN(updatedAt.getTime()) || id.length !== 21) {
      throw new Error("Invalid cursor");
    }

    return { id, updatedAt };
  } catch {
    throw new ApiServiceError("BAD_REQUEST", "errors.invalidData");
  }
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toNullableNumber(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function versionFromUpdatedAt(updatedAt: Date): number {
  return Math.floor(updatedAt.getTime());
}

function isCatalogChannelStatus(value: string): value is CatalogChannelStatus {
  return value === "published" || value === "paused" || value === "disabled";
}

function serializeTier(
  tier: {
    minDuration: number | null;
    period: number | null;
    discountPercent: string | null;
    price: string | null;
    displayOrder: number | null;
  },
  fallbackPeriod: "hour" | "day" | "week",
): CatalogTierSnapshot {
  const duration =
    tier.period && tier.period > 0
      ? minutesToPriceDuration(tier.period)
      : {
          duration: tier.minDuration ?? 1,
          unit: fallbackPeriod,
        };

  return {
    minDuration: duration.duration,
    period: duration.unit,
    discountPercent: tier.discountPercent,
    price: tier.price,
    displayOrder: tier.displayOrder ?? 0,
  };
}

function normalizedTierPrice(params: {
  basePeriodMinutes: number;
  basePrice: number;
  tier: {
    discountPercent: string | null;
    minDuration: number | null;
    period: number | null;
    price: string | null;
  };
}): number | null {
  const { basePeriodMinutes, basePrice, tier } = params;
  const explicitPrice = tier.price === null ? Number.NaN : Number(tier.price);
  const tierPeriod =
    tier.period ??
    (tier.minDuration && tier.minDuration > 0 ? tier.minDuration * basePeriodMinutes : null);

  if (Number.isFinite(explicitPrice) && tierPeriod && tierPeriod > 0) {
    return roundCurrency(perMinuteCost(explicitPrice, tierPeriod) * basePeriodMinutes);
  }

  const discountPercent = tier.discountPercent === null ? Number.NaN : Number(tier.discountPercent);
  if (!Number.isFinite(discountPercent)) return null;

  return calculateEffectivePrice(basePrice, {
    id: "catalog",
    minDuration: tier.minDuration,
    discountPercent,
    displayOrder: 0,
  });
}

function getStartingPrice(params: {
  basePeriodMinutes: number;
  basePrice: string;
  tiers: Array<{
    discountPercent: string | null;
    minDuration: number | null;
    period: number | null;
    price: string | null;
  }>;
  seasonal: Array<{
    price: string;
    tiers: Array<{
      discountPercent: string | null;
      minDuration: number | null;
      period: number | null;
      price: string | null;
    }>;
  }>;
}): string {
  const basePrice = Number(params.basePrice);
  const candidates = [basePrice];

  for (const tier of params.tiers) {
    const price = normalizedTierPrice({
      basePeriodMinutes: params.basePeriodMinutes,
      basePrice,
      tier,
    });
    if (price !== null) candidates.push(price);
  }

  for (const seasonal of params.seasonal) {
    const seasonalBasePrice = Number(seasonal.price);
    if (Number.isFinite(seasonalBasePrice)) candidates.push(seasonalBasePrice);
    for (const tier of seasonal.tiers) {
      const price = normalizedTierPrice({
        basePeriodMinutes: params.basePeriodMinutes,
        basePrice: seasonalBasePrice,
        tier,
      });
      if (price !== null) candidates.push(price);
    }
  }

  const finiteCandidates = candidates.filter(
    (candidate) => Number.isFinite(candidate) && candidate >= 0,
  );
  const startingPrice = finiteCandidates.length > 0 ? Math.min(...finiteCandidates) : basePrice;
  return String(roundCurrency(startingPrice));
}

export async function listStoreSnapshots(params: CatalogListParams): Promise<{
  data: StoreSnapshot[];
  nextCursor: string | null;
}> {
  const limit = normalizeLimit(params.limit);
  const cursor = decodeCursor(params.cursor);
  const snapshotUpdatedAt =
    sql<Date>`greatest(${stores.updatedAt}, ${storeMarketplaceChannels.updatedAt})`.mapWith(
      stores.updatedAt,
    );
  const cursorCondition = cursor
    ? or(
        gt(snapshotUpdatedAt, cursor.updatedAt),
        and(eq(snapshotUpdatedAt, cursor.updatedAt), gt(stores.id, cursor.id)),
      )
    : undefined;
  const channelStatusCondition = inArray(storeMarketplaceChannels.status, [
    "published",
    "paused",
    "disabled",
  ]);

  const rows = await db
    .select({
      id: stores.id,
      slug: stores.slug,
      name: stores.name,
      description: stores.description,
      email: stores.email,
      phone: stores.phone,
      address: stores.address,
      latitude: stores.latitude,
      longitude: stores.longitude,
      logoUrl: stores.logoUrl,
      settings: stores.settings,
      channelStatus: storeMarketplaceChannels.status,
      publishedAt: storeMarketplaceChannels.publishedAt,
      channelUpdatedAt: storeMarketplaceChannels.updatedAt,
      claimedBusinessId: storeMarketplaceChannels.claimedBusinessId,
      updatedAt: snapshotUpdatedAt,
      version: storeMarketplaceChannels.version,
    })
    .from(storeMarketplaceChannels)
    .innerJoin(stores, eq(storeMarketplaceChannels.storeId, stores.id))
    .where(
      and(
        eq(stores.onboardingCompleted, true),
        channelStatusCondition,
        isNotNull(storeMarketplaceChannels.publishedAt),
        cursorCondition,
      ),
    )
    .orderBy(asc(snapshotUpdatedAt), asc(stores.id))
    .limit(limit + 1);

  const pageRows = rows.slice(0, limit);
  const storeIds = pageRows.map((row) => row.id);
  const mappingRows =
    storeIds.length === 0
      ? []
      : await db
          .select({
            storeId: storeMarketplaceCategoryMappings.storeId,
            storeCategoryId: categories.id,
            storeCategoryName: categories.name,
            marketplaceCategorySlug: storeMarketplaceCategoryMappings.marketplaceCategorySlug,
          })
          .from(storeMarketplaceCategoryMappings)
          .innerJoin(
            categories,
            and(
              eq(storeMarketplaceCategoryMappings.categoryId, categories.id),
              eq(storeMarketplaceCategoryMappings.storeId, categories.storeId),
            ),
          )
          .where(inArray(storeMarketplaceCategoryMappings.storeId, storeIds))
          .orderBy(
            asc(storeMarketplaceCategoryMappings.storeId),
            asc(categories.name),
            asc(categories.id),
          );
  const mappingsByStore = new Map<string, StoreSnapshot["categoryMappings"]>();
  for (const mapping of mappingRows) {
    const current = mappingsByStore.get(mapping.storeId) ?? [];
    current.push({
      storeCategoryId: mapping.storeCategoryId,
      storeCategoryName: mapping.storeCategoryName,
      marketplaceCategorySlug: mapping.marketplaceCategorySlug,
    });
    mappingsByStore.set(mapping.storeId, current);
  }

  const data = pageRows.map((row): StoreSnapshot => {
    if (!row.publishedAt || !isCatalogChannelStatus(row.channelStatus)) {
      throw new ApiServiceError("INTERNAL_SERVER_ERROR", "errors.internalServerError");
    }

    const updatedAt = toDate(row.updatedAt);
    const channelUpdatedAt = toDate(row.channelUpdatedAt);
    const publishedAt = toDate(row.publishedAt);

    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      email: row.email,
      phone: row.phone,
      address: row.address,
      latitude: toNullableNumber(row.latitude),
      longitude: toNullableNumber(row.longitude),
      logoUrl: row.logoUrl,
      currency: row.settings?.currency ?? "EUR",
      timezone: row.settings?.timezone ?? "Europe/Paris",
      channel: {
        status: row.channelStatus,
        publishedAt: publishedAt.toISOString(),
        updatedAt: channelUpdatedAt.toISOString(),
      },
      claimedBusinessId: row.claimedBusinessId,
      categoryMappings: mappingsByStore.get(row.id) ?? [],
      storefrontUrl: params.getCanonicalUrl(row.slug, "/"),
      updatedAt: updatedAt.toISOString(),
      version: row.version,
    };
  });
  const lastRow = pageRows.at(-1);

  return {
    data,
    nextCursor:
      rows.length > limit && lastRow
        ? encodeCursor({
            id: lastRow.id,
            updatedAt: toDate(lastRow.updatedAt),
          })
        : null,
  };
}

export async function listProductSnapshots(params: CatalogListParams): Promise<{
  data: ProductSnapshot[];
  nextCursor: string | null;
}> {
  const limit = normalizeLimit(params.limit);
  const cursor = decodeCursor(params.cursor);
  const snapshotUpdatedAt = sql<Date>`greatest(
    ${products.updatedAt},
    ${stores.updatedAt},
    ${storeMarketplaceChannels.updatedAt},
    coalesce(
      (select max(${productPricingTiers.updatedAt})
       from ${productPricingTiers}
       where ${productPricingTiers.productId} = ${products.id}),
      ${products.updatedAt}
    ),
    coalesce(
      (select max(${productSeasonalPricing.updatedAt})
       from ${productSeasonalPricing}
       where ${productSeasonalPricing.productId} = ${products.id}),
      ${products.updatedAt}
    ),
    coalesce(
      (select max(${productSeasonalPricingTiers.updatedAt})
       from ${productSeasonalPricingTiers}
       inner join ${productSeasonalPricing}
         on ${productSeasonalPricing.id} = ${productSeasonalPricingTiers.seasonalPricingId}
       where ${productSeasonalPricing.productId} = ${products.id}),
      ${products.updatedAt}
    ),
    coalesce(
      (select max(${productUnits.updatedAt})
       from ${productUnits}
       where ${productUnits.productId} = ${products.id}),
      ${products.updatedAt}
    ),
    coalesce(
      (select max(${variantDefinitions.updatedAt})
       from ${variantDefinitions}
       where ${variantDefinitions.storeId} = ${products.storeId}),
      ${products.updatedAt}
    ),
    coalesce(
      (select max(${variantValues.createdAt})
       from ${variantValues}
       inner join ${variantDefinitions}
         on ${variantDefinitions.id} = ${variantValues.definitionId}
       where ${variantDefinitions.storeId} = ${products.storeId}),
      ${products.updatedAt}
    )
  )`.mapWith(products.updatedAt);
  const cursorCondition = cursor
    ? or(
        gt(snapshotUpdatedAt, cursor.updatedAt),
        and(eq(snapshotUpdatedAt, cursor.updatedAt), gt(products.id, cursor.id)),
      )
    : undefined;

  const rows = await db
    .select({
      id: products.id,
      storeId: products.storeId,
      storeSlug: stores.slug,
      storeSettings: stores.settings,
      legacyCategoryId: products.categoryId,
      name: products.name,
      description: products.description,
      images: products.images,
      price: products.price,
      deposit: products.deposit,
      basePeriodMinutes: products.basePeriodMinutes,
      pricingMode: products.pricingMode,
      videoUrl: products.videoUrl,
      enforceStrictTiers: products.enforceStrictTiers,
      bookingAttributeAxes: products.bookingAttributeAxes,
      quantity: effectiveProductQuantitySql(),
      updatedAt: snapshotUpdatedAt,
    })
    .from(products)
    .innerJoin(stores, eq(products.storeId, stores.id))
    .innerJoin(storeMarketplaceChannels, eq(products.storeId, storeMarketplaceChannels.storeId))
    .where(
      and(
        eq(products.status, "active"),
        eq(stores.onboardingCompleted, true),
        eq(storeMarketplaceChannels.status, "published"),
        cursorCondition,
      ),
    )
    .orderBy(asc(snapshotUpdatedAt), asc(products.id))
    .limit(limit + 1);

  const pageRows = rows.slice(0, limit);
  const productIds = pageRows.map((row) => row.id);
  const storeIds = [...new Set(pageRows.map((row) => row.storeId))];
  const legacyCategoryIds = pageRows.flatMap((row) =>
    row.legacyCategoryId ? [row.legacyCategoryId] : [],
  );
  if (productIds.length === 0) {
    return { data: [], nextCursor: null };
  }

  const [
    categoryRows,
    legacyCategoryRows,
    mappingRows,
    tierRows,
    seasonalRows,
    accessoryRows,
    unitRows,
    definitionRows,
  ] = await Promise.all([
    db
      .select({
        productId: productCategories.productId,
        categoryId: productCategories.categoryId,
        categoryStoreId: categories.storeId,
        position: productCategories.position,
      })
      .from(productCategories)
      .innerJoin(categories, eq(productCategories.categoryId, categories.id))
      .where(inArray(productCategories.productId, productIds))
      .orderBy(
        asc(productCategories.productId),
        asc(productCategories.position),
        asc(productCategories.id),
      ),
    legacyCategoryIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ id: categories.id, storeId: categories.storeId })
          .from(categories)
          .where(
            and(inArray(categories.id, legacyCategoryIds), inArray(categories.storeId, storeIds)),
          ),
    db
      .select({
        storeId: storeMarketplaceCategoryMappings.storeId,
        categoryId: storeMarketplaceCategoryMappings.categoryId,
        marketplaceCategorySlug: storeMarketplaceCategoryMappings.marketplaceCategorySlug,
      })
      .from(storeMarketplaceCategoryMappings)
      .where(inArray(storeMarketplaceCategoryMappings.storeId, storeIds)),
    db
      .select({
        id: productPricingTiers.id,
        productId: productPricingTiers.productId,
        minDuration: productPricingTiers.minDuration,
        period: productPricingTiers.period,
        discountPercent: productPricingTiers.discountPercent,
        price: productPricingTiers.price,
        displayOrder: productPricingTiers.displayOrder,
      })
      .from(productPricingTiers)
      .where(inArray(productPricingTiers.productId, productIds))
      .orderBy(
        asc(productPricingTiers.productId),
        asc(productPricingTiers.displayOrder),
        asc(productPricingTiers.id),
      ),
    db
      .select({
        id: productSeasonalPricing.id,
        productId: productSeasonalPricing.productId,
        name: productSeasonalPricing.name,
        startDate: productSeasonalPricing.startDate,
        endDate: productSeasonalPricing.endDate,
        price: productSeasonalPricing.price,
      })
      .from(productSeasonalPricing)
      .where(inArray(productSeasonalPricing.productId, productIds))
      .orderBy(
        asc(productSeasonalPricing.productId),
        asc(productSeasonalPricing.startDate),
        asc(productSeasonalPricing.id),
      ),
    db
      .select({
        productId: productAccessories.productId,
        accessoryId: productAccessories.accessoryId,
        displayOrder: productAccessories.displayOrder,
      })
      .from(productAccessories)
      .where(inArray(productAccessories.productId, productIds))
      .orderBy(
        asc(productAccessories.productId),
        asc(productAccessories.displayOrder),
        asc(productAccessories.id),
      ),
    db
      .select({
        productId: productUnits.productId,
        attributes: productUnits.attributes,
      })
      .from(productUnits)
      .where(
        and(
          inArray(productUnits.productId, productIds),
          eq(productUnits.lifecycleStatus, "active"),
        ),
      ),
    db
      .select({
        id: variantDefinitions.id,
        storeId: variantDefinitions.storeId,
        key: variantDefinitions.key,
        label: variantDefinitions.label,
        isActive: variantDefinitions.isActive,
      })
      .from(variantDefinitions)
      .where(inArray(variantDefinitions.storeId, storeIds)),
  ]);

  const seasonalIds = seasonalRows.map((seasonal) => seasonal.id);
  const seasonalTierRows =
    seasonalIds.length === 0
      ? []
      : await db
          .select({
            id: productSeasonalPricingTiers.id,
            seasonalPricingId: productSeasonalPricingTiers.seasonalPricingId,
            minDuration: productSeasonalPricingTiers.minDuration,
            period: productSeasonalPricingTiers.period,
            discountPercent: productSeasonalPricingTiers.discountPercent,
            price: productSeasonalPricingTiers.price,
            displayOrder: productSeasonalPricingTiers.displayOrder,
          })
          .from(productSeasonalPricingTiers)
          .where(inArray(productSeasonalPricingTiers.seasonalPricingId, seasonalIds))
          .orderBy(
            asc(productSeasonalPricingTiers.seasonalPricingId),
            asc(productSeasonalPricingTiers.displayOrder),
            asc(productSeasonalPricingTiers.id),
          );
  const definitionIds = definitionRows.map((definition) => definition.id);
  const valueRows =
    definitionIds.length === 0
      ? []
      : await db
          .select({
            definitionId: variantValues.definitionId,
            label: variantValues.label,
            colorHex: variantValues.colorHex,
            position: variantValues.position,
          })
          .from(variantValues)
          .where(inArray(variantValues.definitionId, definitionIds))
          .orderBy(
            asc(variantValues.definitionId),
            asc(variantValues.position),
            asc(variantValues.id),
          );

  const categoryIdsByProduct = new Map<string, string[]>();
  for (const category of categoryRows) {
    const product = pageRows.find((row) => row.id === category.productId);
    if (!product || category.categoryStoreId !== product.storeId) continue;
    const current = categoryIdsByProduct.get(category.productId) ?? [];
    current.push(category.categoryId);
    categoryIdsByProduct.set(category.productId, current);
  }
  for (const product of pageRows) {
    if (
      !categoryIdsByProduct.has(product.id) &&
      product.legacyCategoryId &&
      legacyCategoryRows.some(
        (category) =>
          category.id === product.legacyCategoryId && category.storeId === product.storeId,
      )
    ) {
      categoryIdsByProduct.set(product.id, [product.legacyCategoryId]);
    }
  }

  const categorySlugByStoreCategory = new Map(
    mappingRows.map((mapping) => [
      `${mapping.storeId}:${mapping.categoryId}`,
      mapping.marketplaceCategorySlug,
    ]),
  );
  const tiersByProduct = new Map<string, typeof tierRows>();
  for (const tier of tierRows) {
    const current = tiersByProduct.get(tier.productId) ?? [];
    current.push(tier);
    tiersByProduct.set(tier.productId, current);
  }
  const seasonalTiersBySeason = new Map<string, typeof seasonalTierRows>();
  for (const tier of seasonalTierRows) {
    const current = seasonalTiersBySeason.get(tier.seasonalPricingId) ?? [];
    current.push(tier);
    seasonalTiersBySeason.set(tier.seasonalPricingId, current);
  }
  const seasonalByProduct = new Map<
    string,
    Array<(typeof seasonalRows)[number] & { tiers: typeof seasonalTierRows }>
  >();
  for (const seasonal of seasonalRows) {
    const current = seasonalByProduct.get(seasonal.productId) ?? [];
    current.push({
      ...seasonal,
      tiers: seasonalTiersBySeason.get(seasonal.id) ?? [],
    });
    seasonalByProduct.set(seasonal.productId, current);
  }
  const accessoriesByProduct = new Map<string, string[]>();
  for (const accessory of accessoryRows) {
    const current = accessoriesByProduct.get(accessory.productId) ?? [];
    current.push(accessory.accessoryId);
    accessoriesByProduct.set(accessory.productId, current);
  }
  const unitAttributesByProduct = new Map<string, Array<Record<string, string>>>();
  for (const unit of unitRows) {
    if (!unit.attributes) continue;
    const current = unitAttributesByProduct.get(unit.productId) ?? [];
    current.push(unit.attributes);
    unitAttributesByProduct.set(unit.productId, current);
  }
  const definitionsByStore = new Map<string, typeof definitionRows>();
  for (const definition of definitionRows) {
    const current = definitionsByStore.get(definition.storeId) ?? [];
    current.push(definition);
    definitionsByStore.set(definition.storeId, current);
  }
  const valuesByDefinition = new Map<string, typeof valueRows>();
  for (const value of valueRows) {
    const current = valuesByDefinition.get(value.definitionId) ?? [];
    current.push(value);
    valuesByDefinition.set(value.definitionId, current);
  }

  const data = pageRows.map((row): ProductSnapshot => {
    const basePeriodMinutes = row.basePeriodMinutes ?? pricingModeToMinutes(row.pricingMode);
    const tiers = tiersByProduct.get(row.id) ?? [];
    const seasonal = seasonalByProduct.get(row.id) ?? [];
    const storeCategoryIds = categoryIdsByProduct.get(row.id) ?? [];
    const marketplaceCategorySlug =
      storeCategoryIds.flatMap((categoryId) => {
        const slug = categorySlugByStoreCategory.get(`${row.storeId}:${categoryId}`);
        return slug ? [slug] : [];
      })[0] ?? null;
    const definitions = definitionsByStore.get(row.storeId) ?? [];
    const activityByKey = new Map<string, boolean>();
    const defaultKeyByAlias = new Map<string, string>();
    for (const preset of DEFAULT_VARIANT_ACTIVITY) {
      const normalizedKey = normalizeAxisKey(preset.key);
      activityByKey.set(normalizedKey, preset.active);
      defaultKeyByAlias.set(normalizedKey, normalizedKey);
      for (const alias of preset.aliases) {
        const normalizedAlias = normalizeAxisKey(alias);
        activityByKey.set(normalizedAlias, preset.active);
        defaultKeyByAlias.set(normalizedAlias, normalizedKey);
      }
    }
    for (const definition of definitions) {
      const normalizedKey = normalizeAxisKey(definition.key);
      const normalizedLabel = normalizeAxisKey(definition.label);
      const defaultKey =
        defaultKeyByAlias.get(normalizedKey) ?? defaultKeyByAlias.get(normalizedLabel);
      activityByKey.set(normalizedKey, definition.isActive);
      activityByKey.set(normalizedLabel, definition.isActive);
      if (defaultKey) activityByKey.set(defaultKey, definition.isActive);
    }
    const axes = [...(row.bookingAttributeAxes ?? [])]
      .sort((left, right) => left.position - right.position)
      .filter((axis) => {
        const keyStatus = activityByKey.get(normalizeAxisKey(axis.key));
        if (keyStatus !== undefined) return keyStatus;
        return activityByKey.get(normalizeAxisKey(axis.label)) ?? true;
      });
    const unitAttributes = unitAttributesByProduct.get(row.id) ?? [];
    const variantAxes = axes.map((axis) => {
      const definition = definitions.find(
        (candidate) =>
          normalizeAxisKey(candidate.key) === normalizeAxisKey(axis.key) ||
          normalizeAxisKey(candidate.label) === normalizeAxisKey(axis.label),
      );
      const colorsByLabel = new Map(
        (definition ? (valuesByDefinition.get(definition.id) ?? []) : []).map((value) => [
          value.label,
          value.colorHex,
        ]),
      );
      const labels = [
        ...new Set(
          unitAttributes.flatMap((attributes) => {
            const value = attributes[axis.key]?.trim();
            return value ? [value] : [];
          }),
        ),
      ].sort((left, right) => left.localeCompare(right, "en"));

      return {
        key: axis.key,
        label: axis.label,
        values: labels.map((label) => ({
          label,
          colorHex: colorsByLabel.get(label) ?? null,
        })),
      };
    });
    const serializedSeasonal = seasonal.map((season) => ({
      name: season.name,
      startDate: season.startDate,
      endDate: season.endDate,
      price: season.price,
      tiers: season.tiers.map((tier) => serializeTier(tier, row.pricingMode)),
    }));
    const updatedAt = toDate(row.updatedAt);
    const bookingUrl = new URL(params.getCanonicalUrl(row.storeSlug, `/product/${row.id}`));
    bookingUrl.searchParams.set("channel", "marketplace");

    return {
      id: row.id,
      storeId: row.storeId,
      name: row.name,
      description: row.description,
      images: row.images ?? [],
      videoUrl: row.videoUrl,
      marketplaceCategorySlug,
      storeCategoryIds,
      pricing: {
        mode: row.pricingMode,
        basePrice: row.price,
        basePeriodMinutes,
        deposit: row.deposit ?? "0.00",
        currency: row.storeSettings?.currency ?? "EUR",
        enforceStrictTiers: row.enforceStrictTiers,
        tiers: tiers.map((tier) => serializeTier(tier, row.pricingMode)),
        seasonal: serializedSeasonal,
      },
      startingPrice: getStartingPrice({
        basePeriodMinutes,
        basePrice: row.price,
        tiers,
        seasonal,
      }),
      variantAxes,
      quantity: row.quantity,
      accessoryProductIds: accessoriesByProduct.get(row.id) ?? [],
      bookingUrl: bookingUrl.toString(),
      updatedAt: updatedAt.toISOString(),
      version: versionFromUpdatedAt(updatedAt),
    };
  });
  const lastRow = pageRows.at(-1);

  return {
    data,
    nextCursor:
      rows.length > limit && lastRow
        ? encodeCursor({
            id: lastRow.id,
            updatedAt: toDate(lastRow.updatedAt),
          })
        : null,
  };
}

export async function listTombstones(params: {
  cursor?: string;
  limit?: number;
  since: Date;
}): Promise<{
  data: Array<{
    entityType: "store" | "product";
    entityId: string;
    deletedAt: string;
  }>;
  nextCursor: string | null;
}> {
  if (Number.isNaN(params.since.getTime())) {
    throw new ApiServiceError("BAD_REQUEST", "errors.invalidData");
  }

  const limit = normalizeLimit(params.limit);
  const cursor = decodeCursor(params.cursor);
  const cursorCondition = cursor
    ? or(
        gt(marketplaceCatalogTombstones.deletedAt, cursor.updatedAt),
        and(
          eq(marketplaceCatalogTombstones.deletedAt, cursor.updatedAt),
          gt(marketplaceCatalogTombstones.id, cursor.id),
        ),
      )
    : undefined;
  const rows = await db
    .select({
      id: marketplaceCatalogTombstones.id,
      entityType: marketplaceCatalogTombstones.entityType,
      entityId: marketplaceCatalogTombstones.entityId,
      deletedAt: marketplaceCatalogTombstones.deletedAt,
    })
    .from(marketplaceCatalogTombstones)
    .where(and(gte(marketplaceCatalogTombstones.deletedAt, params.since), cursorCondition))
    .orderBy(asc(marketplaceCatalogTombstones.deletedAt), asc(marketplaceCatalogTombstones.id))
    .limit(limit + 1);
  const pageRows = rows.slice(0, limit);
  const lastRow = pageRows.at(-1);

  return {
    data: pageRows.map((row) => ({
      entityType: row.entityType,
      entityId: row.entityId,
      deletedAt: row.deletedAt.toISOString(),
    })),
    nextCursor:
      rows.length > limit && lastRow
        ? encodeCursor({
            id: lastRow.id,
            updatedAt: lastRow.deletedAt,
          })
        : null,
  };
}
