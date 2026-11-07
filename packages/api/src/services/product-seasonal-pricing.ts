import {
  db,
  productSeasonalPricing,
  productSeasonalPricingTiers,
  products,
  type Transaction,
} from "@louez/db";
import { minutesToPriceDuration, priceDurationToMinutes } from "@louez/utils";
import { and, asc, eq, gt, gte, inArray, lte, ne, or, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { z } from "zod";

import {
  SEASONAL_PRICING_PAGE_MAX,
  productErrors,
  type SeasonalPricing,
  type createSeasonalPricingInput,
  type updateSeasonalPricingInput,
} from "../contracts/products";
import type { ApiEvent } from "../platform/ports";
import { lockStoreProducts, type ConfirmStep, type ProductActor } from "./products";

/**
 * Seasonal prices of a product: a base price and tiers that replace the
 * product's own on the days of the season. Moved from the dashboard's
 * seasonal pricing actions. Writes take the store's product lock, so two
 * seasons of one product can never overlap.
 */

type TierInput = NonNullable<z.infer<typeof createSeasonalPricingInput>["rateTiers"]>[number];

const normalizePrice = (value: string | undefined) => (value || "0").replace(",", ".");

const tierRows = (seasonalPricingId: string, tiers: readonly TierInput[]) =>
  tiers.map((tier, index) => ({
    id: nanoid(),
    seasonalPricingId,
    period: priceDurationToMinutes(tier.duration, tier.unit),
    price: normalizePrice(tier.price),
    minDuration: null,
    discountPercent: null,
    displayOrder: index,
  }));

function emit(actor: ProductActor, productId: string) {
  const event: ApiEvent = {
    type: "product.seasonalPricing.changed",
    store: {
      id: actor.store.id,
      name: actor.store.name,
      slug: actor.store.slug,
      ownerUserId: actor.store.ownerUserId,
    },
    productId,
  };
  try {
    actor.afterCommit(event);
  } catch (error) {
    console.error("A seasonal pricing effect failed after its commit:", error);
  }
}

/** The product, when the store has it; with `forSeasons`, refused for fixed pricing. */
async function ownedProduct(
  executor: Transaction | typeof db,
  storeId: string,
  productId: string,
  options: { forSeasons?: boolean } = {},
) {
  const [product] = await executor
    .select({ id: products.id, name: products.name, pricingKind: products.pricingKind })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.storeId, storeId)))
    .limit(1);
  if (!product) throw productErrors.notFound(productId);
  if (options.forSeasons && product.pricingKind === "fixed") {
    throw productErrors.seasonalFixedProduct(productId);
  }
  return product;
}

/** The season with its product, when that product is the store's. */
async function ownedSeason(executor: Transaction | typeof db, storeId: string, id: string) {
  const [row] = await executor
    .select({
      season: productSeasonalPricing,
      productName: products.name,
      pricingKind: products.pricingKind,
    })
    .from(productSeasonalPricing)
    .innerJoin(products, eq(products.id, productSeasonalPricing.productId))
    .where(and(eq(productSeasonalPricing.id, id), eq(products.storeId, storeId)))
    .limit(1);
  if (!row) throw productErrors.seasonalNotFound(id);
  return row;
}

/** Throws when the days overlap another season of the product. */
async function assertNoOverlap(
  tx: Transaction,
  params: { productId: string; startDate: string; endDate: string; excludeId?: string },
) {
  const conditions = [
    eq(productSeasonalPricing.productId, params.productId),
    lte(productSeasonalPricing.startDate, params.endDate),
    gte(productSeasonalPricing.endDate, params.startDate),
  ];
  if (params.excludeId) conditions.push(ne(productSeasonalPricing.id, params.excludeId));
  const [overlapping] = await tx
    .select({ id: productSeasonalPricing.id, name: productSeasonalPricing.name })
    .from(productSeasonalPricing)
    .where(and(...conditions))
    .limit(1);
  if (overlapping) throw productErrors.seasonalOverlap(overlapping);
}

function assertDates(startDate: string, endDate: string) {
  if (startDate >= endDate) throw productErrors.seasonalDates();
}

/** Moves a YYYY-MM-DD day by whole years. */
function shiftDateByYear(dateStr: string, years: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setFullYear(d.getFullYear() + years);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function readSeasons(executor: Transaction | typeof db, where: SQL, limit: number) {
  const rows = await executor
    .select()
    .from(productSeasonalPricing)
    .where(where)
    .orderBy(asc(productSeasonalPricing.startDate), asc(productSeasonalPricing.id))
    .limit(limit);
  // Tiers read apart: a relational query reads decimals through JSON, which
  // drops their trailing zeros.
  const tiers =
    rows.length === 0
      ? []
      : await executor
          .select()
          .from(productSeasonalPricingTiers)
          .where(
            inArray(
              productSeasonalPricingTiers.seasonalPricingId,
              rows.map((row) => row.id),
            ),
          )
          .orderBy(asc(productSeasonalPricingTiers.displayOrder));
  const seasons = rows.map((row) => ({
    ...row,
    tiers: tiers.filter((tier) => tier.seasonalPricingId === row.id),
  }));
  return seasons.map(
    (season): SeasonalPricing => ({
      id: season.id,
      productId: season.productId,
      name: season.name,
      startDate: season.startDate,
      endDate: season.endDate,
      price: season.price,
      tiers: season.tiers.map((tier) => {
        const duration = tier.period ? minutesToPriceDuration(tier.period) : null;
        return {
          id: tier.id,
          price: tier.price,
          period: tier.period,
          duration: duration?.duration ?? null,
          unit: duration?.unit ?? null,
          minDuration: tier.minDuration,
          discountPercent: tier.discountPercent,
          displayOrder: tier.displayOrder,
        };
      }),
      createdAt: season.createdAt,
      updatedAt: season.updatedAt,
    }),
  );
}

async function getSeason(storeId: string, id: string) {
  await ownedSeason(db, storeId, id);
  const [season] = await readSeasons(db, eq(productSeasonalPricing.id, id), 1);
  if (!season) throw productErrors.seasonalNotFound(id);
  return season;
}

// --- Reads -------------------------------------------------------------------

/** One page of a product's seasons, by start day then id; the cursor is the last id. */
export async function listSeasonalPricings(
  storeId: string,
  input: { productId: string; cursor?: string; limit?: number },
) {
  await ownedProduct(db, storeId, input.productId);
  const limit = input.limit ?? SEASONAL_PRICING_PAGE_MAX;
  const conditions: SQL[] = [eq(productSeasonalPricing.productId, input.productId)];
  if (input.cursor) {
    const [after] = await db
      .select({ startDate: productSeasonalPricing.startDate, id: productSeasonalPricing.id })
      .from(productSeasonalPricing)
      .where(
        and(
          eq(productSeasonalPricing.id, input.cursor),
          eq(productSeasonalPricing.productId, input.productId),
        ),
      )
      .limit(1);
    if (!after) throw productErrors.invalidCursor("products_list_seasonal_pricings");
    conditions.push(
      or(
        gt(productSeasonalPricing.startDate, after.startDate),
        and(
          eq(productSeasonalPricing.startDate, after.startDate),
          gt(productSeasonalPricing.id, after.id),
        ),
      ) as SQL,
    );
  }
  const seasons = await readSeasons(db, and(...conditions) as SQL, limit + 1);
  const items = seasons.slice(0, limit);
  return {
    items,
    nextCursor: seasons.length > limit ? (items.at(-1)?.id ?? null) : null,
  };
}

// --- Writes ------------------------------------------------------------------

export async function createSeasonalPricing(
  actor: ProductActor,
  input: z.infer<typeof createSeasonalPricingInput>,
) {
  assertDates(input.startDate, input.endDate);
  const id = nanoid();
  await db.transaction(async (tx) => {
    await lockStoreProducts(tx, actor.storeId);
    await ownedProduct(tx, actor.storeId, input.productId, { forSeasons: true });
    await assertNoOverlap(tx, input);
    await tx.insert(productSeasonalPricing).values({
      id,
      productId: input.productId,
      name: input.name,
      startDate: input.startDate,
      endDate: input.endDate,
      price: normalizePrice(input.price),
    });
    if (input.rateTiers && input.rateTiers.length > 0) {
      await tx.insert(productSeasonalPricingTiers).values(tierRows(id, input.rateTiers));
    }
  });
  emit(actor, input.productId);
  return getSeason(actor.storeId, id);
}

/** Partial: a field left out is unchanged; rateTiers sent replaces the tiers. */
export async function updateSeasonalPricing(
  actor: ProductActor,
  input: z.infer<typeof updateSeasonalPricingInput>,
) {
  let productId = "";
  await db.transaction(async (tx) => {
    await lockStoreProducts(tx, actor.storeId);
    const { season } = await ownedSeason(tx, actor.storeId, input.id);
    productId = season.productId;
    const startDate = input.startDate ?? season.startDate;
    const endDate = input.endDate ?? season.endDate;
    assertDates(startDate, endDate);
    await assertNoOverlap(tx, { productId, startDate, endDate, excludeId: input.id });

    await tx
      .update(productSeasonalPricing)
      .set({
        name: input.name ?? season.name,
        startDate,
        endDate,
        price: input.price !== undefined ? normalizePrice(input.price) : season.price,
        updatedAt: new Date(),
      })
      .where(eq(productSeasonalPricing.id, input.id));

    if (input.rateTiers !== undefined) {
      await tx
        .delete(productSeasonalPricingTiers)
        .where(eq(productSeasonalPricingTiers.seasonalPricingId, input.id));
      if (input.rateTiers.length > 0) {
        await tx.insert(productSeasonalPricingTiers).values(tierRows(input.id, input.rateTiers));
      }
    }
  });
  emit(actor, productId);
  return getSeason(actor.storeId, input.id);
}

/**
 * Copies a season one year later, named "<name> (copie)", with its tiers.
 * Refused when the new days overlap another season.
 */
export async function duplicateSeasonalPricing(actor: ProductActor, id: string) {
  const newId = nanoid();
  let productId = "";
  await db.transaction(async (tx) => {
    await lockStoreProducts(tx, actor.storeId);
    const { season } = await ownedSeason(tx, actor.storeId, id);
    productId = season.productId;
    const startDate = shiftDateByYear(season.startDate, 1);
    const endDate = shiftDateByYear(season.endDate, 1);
    await assertNoOverlap(tx, { productId, startDate, endDate });

    await tx.insert(productSeasonalPricing).values({
      id: newId,
      productId,
      name: `${season.name} (copie)`,
      startDate,
      endDate,
      price: season.price,
    });
    const tiers = await tx
      .select()
      .from(productSeasonalPricingTiers)
      .where(eq(productSeasonalPricingTiers.seasonalPricingId, id))
      .orderBy(asc(productSeasonalPricingTiers.displayOrder));
    if (tiers.length > 0) {
      await tx.insert(productSeasonalPricingTiers).values(
        tiers.map((tier) => ({
          id: nanoid(),
          seasonalPricingId: newId,
          period: tier.period,
          price: tier.price,
          minDuration: tier.minDuration,
          discountPercent: tier.discountPercent,
          displayOrder: tier.displayOrder,
        })),
      );
    }
  });
  emit(actor, productId);
  return getSeason(actor.storeId, newId);
}

/** What deleting a season would do, for its confirmation preview. */
export interface SeasonalPricingDeletionPreview {
  season: {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    price: string;
    updatedAt: Date;
  };
  product: { id: string; name: string };
  tierCount: number;
  summary: string;
}

/**
 * Deletes a season and its tiers; the product's own rates apply on its days
 * again. `confirm` receives what it deletes, under the lock.
 */
export async function deleteSeasonalPricing(
  actor: ProductActor,
  id: string,
  options: { confirm?: ConfirmStep<SeasonalPricingDeletionPreview> } = {},
) {
  let refusal: Error | null = null;
  let productId = "";
  await db.transaction(async (tx) => {
    await lockStoreProducts(tx, actor.storeId);
    const { season, productName } = await ownedSeason(tx, actor.storeId, id);
    productId = season.productId;

    if (options.confirm) {
      const tiers = await tx
        .select({ id: productSeasonalPricingTiers.id })
        .from(productSeasonalPricingTiers)
        .where(eq(productSeasonalPricingTiers.seasonalPricingId, id));
      refusal = await options.confirm(
        {
          season: {
            id: season.id,
            name: season.name,
            startDate: season.startDate,
            endDate: season.endDate,
            price: season.price,
            updatedAt: season.updatedAt,
          },
          product: { id: season.productId, name: productName },
          tierCount: tiers.length,
          summary: `Delete the season "${season.name}" (${season.startDate} to ${season.endDate}) of "${productName}" and its ${tiers.length} tier(s). The product's own rates apply on those days again.`,
        },
        tx,
      );
      if (refusal) return;
    }

    await tx
      .delete(productSeasonalPricingTiers)
      .where(eq(productSeasonalPricingTiers.seasonalPricingId, id));
    await tx.delete(productSeasonalPricing).where(eq(productSeasonalPricing.id, id));
  });

  if (refusal) throw refusal;
  emit(actor, productId);
  return { id, productId };
}
