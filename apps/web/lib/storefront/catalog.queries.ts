import "server-only";

import { cache } from "react";

import { and, asc, eq, exists, gte, inArray, like, notExists, or, sql } from "drizzle-orm";
import { z } from "zod";

import { getStorefrontAvailability } from "@louez/api/services";

import {
  categories,
  db,
  effectiveProductQuantitySql,
  productAccessories,
  productCategories,
  productPricingTiers,
  productSeasonalPricing,
  productSeasonalPricingTiers,
  productUnits,
  products,
  stores,
} from "@louez/db";
import type { BookingAttributeAxis } from "@louez/types";
import type { SeasonalPricingConfig } from "@louez/utils";

import {
  ALL_CATEGORIES_VALUE,
  CATALOG_PAGE_SIZE,
  CATALOG_SORT_VALUES,
  type CatalogSort,
  DEFAULT_CATALOG_SORT,
  UNCATEGORIZED_CATEGORY_VALUE,
  isReservedCategoryValue,
} from "@/lib/storefront/catalog.constants";
import type {
  AccessoryLink,
  StorefrontCatalogProduct,
  StorefrontPricingTier,
} from "@/lib/storefront/storefront.types";
import { filterActiveVariantAxes } from "@/lib/util.variant-visibility";
import { getStoreVariantActivity } from "@/lib/util.variant-visibility.server";
import {
  type BrowsableCategory,
  type CatalogAttributeFilters,
  type CatalogFilters,
  readAttributeParams,
  readCatalogAvailability,
} from "@/lib/utils/util.rental-browse";
import { getStorefrontPricingSummary } from "@/lib/utils/util.storefront-pricing";
import { getStorefrontProductPrice } from "@/lib/utils/util.storefront-product-pricing";
import { inferAttributeAxesFromUnits } from "@/lib/utils/util.variant-combinations";

// ---------------------------------------------------------------------------
// Search params
// ---------------------------------------------------------------------------

const isoDateTime = z.string().datetime({ offset: true });

/** A price bound: a positive amount, capped so a hand-typed URL stays sane. */
const priceBound = z.coerce.number().nonnegative().max(1_000_000);

/** Each key is parsed on its own: a bad value is dropped, never a 400. */
const catalogSearchParamsSchema = z.object({
  category: z.string().trim().min(1).max(64).optional().catch(undefined),
  search: z.string().trim().max(120).optional().catch(undefined),
  startDate: isoDateTime.optional().catch(undefined),
  endDate: isoDateTime.optional().catch(undefined),
  sort: z.enum(CATALOG_SORT_VALUES).optional().catch(undefined),
  minPrice: priceBound.optional().catch(undefined),
  maxPrice: priceBound.optional().catch(undefined),
  availableOnly: z.enum(["0", "1"]).optional().catch(undefined),
  quantity: z.coerce.number().int().min(2).max(999).optional().catch(undefined),
  attr: z.array(z.string().trim().min(3).max(120)).max(40).optional().catch(undefined),
});

type RawSearchParams = Record<string, string | string[] | undefined>;

const firstValue = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const allValues = (value: string | string[] | undefined): string[] | undefined =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];

/**
 * The catalog URL as filters. Dates only count as a pair, in order; a
 * broken pair means "no dates" so the page still renders.
 */
export const parseCatalogSearchParams = (raw: RawSearchParams): CatalogFilters => {
  const parsed = catalogSearchParamsSchema.parse({
    category: firstValue(raw.category),
    search: firstValue(raw.search),
    startDate: firstValue(raw.startDate),
    endDate: firstValue(raw.endDate),
    sort: firstValue(raw.sort),
    minPrice: firstValue(raw.minPrice),
    maxPrice: firstValue(raw.maxPrice),
    availableOnly: firstValue(raw.availableOnly),
    quantity: firstValue(raw.quantity),
    attr: allValues(raw.attr),
  });

  const hasPeriod =
    parsed.startDate !== undefined &&
    parsed.endDate !== undefined &&
    new Date(parsed.endDate).getTime() > new Date(parsed.startDate).getTime();

  // An inverted range matches nothing; read it as "no price filter" instead.
  const hasRange =
    parsed.minPrice === undefined ||
    parsed.maxPrice === undefined ||
    parsed.minPrice <= parsed.maxPrice;

  return {
    category: parsed.category ?? null,
    search: parsed.search ?? "",
    startDate: hasPeriod ? (parsed.startDate ?? null) : null,
    endDate: hasPeriod ? (parsed.endDate ?? null) : null,
    sort: parsed.sort ?? DEFAULT_CATALOG_SORT,
    minPrice: hasRange ? (parsed.minPrice ?? null) : null,
    maxPrice: hasRange ? (parsed.maxPrice ?? null) : null,
    availableOnly: readCatalogAvailability(parsed.availableOnly),
    quantity: parsed.quantity ?? null,
    attributes: readAttributeParams(parsed.attr ?? []),
  };
};

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

const cursorSchema = z.object({ offset: z.number().int().min(0).max(100_000) });

/** Opaque page token; today an offset, so a later keyset cursor changes nothing for callers. */
export const encodeCatalogCursor = (offset: number): string =>
  Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");

export const decodeCatalogCursor = (cursor: string | null | undefined): number => {
  if (!cursor) return 0;
  try {
    const parsed = cursorSchema.safeParse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
    return parsed.success ? parsed.data.offset : 0;
  } catch {
    return 0;
  }
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A product as the catalog grid receives it: card columns plus what the browse rules read. */
export interface CatalogProduct extends StorefrontCatalogProduct {
  categoryIds: string[];
  /** The price the card prints: the period total with dates, the base rate without. */
  displayPrice: number;
  /** Values the product's active units carry, per axis key. */
  attributeValues: Record<string, string[]>;
}

export type CatalogCategory = BrowsableCategory & {
  description: string | null;
  imageUrl: string | null;
  order: number;
  /** Active products of the category, so the client can count the available ones. */
  productIds: string[];
};

export interface CatalogCategoriesSummary {
  categories: CatalogCategory[];
  /** Active products linked to no category. */
  uncategorizedCount: number;
  uncategorizedProductIds: string[];
  /** Every active product of the store. */
  totalCount: number;
}

/** One variant axis the sidebar offers, with every value the store's units carry. */
export interface CatalogAttributeAxis {
  key: string;
  label: string;
  values: string[];
}

/** The browsed dates, or none: the price index and the page depend on them. */
export type CatalogPeriodInput = Pick<CatalogFilters, "startDate" | "endDate">;

export interface CatalogProductsPage {
  products: CatalogProduct[];
  nextCursor: string | null;
  /** Products matching the filters, loaded or not. */
  totalCount: number;
}

/** Filters applied before counting and paginating catalog results. */
export interface CatalogProductFilters extends Partial<CatalogPeriodInput> {
  availableOnly?: boolean;
  category: string | null;
  search: string;
  minPrice?: number | null;
  maxPrice?: number | null;
  quantity?: number | null;
  attributes?: CatalogAttributeFilters;
  sort?: CatalogSort;
}

export interface LoadCatalogProductsInput extends CatalogProductFilters {
  timezone?: string;
  storeId: string;
  cursor?: string | null;
  limit?: number;
}

/** Cheapest and dearest active product of a store, for the price filter. */
export interface CatalogPriceBounds {
  min: number;
  max: number;
}

/** The price every active product would print for a period, and the range they span. */
export interface CatalogPriceIndex {
  priceById: ReadonlyMap<string, number>;
  bounds: CatalogPriceBounds;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const activeProductsOf = (storeId: string) =>
  and(eq(products.storeId, storeId), eq(products.status, "active"));

/**
 * The store's categories with their active product counts, read once per
 * request (metadata, page and title share it).
 */
export const loadCatalogCategories = cache(
  async (storeId: string): Promise<CatalogCategoriesSummary> => {
    const [rows, links, activeRows] = await Promise.all([
      db
        .select({
          id: categories.id,
          name: categories.name,
          description: categories.description,
          imageUrl: categories.imageUrl,
          order: categories.order,
        })
        .from(categories)
        .where(eq(categories.storeId, storeId))
        .orderBy(asc(categories.order), asc(categories.name)),
      db
        .select({
          categoryId: productCategories.categoryId,
          productId: productCategories.productId,
        })
        .from(productCategories)
        .innerJoin(products, eq(products.id, productCategories.productId))
        .where(activeProductsOf(storeId)),
      db.select({ id: products.id }).from(products).where(activeProductsOf(storeId)),
    ]);

    const productIdsByCategoryId = new Map<string, string[]>();
    const categorized = new Set<string>();
    for (const link of links) {
      const ids = productIdsByCategoryId.get(link.categoryId) ?? [];
      ids.push(link.productId);
      productIdsByCategoryId.set(link.categoryId, ids);
      categorized.add(link.productId);
    }
    const uncategorizedProductIds = activeRows
      .map((row) => row.id)
      .filter((id) => !categorized.has(id));

    return {
      categories: rows.map((row, index) => {
        const productIds = productIdsByCategoryId.get(row.id) ?? [];
        return {
          id: row.id,
          name: row.name,
          description: row.description,
          imageUrl: row.imageUrl,
          order: row.order ?? index,
          productCount: productIds.length,
          productIds,
        };
      }),
      uncategorizedCount: uncategorizedProductIds.length,
      uncategorizedProductIds,
      totalCount: activeRows.length,
    };
  },
);

/**
 * The price each active product prints for the browsed period — the same
 * functions the card runs, so the slider, the filter and the sort agree
 * with what the visitor sees. Without dates it is the base rate. The bounds
 * are rounded outwards so both ends of the slider stay reachable; a store
 * without active products gets a zero range, and the filter hides itself.
 *
 * `cache()` keys on the arguments, so the page and its metadata share one
 * computation for one period.
 */
export const loadCatalogPriceIndex = cache(
  async (
    storeId: string,
    startDate: string | null,
    endDate: string | null,
    timezone?: string,
  ): Promise<CatalogPriceIndex> => {
    const rows = await db
      .select({
        id: products.id,
        price: products.price,
        promotion: products.promotion,
        pricingKind: products.pricingKind,
        pricingMode: products.pricingMode,
        basePeriodMinutes: products.basePeriodMinutes,
        enforceStrictTiers: products.enforceStrictTiers,
      })
      .from(products)
      .where(activeProductsOf(storeId));
    const ids = rows.map((row) => row.id);
    const [tiersByProductId, seasonalByProductId] =
      ids.length > 0
        ? await Promise.all([loadPricingTiers(ids), loadSeasonalPricings(ids)])
        : [new Map<string, StorefrontPricingTier[]>(), new Map<string, SeasonalPricingConfig[]>()];

    const priceById = new Map<string, number>();
    for (const row of rows) {
      const product = {
        ...row,
        pricingTiers: tiersByProductId.get(row.id) ?? [],
        seasonalPricings: seasonalByProductId.get(row.id) ?? [],
      };
      priceById.set(
        row.id,
        startDate && endDate
          ? getStorefrontProductPrice({ product, startDate, endDate, quantity: 1, timezone })
              .subtotal
          : getStorefrontPricingSummary(product, { timezone }).displayPrice,
      );
    }

    const prices = [...priceById.values()].filter((price) => Number.isFinite(price));
    const bounds =
      prices.length > 0
        ? { min: Math.floor(Math.min(...prices)), max: Math.ceil(Math.max(...prices)) }
        : { min: 0, max: 0 };

    return { priceById, bounds };
  },
);

/** Numeric-aware, so sizes read "S, M, L" only if named so and "38, 40, 42" in order. */
const compareAttributeValues = (a: string, b: string): number =>
  a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });

/**
 * The variant axes the sidebar can filter on: every axis a unit-tracked
 * product declares (or, for products that declared none, infers from its
 * units), with the values its active units carry. An axis with a single
 * value across the store offers no choice and is left out.
 */
export const loadCatalogAttributeAxes = cache(
  async (storeId: string): Promise<CatalogAttributeAxis[]> => {
    const trackedProductsOf = and(activeProductsOf(storeId), eq(products.trackUnits, true));
    const [productRows, unitRows, variantActivity] = await Promise.all([
      db
        .select({ id: products.id, bookingAttributeAxes: products.bookingAttributeAxes })
        .from(products)
        .where(trackedProductsOf),
      db
        .select({ productId: productUnits.productId, attributes: productUnits.attributes })
        .from(productUnits)
        .innerJoin(products, eq(products.id, productUnits.productId))
        .where(and(trackedProductsOf, eq(productUnits.lifecycleStatus, "active"))),
      getStoreVariantActivity(storeId),
    ]);

    const unitsByProductId = new Map<string, { attributes: Record<string, string> | null }[]>();
    for (const unit of unitRows) {
      const list = unitsByProductId.get(unit.productId) ?? [];
      list.push({ attributes: unit.attributes ?? null });
      unitsByProductId.set(unit.productId, list);
    }

    const axesByKey = new Map<
      string,
      { key: string; label: string; position: number; values: Set<string> }
    >();
    for (const row of productRows) {
      const units = unitsByProductId.get(row.id) ?? [];
      if (units.length === 0) continue;
      const declared: BookingAttributeAxis[] = row.bookingAttributeAxes ?? [];
      const axes = filterActiveVariantAxes(
        declared.length > 0 ? declared : inferAttributeAxesFromUnits(units),
        variantActivity,
      );
      for (const axis of axes) {
        const entry = axesByKey.get(axis.key) ?? {
          key: axis.key,
          label: axis.label || axis.key,
          position: axis.position,
          values: new Set<string>(),
        };
        for (const unit of units) {
          const value = unit.attributes?.[axis.key]?.trim();
          if (value) entry.values.add(value);
        }
        axesByKey.set(axis.key, entry);
      }
    }

    return [...axesByKey.values()]
      .filter((axis) => axis.values.size >= 2)
      .sort((a, b) => a.position - b.position || a.label.localeCompare(b.label, "en"))
      .map((axis) => ({
        key: axis.key,
        label: axis.label,
        values: [...axis.values].sort(compareAttributeValues),
      }));
  },
);

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

const escapeLikePattern = (term: string): string => term.replace(/[\\%_]/g, (char) => `\\${char}`);

/** A MySQL JSON path to one attribute key, quoted so any key is safe. */
const attributeJsonPath = (key: string): string =>
  `$."${key.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const buildProductConditions = ({
  storeId,
  category,
  search,
  quantity,
  attributes,
}: Pick<
  LoadCatalogProductsInput,
  "storeId" | "category" | "search" | "quantity" | "attributes"
>) => {
  const conditions = [activeProductsOf(storeId)];

  if (category === UNCATEGORIZED_CATEGORY_VALUE) {
    conditions.push(
      notExists(
        db
          .select({ one: sql`1` })
          .from(productCategories)
          .where(eq(productCategories.productId, products.id)),
      ),
    );
  } else if (category && category !== ALL_CATEGORIES_VALUE && !isReservedCategoryValue(category)) {
    conditions.push(
      inArray(
        products.id,
        db
          .select({ id: productCategories.productId })
          .from(productCategories)
          .where(eq(productCategories.categoryId, category)),
      ),
    );
  }

  const term = search.trim();
  if (term) {
    const pattern = `%${escapeLikePattern(term)}%`;
    conditions.push(or(like(products.name, pattern), like(products.description, pattern)));
  }

  // Narrow by fleet size first; dated availability is checked before pagination.
  if (typeof quantity === "number" && quantity >= 1) {
    conditions.push(
      or(eq(products.stockKind, "untracked"), gte(effectiveProductQuantitySql(), quantity)),
    );
  }

  // One active unit carrying one of the picked values, for every picked axis.
  for (const [axis, values] of Object.entries(attributes ?? {})) {
    if (values.length === 0) continue;
    const unitValue = sql`json_unquote(json_extract(${productUnits.attributes}, ${attributeJsonPath(axis)}))`;
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(productUnits)
          .where(
            and(
              eq(productUnits.productId, products.id),
              eq(productUnits.lifecycleStatus, "active"),
              inArray(unitValue, [...values]),
            ),
          ),
      ),
    );
  }

  return and(...conditions);
};

/** Price the index gives a product; a product it does not know sorts as free. */
const indexedPriceOf = (priceById: ReadonlyMap<string, number>, id: string): number =>
  priceById.get(id) ?? 0;

interface CatalogCandidate {
  id: string;
  displayOrder: number | null;
  createdAt: Date;
}

/** The merchant's order: `displayOrder`, then newest, then id — nulls first, as MySQL sorts them. */
const byMerchantOrder = (a: CatalogCandidate, b: CatalogCandidate): number =>
  (a.displayOrder ?? Number.NEGATIVE_INFINITY) - (b.displayOrder ?? Number.NEGATIVE_INFINITY) ||
  b.createdAt.getTime() - a.createdAt.getTime() ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Orders the matching products the way the page lists them. Price sorts
 * use the period price, so the order agrees with the amounts on the cards;
 * ties keep the merchant's order.
 */
const orderCandidates = (
  candidates: CatalogCandidate[],
  sort: CatalogSort,
  priceById: ReadonlyMap<string, number>,
): CatalogCandidate[] => {
  if (sort === "priceAsc" || sort === "priceDesc") {
    const direction = sort === "priceAsc" ? 1 : -1;
    return [...candidates].sort(
      (a, b) =>
        direction * (indexedPriceOf(priceById, a.id) - indexedPriceOf(priceById, b.id)) ||
        byMerchantOrder(a, b),
    );
  }
  return [...candidates].sort(byMerchantOrder);
};

/** Attribute values per product, from its active units: what the sidebar's axes match against. */
const loadUnitAttributeValues = async (productIds: string[]) => {
  const rows = await db
    .select({ productId: productUnits.productId, attributes: productUnits.attributes })
    .from(productUnits)
    .where(
      and(inArray(productUnits.productId, productIds), eq(productUnits.lifecycleStatus, "active")),
    );

  const byProductId = new Map<string, Record<string, string[]>>();
  for (const row of rows) {
    const values = byProductId.get(row.productId) ?? {};
    for (const [key, raw] of Object.entries(row.attributes ?? {})) {
      const value = raw?.trim();
      if (!value) continue;
      const list = (values[key] ??= []);
      if (!list.includes(value)) list.push(value);
    }
    byProductId.set(row.productId, values);
  }
  return byProductId;
};

const toPricingTier = (tier: typeof productPricingTiers.$inferSelect): StorefrontPricingTier => ({
  id: tier.id,
  minDuration: tier.minDuration,
  discountPercent: tier.discountPercent,
  period: tier.period,
  price: tier.price,
  displayOrder: tier.displayOrder,
});

const loadPricingTiers = async (productIds: string[]) => {
  const rows = await db
    .select()
    .from(productPricingTiers)
    .where(inArray(productPricingTiers.productId, productIds))
    .orderBy(asc(productPricingTiers.displayOrder));

  const byProductId = new Map<string, StorefrontPricingTier[]>();
  for (const row of rows) {
    const tiers = byProductId.get(row.productId) ?? [];
    tiers.push(toPricingTier(row));
    byProductId.set(row.productId, tiers);
  }
  return byProductId;
};

const loadSeasonalPricings = async (productIds: string[]) => {
  const pricings = await db
    .select()
    .from(productSeasonalPricing)
    .where(inArray(productSeasonalPricing.productId, productIds));
  const byProductId = new Map<string, SeasonalPricingConfig[]>();
  if (pricings.length === 0) return byProductId;

  const tiers = await db
    .select()
    .from(productSeasonalPricingTiers)
    .where(
      inArray(
        productSeasonalPricingTiers.seasonalPricingId,
        pricings.map((pricing) => pricing.id),
      ),
    );

  for (const pricing of pricings) {
    const ownTiers = tiers.filter((tier) => tier.seasonalPricingId === pricing.id);
    const config: SeasonalPricingConfig = {
      id: pricing.id,
      name: pricing.name,
      startDate: pricing.startDate,
      endDate: pricing.endDate,
      basePrice: Number.parseFloat(pricing.price),
      tiers: ownTiers.flatMap((tier) =>
        tier.minDuration !== null && tier.discountPercent !== null
          ? [
              {
                id: tier.id,
                minDuration: tier.minDuration,
                discountPercent: Number.parseFloat(tier.discountPercent),
                displayOrder: tier.displayOrder ?? 0,
              },
            ]
          : [],
      ),
      rates: ownTiers.flatMap((tier) =>
        tier.period !== null && tier.price !== null
          ? [
              {
                id: tier.id,
                period: tier.period,
                price: Number.parseFloat(tier.price),
                displayOrder: tier.displayOrder ?? 0,
              },
            ]
          : [],
      ),
    };
    const list = byProductId.get(pricing.productId) ?? [];
    list.push(config);
    byProductId.set(pricing.productId, list);
  }
  return byProductId;
};

/**
 * Accessory links of the page's products. Active accessories in stock, plus
 * every required one: an out-of-stock required accessory has to reach the
 * card to block the quick add.
 */
const loadAccessoryLinks = async (productIds: string[]) => {
  const links = await db
    .select({
      productId: productAccessories.productId,
      accessoryId: productAccessories.accessoryId,
      required: productAccessories.required,
      requiredQuantity: productAccessories.quantity,
    })
    .from(productAccessories)
    .where(inArray(productAccessories.productId, productIds))
    .orderBy(asc(productAccessories.displayOrder));
  const byProductId = new Map<string, AccessoryLink[]>();
  if (links.length === 0) return byProductId;

  const accessoryIds = [...new Set(links.map((link) => link.accessoryId))];
  const [accessoryRows, tiersByProductId] = await Promise.all([
    db
      .select({
        id: products.id,
        name: products.name,
        price: products.price,
        promotion: products.promotion,
        deposit: products.deposit,
        images: products.images,
        quantity: effectiveProductQuantitySql(),
        stockKind: products.stockKind,
        status: products.status,
        pricingKind: products.pricingKind,
        pricingMode: products.pricingMode,
        basePeriodMinutes: products.basePeriodMinutes,
      })
      .from(products)
      .where(inArray(products.id, accessoryIds)),
    loadPricingTiers(accessoryIds),
  ]);
  const accessoryById = new Map(accessoryRows.map((row) => [row.id, row]));

  for (const link of links) {
    const accessory = accessoryById.get(link.accessoryId);
    if (!accessory || accessory.status !== "active") continue;
    const inStock = accessory.stockKind === "untracked" || accessory.quantity > 0;
    if (!inStock && !link.required) continue;

    const list = byProductId.get(link.productId) ?? [];
    list.push({
      id: accessory.id,
      name: accessory.name,
      price: accessory.price,
      promotion: accessory.promotion,
      deposit: accessory.deposit ?? "0",
      images: accessory.images,
      quantity: accessory.stockKind === "untracked" ? null : accessory.quantity,
      required: link.required,
      requiredQuantity: link.requiredQuantity,
      pricingKind: accessory.pricingKind,
      pricingMode: accessory.pricingMode,
      basePeriodMinutes: accessory.basePeriodMinutes,
      pricingTiers: tiersByProductId.get(accessory.id),
    });
    byProductId.set(link.productId, list);
  }
  return byProductId;
};

const loadCategoryLinks = async (productIds: string[]) => {
  const rows = await db
    .select({
      productId: productCategories.productId,
      categoryId: productCategories.categoryId,
      position: productCategories.position,
    })
    .from(productCategories)
    .where(inArray(productCategories.productId, productIds))
    .orderBy(asc(productCategories.position));

  const byProductId = new Map<string, string[]>();
  for (const row of rows) {
    const list = byProductId.get(row.productId) ?? [];
    list.push(row.categoryId);
    byProductId.set(row.productId, list);
  }
  return byProductId;
};

/**
 * One page of the catalog for the given filters. The SQL narrows the store
 * to the matching ids; the price filter and the order are then applied in
 * memory from the period's price index (so the numbers agree with the
 * cards), and only the page's rows are read in full — tiers, seasonal
 * grids, accessories, category links and unit attributes batched for it.
 */
export const loadCatalogProducts = async ({
  storeId,
  timezone,
  category,
  search,
  quantity,
  attributes,
  availableOnly = true,
  minPrice,
  maxPrice,
  startDate = null,
  endDate = null,
  sort = DEFAULT_CATALOG_SORT,
  cursor,
  limit = CATALOG_PAGE_SIZE,
}: LoadCatalogProductsInput): Promise<CatalogProductsPage> => {
  const where = buildProductConditions({
    storeId,
    category,
    search,
    quantity: availableOnly ? Math.max(quantity ?? 1, 1) : quantity,
    attributes,
  });
  const offset = decodeCatalogCursor(cursor);

  const [candidates, { priceById }, variantActivity, { categories: storeCategories }] =
    await Promise.all([
      db
        .select({
          id: products.id,
          displayOrder: products.displayOrder,
          createdAt: products.createdAt,
        })
        .from(products)
        .where(where),
      loadCatalogPriceIndex(storeId, startDate, endDate, timezone),
      getStoreVariantActivity(storeId),
      loadCatalogCategories(storeId),
    ]);

  let availabilityById: Map<string, number | null> | null = null;
  if (startDate && endDate && candidates.length > 0 && (availableOnly || (quantity ?? 1) > 1)) {
    const [store] = await db
      .select({ id: stores.id, settings: stores.settings })
      .from(stores)
      .where(eq(stores.id, storeId));
    if (!store) throw new Error("Store not found");
    const availability = await getStorefrontAvailability({
      store,
      startDate,
      endDate,
      productIds: candidates.map((candidate) => candidate.id),
    });
    availabilityById = new Map(
      availability.products.map((product) => [product.productId, product.availableQuantity]),
    );
  }

  const withinRange = candidates.filter((candidate) => {
    if (availabilityById) {
      const available = availabilityById.get(candidate.id);
      if (available !== null && (available === undefined || available < (quantity ?? 1))) {
        return false;
      }
    }
    const price = indexedPriceOf(priceById, candidate.id);
    return (
      (typeof minPrice !== "number" || price >= minPrice) &&
      (typeof maxPrice !== "number" || price <= maxPrice)
    );
  });
  const ordered = orderCandidates(withinRange, sort, priceById);
  const totalCount = ordered.length;
  const productIds = ordered.slice(offset, offset + limit).map((candidate) => candidate.id);
  const hasMore = offset + limit < totalCount;
  const categoryNameById = new Map(storeCategories.map((entry) => [entry.id, entry]));

  const [
    rows,
    tiersByProductId,
    seasonalByProductId,
    accessoriesByProductId,
    categoryIdsByProductId,
    attributeValuesByProductId,
  ] =
    productIds.length > 0
      ? await Promise.all([
          db
            .select({
              id: products.id,
              name: products.name,
              images: products.images,
              price: products.price,
              promotion: products.promotion,
              deposit: products.deposit,
              quantity: effectiveProductQuantitySql(),
              stockKind: products.stockKind,
              pricingKind: products.pricingKind,
              pricingMode: products.pricingMode,
              basePeriodMinutes: products.basePeriodMinutes,
              enforceStrictTiers: products.enforceStrictTiers,
              trackUnits: products.trackUnits,
              bookingAttributeAxes: products.bookingAttributeAxes,
              videoUrl: products.videoUrl,
            })
            .from(products)
            .where(inArray(products.id, productIds)),
          loadPricingTiers(productIds),
          loadSeasonalPricings(productIds),
          loadAccessoryLinks(productIds),
          loadCategoryLinks(productIds),
          loadUnitAttributeValues(productIds),
        ])
      : [
          [],
          new Map<string, StorefrontPricingTier[]>(),
          new Map<string, SeasonalPricingConfig[]>(),
          new Map<string, AccessoryLink[]>(),
          new Map<string, string[]>(),
          new Map<string, Record<string, string[]>>(),
        ];

  // `IN (...)` returns rows in table order; the page order is the sorted one.
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const pageRows = productIds.flatMap((id) => {
    const row = rowById.get(id);
    return row ? [row] : [];
  });

  const pageProducts: CatalogProduct[] = pageRows.map((row) => {
    const categoryIds = categoryIdsByProductId.get(row.id) ?? [];
    const firstCategory = categoryIds.map((id) => categoryNameById.get(id)).find(Boolean);

    return {
      id: row.id,
      name: row.name,
      images: row.images,
      price: row.price,
      promotion: row.promotion,
      deposit: row.deposit,
      quantity: row.stockKind === "untracked" ? null : row.quantity,
      stockKind: row.stockKind,
      pricingKind: row.pricingKind,
      pricingMode: row.pricingMode,
      basePeriodMinutes: row.basePeriodMinutes,
      enforceStrictTiers: row.enforceStrictTiers,
      trackUnits: row.trackUnits,
      bookingAttributeAxes: filterActiveVariantAxes(
        row.bookingAttributeAxes ?? [],
        variantActivity,
      ),
      videoUrl: row.videoUrl,
      pricingTiers: tiersByProductId.get(row.id) ?? [],
      seasonalPricings: seasonalByProductId.get(row.id) ?? [],
      accessories: accessoriesByProductId.get(row.id) ?? [],
      categoryIds,
      category: firstCategory
        ? { id: firstCategory.id, name: firstCategory.name, order: firstCategory.order }
        : null,
      displayPrice: indexedPriceOf(priceById, row.id),
      attributeValues: attributeValuesByProductId.get(row.id) ?? {},
    };
  });

  return {
    products: pageProducts,
    nextCursor: hasMore ? encodeCatalogCursor(offset + limit) : null,
    totalCount,
  };
};
