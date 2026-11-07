import {
  categories,
  db,
  effectiveProductQuantitySql,
  getBlockingReservationStatuses,
  getEffectiveProductQuantities,
  lockProductReservationsForStockKindChange,
  marketplaceCatalogTombstones,
  nextProductSlug,
  productAccessories,
  productCategories,
  productPricingTiers,
  productSeasonalPricing,
  productSeasonalPricingTiers,
  productUnits,
  products,
  reservationItemUnits,
  reservationItems,
  reservationStillHoldsUnitsSql,
  reservations,
  retryOnceOnDeadlock,
  stores,
  type Transaction,
} from "@louez/db";
import type { BookingAttributeAxis, UnitAttributes } from "@louez/types";
import {
  buildCombinationKey,
  canonicalizeAttributes,
  DEFAULT_COMBINATION_KEY,
  getSortedAxes,
  isPooledCombinationKey,
  minutesToPriceDuration,
  normalizeAxisKey,
  priceDurationToMinutes,
  pricingModeToMinutes,
  tierDisplayMaxUnit,
  validatePricingTiers,
} from "@louez/utils";
import {
  isOwnedImageUrl,
  productSchema as productRules,
  type ProductInput,
  type ProductUnitInput,
} from "@louez/validations";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  like,
  lt,
  ne,
  not,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import type { z } from "zod";

import {
  PRODUCT_PAGE_DEFAULT,
  productErrors,
  type CreateProductInput,
  type Product,
  type ProductListItem,
  type UpdateProductInput,
  type listProductsInput,
} from "../contracts/products";
import type { ApiEvent, ApiEventStore } from "../platform/ports";
import type { Transport } from "../platform/actor";
import {
  hasTrackedUnitCapacityConflict,
  shouldValidateTrackedUnitCapacity,
} from "./product-unit-capacity";
import { syncProductCombinationKeys } from "./variant-axes";
import { createUnits, deleteUnits, updateUnits, type UpdateUnitMutation } from "./unit-mutations";

/**
 * Products of a store: the business rules behind the products procedures,
 * moved from the dashboard's server actions. Every function takes the store
 * from the actor and filters on it, so an id from another store is "not
 * found".
 */

/** Who acts, on which store, and where the effects of a write go. */
export interface ProductActor {
  storeId: string;
  /** Recorded on unit events. */
  userId: string | null;
  transport: Transport;
  store: ApiEventStore & {
    settings: { pendingBlocksAvailability?: boolean; currency?: string } | null;
  };
  /** The app's effects, run after the commit (`ApiPorts.afterCommit`). */
  afterCommit: (event: ApiEvent) => void;
}

/** Asks the caller to confirm, under the write's lock: null goes on, an error stops. */
export type ConfirmStep<TPreview> = (preview: TPreview, tx: Transaction) => Promise<Error | null>;

/** Where a store's product images live in storage; `isOwnedImageUrl` checks the prefix. */
const productImagePrefix = (storeId: string) => `${storeId}/products`;

/**
 * Serializes the product writes of one store: creation (slug), the form's
 * reads then writes (units, capacity, stock kind), seasons (overlap), order.
 * Released when the transaction ends. Taken first, before any reservation or
 * product row.
 */
export async function lockStoreProducts(tx: Transaction, storeId: string) {
  await tx.select({ id: stores.id }).from(stores).where(eq(stores.id, storeId)).for("update");
}

/** An effect must never fail a write that has committed. */
function emit(actor: ProductActor, event: ApiEvent) {
  try {
    actor.afterCommit(event);
  } catch (error) {
    console.error("A product effect failed after its commit:", error);
  }
}

const eventStore = (actor: ProductActor): ApiEventStore => ({
  id: actor.store.id,
  name: actor.store.name,
  slug: actor.store.slug,
  ownerUserId: actor.store.ownerUserId,
});

const currencyOf = (actor: Pick<ProductActor, "store">) => actor.store.settings?.currency ?? "EUR";

// --- Normalizing the form's input ------------------------------------------

type Executor = Transaction | typeof db;

// Resolve the submitted category selection to store-owned category ids,
// preserving order and de-duplicating. Falls back to the legacy single
// `categoryId` when `categoryIds` is absent (older API callers).
async function resolveCategoryIds(
  executor: Executor,
  storeId: string,
  data: Pick<ProductInput, "categoryId" | "categoryIds">,
): Promise<string[]> {
  const requested = data.categoryIds ?? (data.categoryId ? [data.categoryId] : []);
  const unique = Array.from(new Set(requested.filter(Boolean)));
  if (unique.length === 0) return [];

  const owned = await executor
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.storeId, storeId), inArray(categories.id, unique)));
  const ownedIds = new Set(owned.map((category) => category.id));
  return unique.filter((id) => ownedIds.has(id));
}

async function replaceProductCategories(tx: Transaction, productId: string, categoryIds: string[]) {
  await tx.delete(productCategories).where(eq(productCategories.productId, productId));
  if (categoryIds.length > 0) {
    await tx.insert(productCategories).values(
      categoryIds.map((categoryId, index) => ({
        id: nanoid(),
        productId,
        categoryId,
        position: index,
      })),
    );
  }
}

/**
 * Rewrite the accessory links of a product. Links are stored in submission
 * order (`displayOrder`) and silently dropped when they point at a product of
 * another store, at the product itself, or at a duplicate accessory.
 */
async function replaceProductAccessories(
  tx: Transaction,
  params: {
    storeId: string;
    productId: string;
    links: NonNullable<ProductInput["accessories"]>;
  },
) {
  const { storeId, productId, links } = params;

  const requestedIds = Array.from(new Set(links.map((link) => link.accessoryId)));
  const owned =
    requestedIds.length === 0
      ? []
      : await tx
          .select({ id: products.id })
          .from(products)
          .where(
            and(
              eq(products.storeId, storeId),
              inArray(products.id, requestedIds),
              ne(products.id, productId),
            ),
          )
          .orderBy(products.id);
  const ownedIds = new Set(owned.map((product) => product.id));

  await tx.delete(productAccessories).where(eq(productAccessories.productId, productId));
  if (links.length === 0) return;

  const seen = new Set<string>();
  const rows = links.flatMap((link) => {
    if (!ownedIds.has(link.accessoryId) || seen.has(link.accessoryId)) return [];
    seen.add(link.accessoryId);
    return [
      {
        id: nanoid(),
        productId,
        accessoryId: link.accessoryId,
        required: link.required,
        quantity: link.quantity,
        displayOrder: seen.size - 1,
      },
    ];
  });

  if (rows.length > 0) {
    await tx.insert(productAccessories).values(rows);
  }
}

function normalizeBookingAttributeAxes(
  axes: ProductInput["bookingAttributeAxes"],
): BookingAttributeAxis[] {
  if (!axes || axes.length === 0) return [];
  return axes
    .map((axis, index) => ({
      key: normalizeAxisKey(axis.key),
      label: axis.label.trim(),
      position: index,
    }))
    .filter((axis) => axis.key.length > 0 && axis.label.length > 0);
}

function resolveUnitAttributes(
  axes: BookingAttributeAxis[],
  unit: ProductUnitInput,
): UnitAttributes {
  return canonicalizeAttributes(axes, unit.attributes as UnitAttributes | undefined);
}

function normalizePriceInput(value: string | undefined): string {
  return (value || "0").replace(",", ".");
}

function normalizeNullablePriceInput(value: string | null | undefined): string | null {
  if (value == null) return null;
  return value.trim().replace(",", ".") || null;
}

function normalizeNullableDateInput(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? null : date;
}

const newUnitNotes = (unit: ProductUnitInput) => ("notes" in unit ? unit.notes : undefined);
const newUnitPurchasePrice = (unit: ProductUnitInput) =>
  "purchasePrice" in unit ? unit.purchasePrice : undefined;
const newUnitPurchasedAt = (unit: ProductUnitInput) =>
  "purchasedAt" in unit ? unit.purchasedAt : undefined;
const newUnitImages = (unit: ProductUnitInput): string[] =>
  "images" in unit && Array.isArray(unit.images) ? unit.images : [];

function imageHistoryUrls(data: Pick<ProductInput, "imageHistory">): string[] {
  return data.imageHistory?.flatMap((history) => history.versions.map(({ url }) => url)) ?? [];
}

/** Units held by a reservation that still blocks them: they cannot be deleted. */
async function assignedBlockingUnitIds(
  executor: Executor,
  params: { unitIds: string[]; storeId: string; pendingBlocksAvailability: boolean },
): Promise<Set<string>> {
  if (params.unitIds.length === 0) return new Set();
  const rows = await executor
    .select({ productUnitId: reservationItemUnits.productUnitId })
    .from(reservationItemUnits)
    .innerJoin(reservationItems, eq(reservationItemUnits.reservationItemId, reservationItems.id))
    .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
    .where(
      and(
        inArray(reservationItemUnits.productUnitId, params.unitIds),
        eq(reservations.storeId, params.storeId),
        inArray(
          reservations.status,
          getBlockingReservationStatuses(params.pendingBlocksAvailability),
        ),
        reservationStillHoldsUnitsSql(),
      ),
    );
  return new Set(rows.flatMap((row) => (row.productUnitId ? [row.productUnitId] : [])));
}

function legacyPricingModeFromUnit(
  unit: "minute" | "hour" | "day" | "week",
): "hour" | "day" | "week" {
  if (unit === "week") return "week";
  if (unit === "day") return "day";
  return "hour";
}

function buildRateTierRows(
  input: Pick<ProductInput, "pricingTiers" | "rateTiers">,
  basePrice: number,
  basePeriodMinutes: number,
): Array<{ id?: string; period: number; price: string }> {
  if (Array.isArray(input.rateTiers)) {
    return input.rateTiers
      .map((tier) => ({
        id: tier.id,
        period: priceDurationToMinutes(tier.duration, tier.unit),
        price: normalizePriceInput(tier.price),
      }))
      .sort((a, b) => a.period - b.period);
  }

  // Backward fallback for legacy payloads.
  return (input.pricingTiers || [])
    .map((tier) => {
      const unitPrice = basePrice * (1 - tier.discountPercent / 100);
      return {
        id: tier.id,
        period: tier.minDuration * basePeriodMinutes,
        price: (unitPrice * tier.minDuration).toFixed(2),
      };
    })
    .sort((a, b) => a.period - b.period);
}

/** Indexes of the rows whose period another row has too, in one pass. */
export function duplicateRatePeriodIndexes(rows: Array<{ period: number }>): number[] {
  const byPeriod = new Map<number, number[]>();
  rows.forEach((row, index) => {
    const indexes = byPeriod.get(row.period);
    if (indexes) indexes.push(index);
    else byPeriod.set(row.period, [index]);
  });
  const duplicates: number[] = [];
  for (const indexes of byPeriod.values()) {
    if (indexes.length > 1) for (const index of indexes) duplicates.push(index);
  }
  return duplicates.sort((a, b) => a - b);
}

/** Runs the dashboard's product rules on the input; a failure lists its issues. */
function validateProduct(input: Record<string, unknown>): ProductInput {
  const result = productRules.safeParse(input);
  if (!result.success) {
    // Tiers of one duration: say which ones, as the form highlights them.
    const duplicateTiers = result.error.issues.some(
      (issue) =>
        issue.path.length === 1 &&
        issue.path[0] === "rateTiers" &&
        issue.message === "validation.duplicateValue",
    );
    if (duplicateTiers && Array.isArray(input.rateTiers)) {
      throw productErrors.duplicateRatePeriods(
        duplicateRatePeriodIndexes(
          (
            input.rateTiers as Array<{ duration: number; unit: "minute" | "hour" | "day" | "week" }>
          ).map((tier) => ({ period: priceDurationToMinutes(tier.duration, tier.unit) })),
        ),
      );
    }
    throw productErrors.invalid(
      result.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    );
  }
  return result.data as ProductInput;
}

/** What every save derives from a valid input: prices, base period, tiers. */
function pricingOf(data: ProductInput, fallbackMode: "hour" | "day" | "week") {
  // Legacy pricing tiers are checked only when V2 rates are not sent.
  const legacyTiers = data.pricingTiers || [];
  if (data.rateTiers == null && legacyTiers.length > 0) {
    const tierValidation = validatePricingTiers(legacyTiers);
    if (!tierValidation.valid) throw productErrors.legacyTiersInvalid(tierValidation.error ?? "");
  }

  const pricingKind = data.pricingKind ?? "duration";
  const basePriceDuration = pricingKind === "fixed" ? undefined : data.basePriceDuration;
  const price = normalizePriceInput(
    pricingKind === "fixed" ? data.price : basePriceDuration?.price || data.price,
  );
  const durationBasePeriodMinutes = basePriceDuration
    ? priceDurationToMinutes(basePriceDuration.duration, basePriceDuration.unit)
    : pricingModeToMinutes(data.pricingMode || fallbackMode);
  const rateTierRows =
    pricingKind === "fixed"
      ? []
      : buildRateTierRows(data, parseFloat(price) || 0, durationBasePeriodMinutes);
  const duplicates = duplicateRatePeriodIndexes(rateTierRows);
  if (duplicates.length > 0) throw productErrors.duplicateRatePeriods(duplicates);

  return {
    pricingKind,
    stockKind: data.stockKind ?? "returnable",
    price,
    basePeriodMinutes: pricingKind === "fixed" ? null : durationBasePeriodMinutes,
    legacyPricingMode: basePriceDuration
      ? legacyPricingModeFromUnit(basePriceDuration.unit)
      : data.pricingMode || fallbackMode,
    deposit: data.deposit ? normalizePriceInput(data.deposit) : "0",
    enforceStrictTiers: pricingKind === "fixed" ? false : data.enforceStrictTiers || false,
    rateTierRows,
  };
}

/**
 * The API's write input as the dashboard's product schema takes it: a number
 * quantity becomes a string, and a duration product sent with only `price`
 * gets it as its base rate per 1 `pricingMode` (a day by default).
 */
function toProductInput(
  input: Omit<CreateProductInput, "quantity"> & { quantity?: string | number },
  defaults: { status: "draft" | "active" | "archived"; quantity: string },
): Record<string, unknown> {
  const pricingKind = input.pricingKind ?? "duration";
  const price = input.price ?? input.basePriceDuration?.price ?? "";
  const pricingMode =
    input.pricingMode ??
    (input.basePriceDuration ? legacyPricingModeFromUnit(input.basePriceDuration.unit) : "day");
  return {
    ...input,
    price,
    status: input.status ?? defaults.status,
    quantity: input.quantity === undefined ? defaults.quantity : String(input.quantity),
    pricingMode,
    basePriceDuration:
      input.basePriceDuration ??
      (pricingKind === "duration" && price ? { price, duration: 1, unit: pricingMode } : undefined),
  };
}

// --- Reads -------------------------------------------------------------------

type StoredProduct = typeof products.$inferSelect;
type StoredTier = typeof productPricingTiers.$inferSelect;

/** The base rate's duration, as the form shows it. */
function baseDurationOf(product: Pick<StoredProduct, "basePeriodMinutes" | "pricingMode">) {
  return product.basePeriodMinutes
    ? minutesToPriceDuration(product.basePeriodMinutes)
    : { duration: 1, unit: product.pricingMode };
}

/**
 * Stored tiers as the form edits them: a duration and its total price, in
 * the base rate's scale. Former percentage tiers are turned into prices.
 */
function storedRateTiers(
  product: Pick<StoredProduct, "price" | "pricingMode" | "basePeriodMinutes">,
  tiers: readonly StoredTier[],
) {
  const basePrice = parseFloat(product.price || "0") || 0;
  const fallbackMode = product.pricingMode ?? "day";
  const maxUnit = tierDisplayMaxUnit(
    product.basePeriodMinutes
      ? minutesToPriceDuration(product.basePeriodMinutes).unit
      : fallbackMode,
  );

  return tiers
    .map((tier) => {
      if (tier.price && tier.period) {
        return {
          id: tier.id,
          price: tier.price,
          periodMinutes: tier.period,
          ...minutesToPriceDuration(tier.period, maxUnit),
        };
      }
      const minDuration = tier.minDuration ?? 1;
      const discount = parseFloat(tier.discountPercent || "0");
      const minutes = minDuration * pricingModeToMinutes(fallbackMode);
      return {
        id: tier.id,
        price: (basePrice * (1 - discount / 100) * minDuration).toFixed(2),
        periodMinutes: minutes,
        ...minutesToPriceDuration(minutes, maxUnit),
      };
    })
    .sort((a, b) => a.periodMinutes - b.periodMinutes);
}

async function loadProduct(executor: Executor, storeId: string, id: string) {
  const found = await executor.query.products.findFirst({
    where: and(eq(products.id, id), eq(products.storeId, storeId)),
    with: {
      categoryLinks: { orderBy: (links, { asc: ascending }) => [ascending(links.position)] },
      accessories: {
        orderBy: (links, { asc: ascending }) => [ascending(links.displayOrder)],
        with: { accessory: { columns: { name: true } } },
      },
      units: { orderBy: (units, { asc: ascending }) => [ascending(units.identifier)] },
    },
  });
  if (!found) throw productErrors.notFound(id);
  // Read apart: a relational query reads decimals through JSON, which drops
  // their trailing zeros ("75" for "75.00").
  const pricingTiers = await executor
    .select()
    .from(productPricingTiers)
    .where(eq(productPricingTiers.productId, id))
    .orderBy(asc(productPricingTiers.displayOrder));
  return { ...found, pricingTiers };
}
type LoadedProduct = Awaited<ReturnType<typeof loadProduct>>;

function categoryIdsOf(product: LoadedProduct) {
  const linked = product.categoryLinks.map((link) => link.categoryId);
  return linked.length > 0 ? linked : product.categoryId ? [product.categoryId] : [];
}

async function toProduct(product: LoadedProduct, currency: string): Promise<Product> {
  const quantity = product.trackUnits
    ? ((await getEffectiveProductQuantities(db, [product.id])).get(product.id) ?? 0)
    : product.quantity;
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    aiContext: product.aiContext,
    // A row from before the default reads as the form shows it.
    status: product.status ?? "active",
    categoryIds: categoryIdsOf(product),
    currency,
    pricingKind: product.pricingKind,
    price: product.price,
    basePriceDuration:
      product.pricingKind === "fixed" ? null : { price: product.price, ...baseDurationOf(product) },
    pricingMode: product.pricingMode,
    rateTiers: storedRateTiers(product, product.pricingTiers),
    enforceStrictTiers: product.enforceStrictTiers,
    deposit: product.deposit ?? "0",
    stockKind: product.stockKind,
    quantity,
    trackUnits: product.trackUnits,
    bookingAttributeAxes: getSortedAxes(product.bookingAttributeAxes),
    units: product.units.map((unit) => ({
      id: unit.id,
      identifier: unit.identifier,
      attributes: (unit.attributes as Record<string, string> | null) ?? {},
      lifecycleStatus: unit.lifecycleStatus,
    })),
    accessories: product.accessories.map((link) => ({
      accessoryId: link.accessoryId,
      name: link.accessory?.name ?? "",
      required: link.required,
      quantity: link.quantity,
    })),
    images: product.images ?? [],
    videoUrl: product.videoUrl,
    taxSettings: product.taxSettings ?? null,
    promotion: product.promotion ?? null,
    position: product.displayOrder ?? 0,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

/** Locks the product's row (a locking read sees the latest commit); not found otherwise. */
async function lockProduct(tx: Transaction, storeId: string, id: string) {
  const [row] = await tx
    .select({
      id: products.id,
      name: products.name,
      stockKind: products.stockKind,
      updatedAt: products.updatedAt,
    })
    .from(products)
    .where(and(eq(products.id, id), eq(products.storeId, storeId)))
    .for("update");
  if (!row) throw productErrors.notFound(id);
  return row;
}

/**
 * Locks the product's units, in id order, after its row: unit assignment
 * takes the reservation, the product, then the units.
 */
async function lockProductUnits(tx: Transaction, productId: string) {
  return tx
    .select({
      id: productUnits.id,
      identifier: productUnits.identifier,
      combinationKey: productUnits.combinationKey,
    })
    .from(productUnits)
    .where(eq(productUnits.productId, productId))
    .orderBy(asc(productUnits.id))
    .for("update");
}

/** Throws PRODUCT_NOT_FOUND unless the store has the product. */
export async function assertOwnedProduct(storeId: string, id: string) {
  const [row] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, id), eq(products.storeId, storeId)))
    .limit(1);
  if (!row) throw productErrors.notFound(id);
}

export async function getProduct(actor: Pick<ProductActor, "storeId" | "store">, id: string) {
  return toProduct(await loadProduct(db, actor.storeId, id), currencyOf(actor));
}

const listPosition = sql<number>`COALESCE(${products.displayOrder}, 0)`.mapWith(Number);

/**
 * One page of the store's products in the catalog's order: position, newest
 * first, then id, so the order is total and a cursor (the id of the page's
 * last product) never skips or repeats. The counts per status cover the
 * category and search filters, not the status one, as the dashboard's tabs
 * show them.
 */
export async function listProducts(
  actor: Pick<ProductActor, "storeId" | "store">,
  input: z.infer<typeof listProductsInput>,
) {
  const { storeId } = actor;
  const limit = input.limit ?? PRODUCT_PAGE_DEFAULT;
  const scope: SQL[] = [eq(products.storeId, storeId)];

  const categoryIds = input.categoryIds?.filter(Boolean) ?? [];
  if (categoryIds.length > 0) {
    scope.push(
      inArray(
        products.id,
        db
          .select({ id: productCategories.productId })
          .from(productCategories)
          .where(inArray(productCategories.categoryId, categoryIds)),
      ),
    );
  }
  // The column collation already ignores case and accents.
  const search = input.search?.trim();
  if (search) scope.push(like(products.name, `%${search}%`));

  const conditions = [...scope];
  if (input.status && input.status !== "all") conditions.push(eq(products.status, input.status));
  if (input.cursor) {
    const [after] = await db
      .select({ position: listPosition, createdAt: products.createdAt, id: products.id })
      .from(products)
      .where(and(eq(products.id, input.cursor), eq(products.storeId, storeId)))
      .limit(1);
    if (!after) throw productErrors.invalidCursor("products_list");
    conditions.push(
      or(
        gt(listPosition, after.position),
        and(
          eq(listPosition, after.position),
          or(
            lt(products.createdAt, after.createdAt),
            and(eq(products.createdAt, after.createdAt), gt(products.id, after.id)),
          ),
        ),
      ) as SQL,
    );
  }

  const [ids, statusCounts] = await Promise.all([
    // Ids first: sorting full rows (images) can overflow the sort buffer.
    db
      .select({ id: products.id })
      .from(products)
      .where(and(...conditions))
      .orderBy(asc(listPosition), desc(products.createdAt), asc(products.id))
      .limit(limit + 1),
    db
      .select({ status: products.status, count: count() })
      .from(products)
      .where(and(...scope))
      .groupBy(products.status),
  ]);

  const counts = { all: 0, active: 0, draft: 0, archived: 0 };
  for (const row of statusCounts) {
    counts.all += row.count;
    if (row.status) counts[row.status] = row.count;
  }

  const pageIds = ids.slice(0, limit).map((row) => row.id);
  const rows =
    pageIds.length === 0
      ? []
      : await db
          .select({
            id: products.id,
            name: products.name,
            status: products.status,
            images: products.images,
            pricingKind: products.pricingKind,
            price: products.price,
            basePeriodMinutes: products.basePeriodMinutes,
            pricingMode: products.pricingMode,
            deposit: products.deposit,
            stockKind: products.stockKind,
            quantity: effectiveProductQuantitySql(),
            categoryId: products.categoryId,
            categoryName: categories.name,
          })
          .from(products)
          .leftJoin(categories, eq(products.categoryId, categories.id))
          .where(inArray(products.id, pageIds));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const items: ProductListItem[] = pageIds.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    const { categoryId, categoryName, ...item } = row;
    return [
      {
        ...item,
        quantity: Number(item.quantity),
        category: categoryId && categoryName ? { id: categoryId, name: categoryName } : null,
      },
    ];
  });

  return {
    items,
    nextCursor: ids.length > limit ? (pageIds.at(-1) ?? null) : null,
    currency: currencyOf(actor),
    counts,
  };
}

// --- Create ------------------------------------------------------------------

/**
 * Creates a product from the product form's fields, with its categories,
 * accessories, tiers and units. Then notifies the platform, records the
 * analytics event and revalidates the products list (app effects).
 */
export async function createProduct(actor: ProductActor, input: CreateProductInput) {
  const data = validateProduct(toProductInput(input, { status: "active", quantity: "1" }));
  const { storeId } = actor;

  const submittedImageUrls = [...(data.images ?? []), ...imageHistoryUrls(data)];
  if (submittedImageUrls.some((image) => !isOwnedImageUrl(image, productImagePrefix(storeId)))) {
    throw productErrors.imageNotOwned();
  }

  const pricing = pricingOf(data, "day");
  const trackUnits = data.trackUnits || false;
  const units = data.units || [];
  const axes = trackUnits ? normalizeBookingAttributeAxes(data.bookingAttributeAxes) : [];
  const manualQuantity = parseInt(data.quantity, 10);
  const productId = nanoid();
  let categoryIds: string[] = [];

  await db.transaction(async (tx) => {
    await lockStoreProducts(tx, storeId);
    categoryIds = await resolveCategoryIds(tx, storeId, data);

    await tx.insert(products).values({
      id: productId,
      storeId,
      name: data.name,
      slug: await nextProductSlug(tx, storeId, data.name),
      description: data.description || null,
      aiContext: data.aiContext?.trim() || null,
      categoryId: categoryIds[0] ?? null,
      price: pricing.price,
      deposit: pricing.deposit,
      pricingMode: pricing.legacyPricingMode,
      pricingKind: pricing.pricingKind,
      stockKind: pricing.stockKind,
      basePeriodMinutes: pricing.basePeriodMinutes,
      ...(!trackUnits ? { quantity: manualQuantity } : {}),
      status: data.status,
      images: data.images || [],
      imageHistory: data.imageHistory || [],
      videoUrl: data.videoUrl || null,
      taxSettings: data.taxSettings || null,
      promotion: data.promotion,
      enforceStrictTiers: pricing.enforceStrictTiers,
      trackUnits,
      bookingAttributeAxes: trackUnits && axes.length > 0 ? axes : null,
    });

    await replaceProductCategories(tx, productId, categoryIds);
    await replaceProductAccessories(tx, { storeId, productId, links: data.accessories ?? [] });

    if (pricing.rateTierRows.length > 0) {
      await tx.insert(productPricingTiers).values(
        pricing.rateTierRows.map((tier, index) => ({
          id: nanoid(),
          productId,
          minDuration: null,
          discountPercent: null,
          period: tier.period,
          price: tier.price,
          displayOrder: index,
        })),
      );
    }

    if (trackUnits && units.length > 0) {
      await createUnits(
        tx,
        units.map((unit) => {
          const attributes = resolveUnitAttributes(axes, unit);
          const row = {
            id: nanoid(),
            productId,
            identifier: unit.identifier.trim(),
            notes: newUnitNotes(unit)?.trim() || null,
            purchasePrice: normalizeNullablePriceInput(newUnitPurchasePrice(unit)),
            purchasedAt: normalizeNullableDateInput(newUnitPurchasedAt(unit)),
            images: newUnitImages(unit),
            lifecycleStatus: "active" as const,
            attributes,
            combinationKey: buildCombinationKey(axes, attributes),
          };
          return {
            unit: row,
            event: {
              storeId,
              actorUserId: actor.userId,
              identifierSnapshot: row.identifier,
              payload: {
                productId,
                identifier: row.identifier,
                combinationKey: row.combinationKey,
              },
            },
          };
        }),
      );
    }
  });

  emit(actor, {
    type: "product.created",
    store: eventStore(actor),
    transport: actor.transport,
    productId,
    productName: data.name,
    facts: {
      product_status: data.status,
      track_units: trackUnits,
      available_unit_count: trackUnits ? units.length : null,
      manual_quantity: trackUnits ? null : manualQuantity,
      has_category: categoryIds.length > 0,
      category_count: categoryIds.length,
      image_count: data.images?.length ?? 0,
      has_video: Boolean(data.videoUrl),
      has_rate_tiers: pricing.rateTierRows.length > 0,
      rate_tier_count: pricing.rateTierRows.length,
      has_deposit: parseFloat(pricing.deposit) > 0,
      base_period_minutes: pricing.basePeriodMinutes,
      pricing_mode: pricing.legacyPricingMode,
      booking_attribute_axis_count: axes.length,
    },
  });

  return getProduct(actor, productId);
}

// --- Update ------------------------------------------------------------------

/** What an update would destroy, for its confirmation preview. */
export interface ProductUpdatePreview {
  product: { id: string; name: string; status: StoredProduct["status"]; updatedAt: Date };
  /** The product goes from a visible status to archived. */
  archives: boolean;
  /** Switching to fixed pricing deletes these. */
  deletedTierCount: number;
  deletedSeasonalPricingCount: number;
  /**
   * Active units the update deletes (left out of `units`, or unit tracking
   * turned off), each with its identifier and variant values, as the human
   * must see them before confirming.
   */
  deletedUnits: Array<{ id: string; identifier: string; attributes: Record<string, string> }>;
  summary: string;
}

/** The stored product as the form would send it back unchanged. */
function storedAsInput(product: LoadedProduct): Record<string, unknown> {
  const activeUnits = product.units.filter((unit) => unit.lifecycleStatus === "active");
  const baseDuration = baseDurationOf(product);
  return {
    name: product.name,
    description: product.description ?? "",
    aiContext: product.aiContext ?? "",
    categoryIds: categoryIdsOf(product),
    price: product.price,
    deposit: product.deposit ?? "",
    quantity: String(product.quantity),
    status: product.status ?? "active",
    images: product.images ?? [],
    imageHistory: product.imageHistory ?? [],
    stockKind: product.stockKind,
    pricingKind: product.pricingKind,
    pricingMode: product.pricingMode,
    basePriceDuration: { price: product.price, ...baseDuration },
    rateTiers: storedRateTiers(product, product.pricingTiers).map(
      ({ id, price, duration, unit }) => ({
        id,
        price,
        duration,
        unit,
      }),
    ),
    enforceStrictTiers: product.enforceStrictTiers,
    promotion: product.promotion ?? null,
    taxSettings: product.taxSettings ?? undefined,
    videoUrl: product.videoUrl ?? "",
    accessories: product.accessories.map((link) => ({
      accessoryId: link.accessoryId,
      required: link.required,
      quantity: link.quantity,
    })),
    trackUnits: product.trackUnits,
    bookingAttributeAxes: getSortedAxes(product.bookingAttributeAxes),
    units: activeUnits.map((unit) => ({
      id: unit.id,
      identifier: unit.identifier,
      attributes: (unit.attributes as Record<string, string> | null) ?? {},
    })),
  };
}

type Patch = Partial<Omit<UpdateProductInput, "id">>;

/**
 * The fields sent, with the former ones in their current form: a single
 * `categoryId` is the list of categories, a null base rate (as products_get
 * gives it for fixed pricing) is none.
 */
function canonicalPatch(patch: Patch): Patch {
  const { categoryId, ...rest } = patch;
  const canonical: Patch = { ...rest };
  if (canonical.basePriceDuration === null) delete canonical.basePriceDuration;
  if (categoryId !== undefined && canonical.categoryIds === undefined) {
    canonical.categoryIds = categoryId ? [categoryId] : [];
  }
  return canonical;
}

/**
 * The update as a whole form: the stored product with the sent fields over
 * it. `price` alone on a duration product changes the base rate's price.
 * `syncUnits` is false when the call sends none of units, trackUnits and
 * bookingAttributeAxes: the units are then left as they are.
 */
function mergeUpdate(product: LoadedProduct, patch: UpdateProductInput) {
  const { id: _id, ...sent } = patch;
  const defined = canonicalPatch(
    Object.fromEntries(Object.entries(sent).filter(([, value]) => value !== undefined)) as Patch,
  );
  const stored = storedAsInput(product);
  const merged: Record<string, unknown> = { ...stored, ...defined };
  // The percentage tiers sent stand for the rate tiers: the stored ones must
  // not shadow them (the schema takes rateTiers first).
  if (defined.pricingTiers !== undefined && defined.rateTiers === undefined) {
    delete merged.rateTiers;
  }

  // null clears.
  for (const field of ["description", "aiContext", "videoUrl"] as const) {
    if (defined[field] === null) merged[field] = "";
  }
  if (defined.taxSettings === null) merged.taxSettings = undefined;
  if (defined.quantity !== undefined) merged.quantity = String(defined.quantity);

  const pricingKind = (merged.pricingKind as string | undefined) ?? "duration";
  if (defined.basePriceDuration === undefined && pricingKind === "duration") {
    const base = stored.basePriceDuration as { price: string; duration: number; unit: string };
    // A former base period sent alone is the base rate per 1 of it.
    if (defined.pricingMode !== undefined) {
      merged.basePriceDuration = {
        price: defined.price ?? base.price,
        duration: 1,
        unit: defined.pricingMode,
      };
    } else if (defined.price !== undefined) {
      merged.basePriceDuration = { ...base, price: defined.price };
    }
  }

  const syncUnits =
    defined.units !== undefined ||
    defined.trackUnits !== undefined ||
    defined.bookingAttributeAxes !== undefined;
  // Unit rules run on the units sent; untouched units are not checked again.
  if (!syncUnits) merged.units = [];
  return { merged, syncUnits };
}

/**
 * Saves the product form over a product: partial (see `mergeUpdate`), then
 * every rule of the dashboard's save. One transaction under the store's
 * product lock holds the checks, the confirmation and the writes, product and
 * units together. `confirm` is asked when the update archives the product,
 * deletes tiers and seasons (fixed pricing) or deletes units.
 */
export async function updateProduct(
  actor: ProductActor,
  input: UpdateProductInput,
  options: { confirm?: ConfirmStep<ProductUpdatePreview> } = {},
) {
  const { storeId } = actor;
  const pendingBlocksAvailability = actor.store.settings?.pendingBlocksAvailability ?? true;
  const blockingStatuses = getBlockingReservationStatuses(pendingBlocksAvailability);
  let refusal: Error | null = null;
  let savedName = "";

  await retryOnceOnDeadlock(() =>
    db.transaction(async (tx) => {
      refusal = null;
      await lockStoreProducts(tx, storeId);
      // Every lock before the first plain read: InnoDB reads at the snapshot of
      // that first read, so a reservation committed while this waited for the
      // product's row must not be missed. Checkout locks the product first,
      // then reads the stock and inserts; this takes the product, then its
      // reservations when the stock kind changes, then its units.
      const current = await lockProduct(tx, storeId, input.id);
      const stockKindChanges =
        input.stockKind !== undefined && input.stockKind !== current.stockKind;
      const canChangeStockKind = stockKindChanges
        ? await lockProductReservationsForStockKindChange(tx, { productId: input.id, storeId })
        : true;
      await lockProductUnits(tx, input.id);

      const product = await loadProduct(tx, storeId, input.id);
      const { merged, syncUnits } = mergeUpdate(product, input);
      const data = validateProduct(merged);
      savedName = data.name;

      const existingImages = new Set([
        ...(product.images ?? []),
        ...(product.imageHistory?.flatMap((history) => history.versions.map(({ url }) => url)) ??
          []),
      ]);
      const submittedImageUrls = [...(data.images ?? []), ...imageHistoryUrls(data)];
      if (
        submittedImageUrls.some(
          (image) =>
            !existingImages.has(image) && !isOwnedImageUrl(image, productImagePrefix(storeId)),
        )
      ) {
        throw productErrors.imageNotOwned();
      }

      const pricing = pricingOf(data, product.pricingMode || "day");
      const trackUnits = data.trackUnits || false;
      const units = data.units || [];
      const axes = trackUnits ? normalizeBookingAttributeAxes(data.bookingAttributeAxes) : [];
      // Combination keys are derived from the axes, so a change in axes re-keys
      // the product's units and booked lines once the save goes through.
      const bookingAxesChanged =
        syncUnits &&
        trackUnits &&
        JSON.stringify(getSortedAxes(product.bookingAttributeAxes).map((axis) => axis.key)) !==
          JSON.stringify(axes.map((axis) => axis.key));

      // Unit tracking cannot be turned off while current or future
      // reservations booked specific combinations.
      if (syncUnits && !trackUnits && product.trackUnits) {
        const [conflict] = await tx
          .select({ id: reservationItems.id })
          .from(reservationItems)
          .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
          .where(
            and(
              eq(reservationItems.productId, product.id),
              not(eq(reservationItems.combinationKey, DEFAULT_COMBINATION_KEY)),
              inArray(reservations.status, blockingStatuses),
              gte(reservations.endDate, new Date()),
            ),
          )
          .limit(1);
        if (conflict) throw productErrors.unitTrackingInUse();
      }

      const editableUnits =
        syncUnits && (trackUnits || product.trackUnits)
          ? product.units.filter((unit) => unit.lifecycleStatus === "active")
          : [];
      const unitsById = new Map(editableUnits.map((unit) => [unit.id, unit]));
      const unitsToUpdate = syncUnits
        ? units.filter((unit) => unit.id && unitsById.has(unit.id))
        : [];
      const unitsToInsert = syncUnits ? units.filter((unit) => !unit.id) : [];
      const keptIds = new Set(
        trackUnits ? unitsToUpdate.flatMap((unit) => (unit.id ? [unit.id] : [])) : [],
      );
      const unitsToDelete = editableUnits.filter((unit) => !keptIds.has(unit.id));

      const blockedIds = await assignedBlockingUnitIds(tx, {
        unitIds: unitsToDelete.map((unit) => unit.id),
        storeId,
        pendingBlocksAvailability,
      });
      if (blockedIds.size > 0) {
        throw productErrors.unitsAssigned(unitsToDelete.filter((unit) => blockedIds.has(unit.id)));
      }

      if (syncUnits && trackUnits) {
        await checkUnitCapacity(tx, {
          storeId,
          product,
          axes,
          bookingAxesChanged,
          blockingStatuses,
          editableUnits,
          unitsToUpdate,
          unitsToInsert,
        });
      }

      const categoryIds = await resolveCategoryIds(tx, storeId, data);

      // The stock kind cannot change while a confirmed or ongoing
      // reservation holds the product (its reservations are locked above).
      if (stockKindChanges && !canChangeStockKind) throw productErrors.stockKindLocked();

      // What the update destroys, asked for under the lock.
      const [{ seasonalCount }] =
        pricing.pricingKind === "fixed"
          ? await tx
              .select({ seasonalCount: count() })
              .from(productSeasonalPricing)
              .where(eq(productSeasonalPricing.productId, product.id))
          : [{ seasonalCount: 0 }];
      const preview = updatePreview(product, {
        archives: data.status === "archived" && product.status !== "archived",
        deletedTierCount: pricing.pricingKind === "fixed" ? product.pricingTiers.length : 0,
        deletedSeasonalPricingCount: seasonalCount,
        deletedUnits: unitsToDelete.map((unit) => ({
          id: unit.id,
          identifier: unit.identifier,
          attributes: (unit.attributes as Record<string, string> | null) ?? {},
        })),
      });
      if (
        options.confirm &&
        (preview.archives ||
          preview.deletedTierCount + preview.deletedSeasonalPricingCount > 0 ||
          preview.deletedUnits.length > 0)
      ) {
        refusal = await options.confirm(preview, tx);
        if (refusal) return;
      }

      await tx
        .update(products)
        .set({
          name: data.name,
          description: data.description || null,
          aiContext: data.aiContext?.trim() || null,
          categoryId: categoryIds[0] ?? null,
          price: pricing.price,
          deposit: pricing.deposit,
          pricingMode: pricing.legacyPricingMode,
          pricingKind: pricing.pricingKind,
          stockKind: pricing.stockKind,
          basePeriodMinutes: pricing.basePeriodMinutes,
          ...(!trackUnits ? { quantity: parseInt(data.quantity, 10) } : {}),
          status: data.status,
          images: data.images || [],
          imageHistory: data.imageHistory || [],
          videoUrl: data.videoUrl || null,
          taxSettings: data.taxSettings || null,
          promotion: data.promotion,
          enforceStrictTiers: pricing.enforceStrictTiers,
          trackUnits,
          bookingAttributeAxes: trackUnits && axes.length > 0 ? axes : null,
          updatedAt: new Date(),
        })
        .where(and(eq(products.id, product.id), eq(products.storeId, storeId)));

      if (bookingAxesChanged) {
        await syncProductCombinationKeys(tx, { productId: product.id, axes });
      }
      await replaceProductCategories(tx, product.id, categoryIds);
      await replaceProductAccessories(tx, {
        storeId,
        productId: product.id,
        links: data.accessories ?? [],
      });

      await tx.delete(productPricingTiers).where(eq(productPricingTiers.productId, product.id));
      if (pricing.rateTierRows.length > 0) {
        await tx.insert(productPricingTiers).values(
          pricing.rateTierRows.map((tier, index) => ({
            id: tier.id || nanoid(),
            productId: product.id,
            minDuration: null,
            discountPercent: null,
            period: tier.period,
            price: tier.price,
            displayOrder: index,
          })),
        );
      }

      if (pricing.pricingKind === "fixed") await deleteSeasonalPricings(tx, product.id);

      if (product.status === "active" && data.status !== "active") {
        await tx.insert(marketplaceCatalogTombstones).values({
          entityType: "product",
          entityId: product.id,
          deletedAt: new Date(),
        });
      }

      if (syncUnits && (trackUnits || product.trackUnits)) {
        await saveUnits(tx, {
          actor,
          productId: product.id,
          axes,
          unitsById,
          unitsToDelete,
          unitsToUpdate,
          unitsToInsert,
        });
      }
    }),
  );

  if (refusal) throw refusal;

  emit(actor, {
    type: "product.updated",
    store: eventStore(actor),
    productId: input.id,
    productName: savedName,
  });
  return getProduct(actor, input.id);
}

/** "SKI-2 (size 170)": a unit as a person tells it apart. */
function unitLabel(unit: { identifier: string; attributes: Record<string, string> }) {
  const values = Object.entries(unit.attributes).map(([key, value]) => `${key} ${value}`);
  return values.length > 0 ? `${unit.identifier} (${values.join(", ")})` : unit.identifier;
}

function updatePreview(
  product: LoadedProduct,
  effects: Omit<ProductUpdatePreview, "product" | "summary">,
): ProductUpdatePreview {
  const parts = [
    effects.archives ? "archive it (it leaves the storefront and the catalog)" : null,
    effects.deletedTierCount + effects.deletedSeasonalPricingCount > 0
      ? `delete its ${effects.deletedTierCount} pricing tier(s) and ${effects.deletedSeasonalPricingCount} seasonal price(s) by switching to fixed pricing`
      : null,
    effects.deletedUnits.length > 0
      ? `delete ${effects.deletedUnits.length} unit(s): ${effects.deletedUnits.map(unitLabel).join(", ")}`
      : null,
  ].filter(Boolean);
  return {
    product: {
      id: product.id,
      name: product.name,
      status: product.status,
      updatedAt: product.updatedAt,
    },
    ...effects,
    summary: `Update the product "${product.name}": ${parts.join(", and ")}.`,
  };
}

async function deleteSeasonalPricings(tx: Transaction, productId: string) {
  const seasons = await tx
    .select({ id: productSeasonalPricing.id })
    .from(productSeasonalPricing)
    .where(eq(productSeasonalPricing.productId, productId));
  const ids = seasons.map(({ id }) => id);
  if (ids.length > 0) {
    await tx
      .delete(productSeasonalPricingTiers)
      .where(inArray(productSeasonalPricingTiers.seasonalPricingId, ids));
  }
  await tx.delete(productSeasonalPricing).where(eq(productSeasonalPricing.productId, productId));
}

type StoredUnit = LoadedProduct["units"][number];

/**
 * Refuses edits that would leave fewer active units than the peak of items
 * that current and future reservations hold at once, per combination.
 */
async function checkUnitCapacity(
  tx: Transaction,
  params: {
    storeId: string;
    product: LoadedProduct;
    axes: BookingAttributeAxis[];
    bookingAxesChanged: boolean;
    blockingStatuses: ReturnType<typeof getBlockingReservationStatuses>;
    editableUnits: StoredUnit[];
    unitsToUpdate: ProductUnitInput[];
    unitsToInsert: ProductUnitInput[];
  },
) {
  const { axes, product } = params;
  const from = new Date();
  const current = new Map<string, number>();
  const proposed = new Map<string, number>();
  const add = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) || 0) + 1);

  for (const unit of params.editableUnits) add(current, unit.combinationKey);
  for (const unit of [...params.unitsToUpdate, ...params.unitsToInsert]) {
    add(proposed, buildCombinationKey(axes, resolveUnitAttributes(axes, unit)));
  }

  if (
    !shouldValidateTrackedUnitCapacity({
      wasTrackingUnits: product.trackUnits,
      currentAvailableByCombination: current,
      proposedAvailableByCombination: proposed,
    })
  ) {
    return;
  }

  const reservedRows = await tx
    .select({
      id: reservationItems.id,
      startDate: reservations.startDate,
      endDate: reservations.endDate,
      combinationKey: reservationItems.combinationKey,
      selectedAttributes: reservationItems.selectedAttributes,
      quantity: reservationItems.quantity,
    })
    .from(reservationItems)
    .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
    .where(
      and(
        eq(reservationItems.productId, product.id),
        eq(reservations.storeId, params.storeId),
        inArray(reservations.status, params.blockingStatuses),
        gte(reservations.endDate, from),
      ),
    );
  const assignedRows =
    reservedRows.length > 0
      ? await tx
          .select({
            reservationItemId: reservationItemUnits.reservationItemId,
            productUnitId: reservationItemUnits.productUnitId,
          })
          .from(reservationItemUnits)
          .where(
            inArray(
              reservationItemUnits.reservationItemId,
              reservedRows.map((row) => row.id),
            ),
          )
      : [];
  const assignedByItem = new Map<string, string[]>();
  for (const row of assignedRows) {
    if (!row.productUnitId) continue;
    const held = assignedByItem.get(row.reservationItemId);
    if (held) held.push(row.productUnitId);
    else assignedByItem.set(row.reservationItemId, [row.productUnitId]);
  }
  // The key each kept unit will carry after the save.
  const proposedKeyByUnitId = new Map(
    params.unitsToUpdate.flatMap((unit) =>
      unit.id
        ? [[unit.id, buildCombinationKey(axes, resolveUnitAttributes(axes, unit))] as const]
        : [],
    ),
  );

  const conflict = hasTrackedUnitCapacityConflict({
    availableByCombination: proposed,
    // Booked lines are checked under the keys they will carry after the
    // save, otherwise merging two sizes into one would read as a conflict.
    reservations: reservedRows.flatMap((row) => {
      const combinationKey =
        params.bookingAxesChanged && row.combinationKey !== null
          ? buildCombinationKey(axes, row.selectedAttributes)
          : row.combinationKey;
      // A line booked without any choice floats: any unit serves it, so it
      // only counts against the product's total. A line that chose some
      // variants keeps its combination and is checked as before.
      const choseNothing =
        Object.keys(canonicalizeAttributes(axes, row.selectedAttributes)).length === 0;
      const floating = choseNothing && isPooledCombinationKey(axes, combinationKey);
      // Units a floating or legacy line already holds stay on their own
      // combination, as availability counts them. A line that chose some
      // variants keeps its whole demand on its key: once unassigned it would
      // still owe that choice, which pooled stock cannot express.
      const held =
        floating || combinationKey === null
          ? (assignedByItem.get(row.id) ?? [])
              .flatMap((unitId) => {
                const key = proposedKeyByUnitId.get(unitId);
                return key ? [key] : [];
              })
              .slice(0, row.quantity)
          : [];
      const remainder = row.quantity - held.length;
      return [
        ...held.map((key) => ({
          startDate: row.startDate,
          endDate: row.endDate,
          quantity: 1,
          combinationKey: key,
        })),
        ...(remainder > 0
          ? [
              {
                startDate: row.startDate,
                endDate: row.endDate,
                quantity: remainder,
                combinationKey: floating ? null : combinationKey,
              },
            ]
          : []),
      ];
    }),
    from,
  });
  if (conflict) throw productErrors.unitCapacityConflict();
}

/** Deletes, updates and creates the product's units, each with its unit event. */
async function saveUnits(
  tx: Transaction,
  params: {
    actor: ProductActor;
    productId: string;
    axes: BookingAttributeAxis[];
    unitsById: Map<string, StoredUnit>;
    unitsToDelete: StoredUnit[];
    unitsToUpdate: ProductUnitInput[];
    unitsToInsert: ProductUnitInput[];
  },
) {
  const { actor, productId, axes } = params;
  const storeId = actor.storeId;

  const updates: UpdateUnitMutation[] = params.unitsToUpdate.flatMap((unit) => {
    const existing = unit.id ? params.unitsById.get(unit.id) : undefined;
    if (!unit.id || !existing) return [];
    const identifier = unit.identifier.trim();
    const attributes = resolveUnitAttributes(axes, unit);
    const combinationKey = buildCombinationKey(axes, attributes);
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (identifier !== existing.identifier) {
      changes.identifier = { from: existing.identifier, to: identifier };
    }
    if (combinationKey !== existing.combinationKey) {
      changes.combinationKey = { from: existing.combinationKey, to: combinationKey };
    }
    if (JSON.stringify(attributes) !== JSON.stringify(existing.attributes ?? {})) {
      changes.attributes = { from: existing.attributes ?? {}, to: attributes };
    }
    if (Object.keys(changes).length === 0) return [];
    return [
      {
        unitId: unit.id,
        values: { identifier, attributes, combinationKey },
        event: {
          storeId,
          type: "updated" as const,
          actorUserId: actor.userId,
          identifierSnapshot: identifier,
          payload: { changes },
        },
      },
    ];
  });

  await deleteUnits(
    tx,
    params.unitsToDelete.map((unit) => ({
      unitId: unit.id,
      event: {
        storeId,
        type: "deleted" as const,
        actorUserId: actor.userId,
        identifierSnapshot: unit.identifier,
        payload: { productId, identifier: unit.identifier, combinationKey: unit.combinationKey },
      },
    })),
  );
  await updateUnits(tx, updates);
  await createUnits(
    tx,
    params.unitsToInsert.map((unit) => {
      const attributes = resolveUnitAttributes(axes, unit);
      const row = {
        id: nanoid(),
        productId,
        identifier: unit.identifier.trim(),
        notes: newUnitNotes(unit)?.trim() || null,
        purchasePrice: normalizeNullablePriceInput(newUnitPurchasePrice(unit)),
        purchasedAt: normalizeNullableDateInput(newUnitPurchasedAt(unit)),
        images: newUnitImages(unit),
        lifecycleStatus: "active" as const,
        attributes,
        combinationKey: buildCombinationKey(axes, attributes),
      };
      return {
        unit: row,
        event: {
          storeId,
          actorUserId: actor.userId,
          identifierSnapshot: row.identifier,
          payload: { productId, identifier: row.identifier, combinationKey: row.combinationKey },
        },
      };
    }),
  );
}

// --- Status ------------------------------------------------------------------

export interface ProductStatusPreview {
  product: { id: string; name: string; status: StoredProduct["status"]; updatedAt: Date };
  /** Pending, confirmed or ongoing reservations that hold the product; they are kept. */
  activeReservationCount: number;
  summary: string;
}

/**
 * Publishes, unpublishes or archives a product. Leaving `active` records a
 * marketplace tombstone. `confirm` is asked when the product gets archived.
 */
export async function updateProductStatus(
  actor: ProductActor,
  input: { id: string; status: "draft" | "active" | "archived" },
  options: { confirm?: ConfirmStep<ProductStatusPreview> } = {},
) {
  const { storeId } = actor;
  let refusal: Error | null = null;
  let previousStatus: StoredProduct["status"] = null;

  await db.transaction(async (tx) => {
    await lockStoreProducts(tx, storeId);
    const [product] = await tx
      .select({
        id: products.id,
        name: products.name,
        status: products.status,
        updatedAt: products.updatedAt,
      })
      .from(products)
      .where(and(eq(products.id, input.id), eq(products.storeId, storeId)))
      .limit(1);
    if (!product) throw productErrors.notFound(input.id);
    previousStatus = product.status;

    if (options.confirm && input.status === "archived" && product.status !== "archived") {
      const [{ active }] = await tx
        .select({ active: count() })
        .from(reservationItems)
        .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
        .where(
          and(
            eq(reservationItems.productId, product.id),
            eq(reservations.storeId, storeId),
            inArray(reservations.status, ["pending", "confirmed", "ongoing"]),
          ),
        );
      refusal = await options.confirm(
        {
          product,
          activeReservationCount: active,
          summary:
            `Archive the product "${product.name}": it leaves the storefront and the catalog.` +
            (active > 0 ? ` ${active} active reservation(s) that hold it are kept.` : ""),
        },
        tx,
      );
      if (refusal) return;
    }

    await tx
      .update(products)
      .set({ status: input.status, updatedAt: new Date() })
      .where(and(eq(products.id, input.id), eq(products.storeId, storeId)));
    if (product.status === "active" && input.status !== "active") {
      await tx.insert(marketplaceCatalogTombstones).values({
        entityType: "product",
        entityId: input.id,
        deletedAt: new Date(),
      });
    }
  });

  if (refusal) throw refusal;
  emit(actor, { type: "products.changed", store: eventStore(actor) });
  return { id: input.id, status: input.status, previousStatus };
}

// --- Delete ------------------------------------------------------------------

export interface ProductDeletionPreview {
  product: { id: string; name: string; updatedAt: Date };
  units: Array<{ id: string; identifier: string }>;
  /** Reservations with a line of this product; they keep their lines. */
  reservationCount: number;
  summary: string;
}

/**
 * Deletes a product for good, with its units (each with a "deleted" unit
 * event), its category links and its accessory links both ways, and records
 * a marketplace tombstone. Refused while a reservation holds one of its
 * units. `confirm` receives what it will delete, under the lock.
 */
export async function deleteProduct(
  actor: ProductActor,
  id: string,
  options: { confirm?: ConfirmStep<ProductDeletionPreview> } = {},
) {
  const { storeId } = actor;
  let refusal: Error | null = null;
  let deletedUnitCount = 0;

  await db.transaction(async (tx) => {
    await lockStoreProducts(tx, storeId);
    // The product, then its units, before the first plain read: a unit
    // assigned meanwhile is seen (see `updateProduct`).
    const product = await lockProduct(tx, storeId, id);
    const units = (await lockProductUnits(tx, id)).sort((a, b) =>
      a.identifier.localeCompare(b.identifier),
    );
    const blockedIds = await assignedBlockingUnitIds(tx, {
      unitIds: units.map((unit) => unit.id),
      storeId,
      pendingBlocksAvailability: actor.store.settings?.pendingBlocksAvailability ?? true,
    });
    if (blockedIds.size > 0) {
      throw productErrors.unitsAssigned(units.filter((unit) => blockedIds.has(unit.id)));
    }

    if (options.confirm) {
      const [{ reservationCount }] = await tx
        .select({
          reservationCount: sql<number>`COUNT(DISTINCT ${reservationItems.reservationId})`.mapWith(
            Number,
          ),
        })
        .from(reservationItems)
        .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
        .where(and(eq(reservationItems.productId, id), eq(reservations.storeId, storeId)));
      refusal = await options.confirm(
        {
          product,
          units: units.map((unit) => ({ id: unit.id, identifier: unit.identifier })),
          reservationCount,
          summary:
            `Delete the product "${product.name}" for good` +
            (units.length > 0 ? `, with its ${units.length} unit(s)` : "") +
            "." +
            (reservationCount > 0
              ? ` ${reservationCount} reservation(s) with this product keep their lines.`
              : ""),
        },
        tx,
      );
      if (refusal) return;
    }

    await tx
      .delete(productAccessories)
      .where(or(eq(productAccessories.productId, id), eq(productAccessories.accessoryId, id)));
    await tx.delete(productCategories).where(eq(productCategories.productId, id));
    await deleteUnits(
      tx,
      units.map((unit) => ({
        unitId: unit.id,
        event: {
          storeId,
          type: "deleted" as const,
          actorUserId: actor.userId,
          identifierSnapshot: unit.identifier,
          payload: {
            productId: id,
            identifier: unit.identifier,
            combinationKey: unit.combinationKey,
          },
        },
      })),
    );
    await tx.insert(marketplaceCatalogTombstones).values({
      entityType: "product",
      entityId: id,
      deletedAt: new Date(),
    });
    await tx.delete(products).where(and(eq(products.id, id), eq(products.storeId, storeId)));
    deletedUnitCount = units.length;
  });

  if (refusal) throw refusal;
  emit(actor, { type: "products.changed", store: eventStore(actor) });
  return { id, deletedUnitCount };
}

// --- Duplicate ---------------------------------------------------------------

/**
 * Copies a product as a draft named "<name> (copy)", with its categories and,
 * for duration pricing, its tiers. Units are not copied (their identifiers
 * are unique): the copy does not track units and keeps the stock count.
 */
export async function duplicateProduct(actor: ProductActor, id: string) {
  const { storeId } = actor;
  const newId = nanoid();

  await db.transaction(async (tx) => {
    await lockStoreProducts(tx, storeId);
    const [product] = await tx
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.storeId, storeId)))
      .limit(1);
    if (!product) throw productErrors.notFound(id);
    const pricingTiers = await tx
      .select()
      .from(productPricingTiers)
      .where(eq(productPricingTiers.productId, id));

    const quantity = product.trackUnits
      ? ((await getEffectiveProductQuantities(tx, [product.id])).get(product.id) ?? 0)
      : product.quantity;
    const name = `${product.name} (copy)`;

    await tx.insert(products).values({
      id: newId,
      storeId,
      name,
      slug: await nextProductSlug(tx, storeId, name),
      description: product.description,
      categoryId: product.categoryId,
      price: product.price,
      deposit: product.deposit,
      pricingMode: product.pricingMode,
      pricingKind: product.pricingKind,
      stockKind: product.stockKind,
      basePeriodMinutes: product.pricingKind === "fixed" ? null : product.basePeriodMinutes,
      quantity,
      status: "draft",
      images: product.images,
      videoUrl: product.videoUrl,
      taxSettings: product.taxSettings,
      enforceStrictTiers: product.pricingKind === "fixed" ? false : product.enforceStrictTiers,
      trackUnits: false,
      bookingAttributeAxes: null,
    });

    const links = await tx
      .select({ categoryId: productCategories.categoryId, position: productCategories.position })
      .from(productCategories)
      .where(eq(productCategories.productId, id))
      .orderBy(asc(productCategories.position));
    if (links.length > 0) {
      await tx
        .insert(productCategories)
        .values(links.map((link) => ({ id: nanoid(), productId: newId, ...link })));
    }

    if (product.pricingKind === "duration" && pricingTiers.length > 0) {
      await tx.insert(productPricingTiers).values(
        pricingTiers.map((tier) => ({
          id: nanoid(),
          productId: newId,
          minDuration: tier.period && tier.price ? null : tier.minDuration,
          discountPercent: tier.period && tier.price ? null : tier.discountPercent,
          period: tier.period,
          price: tier.price,
          displayOrder: tier.displayOrder,
        })),
      );
    }
  });

  emit(actor, { type: "products.changed", store: eventStore(actor) });
  return getProduct(actor, newId);
}

// --- Order -------------------------------------------------------------------

/**
 * Puts the given products in the given order. They take the places they
 * already held among themselves, so a list showing part of the catalog
 * (filters, page) leaves every other product in its place; then every
 * position is renumbered so no two products share one. Ids of other stores
 * are ignored.
 */
export async function reorderProducts(actor: ProductActor, ids: readonly string[]) {
  const { storeId } = actor;
  let positions: Array<{ id: string; position: number }> = [];

  await db.transaction(async (tx) => {
    await lockStoreProducts(tx, storeId);
    // Current catalog order, read the same way the dashboard and storefront sort.
    const current = await tx
      .select({ id: products.id, displayOrder: products.displayOrder })
      .from(products)
      .where(eq(products.storeId, storeId))
      .orderBy(asc(products.displayOrder), desc(products.createdAt));
    const known = new Set(current.map((row) => row.id));
    const reordered = [...new Set(ids)].filter((id) => known.has(id));
    const reorderedSet = new Set(reordered);

    let next = 0;
    const finalOrder = current.map((row) =>
      reorderedSet.has(row.id) ? reordered[next++] : row.id,
    );
    const before = new Map(current.map((row) => [row.id, row.displayOrder]));
    const now = new Date();
    for (const [index, id] of finalOrder.entries()) {
      if (before.get(id) === index) continue;
      await tx
        .update(products)
        .set({ displayOrder: index, updatedAt: now })
        .where(and(eq(products.storeId, storeId), eq(products.id, id)));
    }
    const positionOf = new Map(finalOrder.map((id, index) => [id, index]));
    positions = reordered.map((id) => ({ id, position: positionOf.get(id) ?? 0 }));
  });

  emit(actor, { type: "products.changed", store: eventStore(actor) });
  return { items: positions };
}
