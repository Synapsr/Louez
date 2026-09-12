import type { ProductPromotion } from "@louez/types";
import { getEffectiveReservationMode } from "@/lib/reservation-mode";
import "server-only";

import { cache } from "react";

import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";

import {
  db,
  getBlockingReservationStatuses,
  getEffectiveProductQuantities,
  loadConsumableReservedQuantities,
  productSeasonalPricing,
  productSeasonalPricingTiers,
  products,
} from "@louez/db";
import type {
  BookingAttributeAxis,
  BusinessHours,
  CombinationAvailability,
  PricingKind,
  PricingMode,
  StockKind,
  StoreSettings,
  StoreTheme,
} from "@louez/types";
import {
  getAvailableStockQuantity,
  type SeasonalPricingConfig,
  type StockQuantityLimit,
} from "@louez/utils";

import { getStoreBySlug, type StorefrontStore } from "@/lib/storefront/get-store-by-slug";
import type {
  AccessoryLink,
  StorefrontCatalogProduct,
  StorefrontPricingTier,
  StorefrontProductUnit,
} from "@/lib/storefront/storefront.types";
import { getStorefrontPathPrefix } from "@/lib/util.storefront-host";
import { filterActiveVariantAxes } from "@/lib/util.variant-visibility";
import { getStoreVariantActivity } from "@/lib/util.variant-visibility.server";
import { findBlockingRequiredAccessories } from "@/lib/utils/cart-required-accessories";
import { getMaxRentalMinutes, getMinRentalMinutes } from "@/lib/utils/rental-duration";
import { getCurrentDowntimeUnitIds } from "@/lib/utils/unit-current-downtime";
import {
  deriveAttributeValues,
  groupUnitsIntoCombinations,
  inferAttributeAxesFromUnits,
  isBookableUnit,
} from "@/lib/utils/util.variant-combinations";

const RELATED_PRODUCTS_LIMIT = 12;

/** Why the product cannot be booked right now. */
export type ProductUnavailableReason =
  | "consumable_out_of_stock"
  | "required_accessory_out_of_stock"
  | "unavailable";

export interface ProductPageStore {
  address: string | null;
  reservationMode: "payment" | "request";
  id: string;
  name: string;
  slug: string;
  currency: string;
  settings: StoreSettings;
  theme: StoreTheme;
}

export interface ProductPageProduct {
  id: string;
  name: string;
  description: string | null;
  images: string[];
  videoUrl: string | null;
  price: string;
  promotion?: ProductPromotion | null;
  deposit: string | null;
  pricingKind: PricingKind;
  pricingMode: PricingMode;
  basePeriodMinutes: number | null;
  enforceStrictTiers: boolean;
  pricingTiers: StorefrontPricingTier[];
  seasonalPricings: SeasonalPricingConfig[];
  stockKind: StockKind;
  trackUnits: boolean;
  category: { id: string; name: string } | null;
}

export interface ProductPageBooking {
  isAvailable: boolean;
  unavailableReason: ProductUnavailableReason | null;
  /** Units bookable today; `null` when stock is not tracked. */
  maxQuantity: StockQuantityLimit;
  attributeAxes: BookingAttributeAxis[];
  attributeValues: Record<string, string[]>;
  combinations: CombinationAvailability[];
  units: StorefrontProductUnit[];
  advanceNoticeMinutes: number;
  minRentalMinutes: number;
  maxRentalMinutes: number | null;
  businessHours: BusinessHours | undefined;
  timezone: string | undefined;
}

export interface ProductPageViewModel {
  store: ProductPageStore;
  product: ProductPageProduct;
  booking: ProductPageBooking;
  /** Active accessories with stock, plus every required one (a missing one explains the block). */
  accessories: AccessoryLink[];
  relatedProducts: StorefrontCatalogProduct[];
  basePath: string;
}

const readActiveProduct = cache((storeId: string, productId: string) =>
  db.query.products.findFirst({
    where: and(
      eq(products.id, productId),
      eq(products.storeId, storeId),
      eq(products.status, "active"),
    ),
    with: {
      category: true,
      pricingTiers: true,
      units: { columns: { id: true, lifecycleStatus: true, attributes: true } },
      accessories: {
        orderBy: (accessory, { asc: ascending }) => [ascending(accessory.displayOrder)],
        with: { accessory: { with: { pricingTiers: true } } },
      },
    },
  }),
);

type ProductRow = NonNullable<Awaited<ReturnType<typeof readActiveProduct>>>;
type AccessoryRow = ProductRow["accessories"][number] & {
  accessory: NonNullable<ProductRow["accessories"][number]["accessory"]>;
};

/** Mirrors the column defaults in `packages/db` for a row saved without settings. */
const DEFAULT_STORE_SETTINGS: StoreSettings = {
  reservationMode: "payment",
  minRentalMinutes: 60,
  maxRentalMinutes: null,
  advanceNoticeMinutes: 1440,
  turnoverBufferMinutes: 0,
};

const DEFAULT_STORE_THEME: StoreTheme = { mode: "light", primaryColor: "#0066FF" };

const toStoreSettings = (store: StorefrontStore): StoreSettings =>
  store.settings ?? DEFAULT_STORE_SETTINGS;

const toStoreTheme = (store: StorefrontStore): StoreTheme => store.theme ?? DEFAULT_STORE_THEME;

const toPageStore = (store: StorefrontStore): ProductPageStore => {
  const settings = toStoreSettings(store);
  return {
    id: store.id,
    name: store.name,
    slug: store.slug,
    currency: settings.currency ?? "EUR",
    address: store.address,
    reservationMode: getEffectiveReservationMode(store),
    settings,
    theme: toStoreTheme(store),
  };
};

/**
 * Product and store as `generateMetadata` needs them, sharing the page's
 * cached reads so each query runs once per request.
 */
export const loadProductForMetadata = cache(async (slug: string, productId: string) => {
  const store = await getStoreBySlug(slug);
  if (!store) return { store: null, product: null };
  const product = await readActiveProduct(store.id, productId);
  return { store: toPageStore(store), product };
});

const loadSeasonalPricings = async (productId: string): Promise<SeasonalPricingConfig[]> => {
  const pricings = await db
    .select()
    .from(productSeasonalPricing)
    .where(eq(productSeasonalPricing.productId, productId));
  if (pricings.length === 0) return [];

  const tiers = await db
    .select()
    .from(productSeasonalPricingTiers)
    .where(
      inArray(
        productSeasonalPricingTiers.seasonalPricingId,
        pricings.map((pricing) => pricing.id),
      ),
    );

  return pricings.map((pricing) => {
    const ownTiers = tiers.filter((tier) => tier.seasonalPricingId === pricing.id);
    return {
      id: pricing.id,
      name: pricing.name,
      startDate: pricing.startDate,
      endDate: pricing.endDate,
      basePrice: parseFloat(pricing.price),
      tiers: ownTiers.flatMap((tier) =>
        tier.minDuration !== null && tier.discountPercent !== null
          ? [
              {
                id: tier.id,
                minDuration: tier.minDuration,
                discountPercent: parseFloat(tier.discountPercent),
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
                price: parseFloat(tier.price),
                displayOrder: tier.displayOrder ?? 0,
              },
            ]
          : [],
      ),
    };
  });
};

const loadRelatedProducts = async (
  storeId: string,
  product: ProductRow,
): Promise<StorefrontCatalogProduct[]> => {
  if (!product.categoryId) return [];

  const rows = await db.query.products.findMany({
    where: and(
      eq(products.storeId, storeId),
      eq(products.status, "active"),
      eq(products.categoryId, product.categoryId),
      ne(products.id, product.id),
    ),
    with: { pricingTiers: true },
    orderBy: [asc(products.displayOrder), desc(products.createdAt)],
    limit: RELATED_PRODUCTS_LIMIT,
  });
  const quantities = await getEffectiveProductQuantities(
    db,
    rows.map((row) => row.id),
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    images: row.images,
    price: row.price,
    promotion: row.promotion,
    deposit: row.deposit,
    quantity:
      row.stockKind === "untracked"
        ? null
        : row.trackUnits
          ? (quantities.get(row.id) ?? 0)
          : row.quantity,
    stockKind: row.stockKind,
    pricingKind: row.pricingKind,
    pricingMode: row.pricingMode,
    basePeriodMinutes: row.basePeriodMinutes,
    enforceStrictTiers: row.enforceStrictTiers,
    pricingTiers: row.pricingTiers,
    category: product.category ? { id: product.category.id, name: product.category.name } : null,
  }));
};

const readStoredAxes = (product: ProductRow): BookingAttributeAxis[] =>
  [...((product.bookingAttributeAxes as BookingAttributeAxis[] | null) ?? [])].sort(
    (a, b) => a.position - b.position,
  );

const toStorefrontUnits = (
  product: ProductRow,
  downtimeUnitIds: Set<string>,
): StorefrontProductUnit[] =>
  (product.units ?? []).map((unit) => ({
    lifecycleStatus: unit.lifecycleStatus ?? "active",
    inDowntimeNow: downtimeUnitIds.has(unit.id),
    attributes: (unit.attributes as Record<string, string> | null) ?? null,
  }));

/**
 * Everything the product page renders, read in one pass: the store, the
 * product with its tiers, units and accessories, today's stock, the
 * seasonal grid and the related products. Returns `null` when the store or
 * the product is unknown so the page can answer 404.
 */
export const loadProductPage = cache(
  async (slug: string, productId: string): Promise<ProductPageViewModel | null> => {
    const store = await getStoreBySlug(slug);
    if (!store) return null;

    const product = await readActiveProduct(store.id, productId);
    if (!product) return null;

    const settings = toStoreSettings(store);
    const accessoryRows = (product.accessories ?? []).filter(
      (link): link is AccessoryRow => Boolean(link.accessory) && link.accessory.status === "active",
    );
    const accessoryProducts = accessoryRows.map((link) => link.accessory);
    const consumableIds = [product, ...accessoryProducts]
      .filter((item) => item.stockKind === "consumable")
      .map((item) => item.id);

    const [
      effectiveQuantities,
      consumableReserved,
      downtimeUnitIds,
      seasonalPricings,
      relatedProducts,
      variantActivity,
      basePath,
    ] = await Promise.all([
      getEffectiveProductQuantities(db, [
        product.id,
        ...accessoryProducts.map((accessory) => accessory.id),
      ]),
      loadConsumableReservedQuantities(db, {
        storeId: store.id,
        productIds: consumableIds,
        blockingStatuses: getBlockingReservationStatuses(
          settings.pendingBlocksAvailability ?? true,
        ),
      }),
      getCurrentDowntimeUnitIds(
        (product.units ?? []).map((unit) => unit.id),
        store.id,
      ),
      loadSeasonalPricings(product.id),
      loadRelatedProducts(store.id, product),
      getStoreVariantActivity(store.id),
      getStorefrontPathPrefix(slug),
    ]);

    const stockOf = (item: {
      id: string;
      quantity: number;
      stockKind: StockKind;
      trackUnits: boolean | null;
    }): StockQuantityLimit =>
      item.trackUnits
        ? (effectiveQuantities.get(item.id) ?? 0)
        : getAvailableStockQuantity({
            stockKind: item.stockKind,
            totalQuantity: item.quantity,
            reservedQuantity:
              item.stockKind === "consumable" ? (consumableReserved.get(item.id) ?? 0) : 0,
          });

    const accessories: AccessoryLink[] = accessoryRows
      .map((link) => ({ link, quantity: stockOf(link.accessory) }))
      .filter(({ link, quantity }) => quantity === null || quantity > 0 || link.required)
      .map(({ link, quantity }) => ({
        id: link.accessory.id,
        name: link.accessory.name,
        price: link.accessory.price,
        promotion: link.accessory.promotion,
        deposit: link.accessory.deposit ?? "0",
        images: link.accessory.images,
        quantity,
        required: link.required,
        requiredQuantity: link.quantity,
        pricingKind: link.accessory.pricingKind,
        pricingMode: link.accessory.pricingMode,
        basePeriodMinutes: link.accessory.basePeriodMinutes,
        pricingTiers: link.accessory.pricingTiers?.map((tier) => ({
          id: tier.id,
          minDuration: tier.minDuration,
          discountPercent: tier.discountPercent,
          period: tier.period,
          price: tier.price,
        })),
      }));

    const units = toStorefrontUnits(product, downtimeUnitIds);
    const storedAxes = readStoredAxes(product);
    const attributeAxes = filterActiveVariantAxes(
      storedAxes.length > 0 ? storedAxes : inferAttributeAxesFromUnits(units),
      variantActivity,
    );
    const effectiveQuantity = stockOf(product);
    const maxQuantity: StockQuantityLimit = product.trackUnits
      ? units.filter(isBookableUnit).length
      : effectiveQuantity;
    const blockingAccessories = findBlockingRequiredAccessories(accessories, 1);
    const isAvailable =
      (effectiveQuantity === null || effectiveQuantity > 0) && blockingAccessories.length === 0;
    const unavailableReason: ProductUnavailableReason | null = isAvailable
      ? null
      : effectiveQuantity === 0 && product.stockKind === "consumable"
        ? "consumable_out_of_stock"
        : blockingAccessories.length > 0
          ? "required_accessory_out_of_stock"
          : "unavailable";

    return {
      store: toPageStore(store),
      product: {
        id: product.id,
        name: product.name,
        description: product.description,
        images: product.images ?? [],
        videoUrl: product.videoUrl ?? null,
        price: product.price,
        promotion: product.promotion,
        deposit: product.deposit,
        pricingKind: product.pricingKind,
        pricingMode: product.pricingMode ?? "day",
        basePeriodMinutes: product.basePeriodMinutes,
        enforceStrictTiers: product.enforceStrictTiers ?? false,
        pricingTiers: product.pricingTiers,
        seasonalPricings,
        stockKind: product.stockKind,
        trackUnits: Boolean(product.trackUnits),
        category: product.category
          ? { id: product.category.id, name: product.category.name }
          : null,
      },
      booking: {
        isAvailable,
        unavailableReason,
        maxQuantity,
        attributeAxes,
        attributeValues: deriveAttributeValues(attributeAxes, { units }),
        combinations: groupUnitsIntoCombinations(attributeAxes, units),
        units,
        advanceNoticeMinutes: settings.advanceNoticeMinutes ?? 0,
        minRentalMinutes: getMinRentalMinutes(settings),
        maxRentalMinutes: getMaxRentalMinutes(settings),
        businessHours: settings.businessHours,
        timezone: settings.timezone,
      },
      accessories,
      relatedProducts,
      basePath,
    };
  },
);
