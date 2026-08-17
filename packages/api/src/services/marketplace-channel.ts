import { and, eq, inArray, sql } from "drizzle-orm";

import {
  categories,
  db,
  products,
  storeIntegrations,
  storeMarketplaceCategoryMappings,
  storeMarketplaceChannels,
  stores,
} from "@louez/db";
import type {
  MarketplaceCategoryMappingsInput,
  MarketplaceChannelEnableInput,
} from "@louez/validations";

import { ApiServiceError } from "./errors";

export interface MarketplacePublicationChecklist {
  addressAndGeolocation: boolean;
  activeProductWithImageAndPrice: boolean;
  stripeChargesEnabled: boolean;
  cgvPresent: boolean;
  marketplaceTermsAccepted: boolean;
  complete: boolean;
}

export interface MarketplaceChannelState {
  channel: {
    enabledByOwner: boolean;
    status: "setup_required" | "pending" | "published" | "paused" | "disabled";
    publishedAt: string | null;
    disabledAt: string | null;
    termsAcceptedAt: string | null;
    claimedBusinessId: string | null;
    claimConfirmedAt: string | null;
    statusReason: string | null;
    updatedAt: string;
    version: number;
  } | null;
  checklist: MarketplacePublicationChecklist;
  categoryMappings: MarketplaceCategoryMappingsInput;
}

async function evaluateMarketplaceChecklist(params: {
  storeId: string;
  termsAcceptedAt: Date | null;
}): Promise<MarketplacePublicationChecklist> {
  const store = await db.query.stores.findFirst({
    where: eq(stores.id, params.storeId),
    columns: {
      address: true,
      latitude: true,
      longitude: true,
      stripeChargesEnabled: true,
      cgv: true,
    },
  });
  if (!store) {
    throw new ApiServiceError("NOT_FOUND", "errors.storeNotFound");
  }

  const activeProducts = await db
    .select({
      images: products.images,
      price: products.price,
    })
    .from(products)
    .where(and(eq(products.storeId, params.storeId), eq(products.status, "active")));
  const latitude = store.latitude === null ? Number.NaN : Number(store.latitude);
  const longitude = store.longitude === null ? Number.NaN : Number(store.longitude);
  const addressAndGeolocation =
    Boolean(store.address?.trim()) &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180;
  const activeProductWithImageAndPrice = activeProducts.some(
    (product) =>
      (product.images ?? []).some((image) => image.trim().length > 0) && Number(product.price) > 0,
  );
  const checklist = {
    addressAndGeolocation,
    activeProductWithImageAndPrice,
    stripeChargesEnabled: store.stripeChargesEnabled === true,
    cgvPresent: Boolean(store.cgv?.trim()),
    marketplaceTermsAccepted: params.termsAcceptedAt !== null,
  };

  return {
    ...checklist,
    complete: Object.values(checklist).every(Boolean),
  };
}

function statusReasonFromChecklist(checklist: MarketplacePublicationChecklist): string | null {
  const missing = [
    ["address_and_geolocation", checklist.addressAndGeolocation],
    ["active_product_with_image_and_price", checklist.activeProductWithImageAndPrice],
    ["stripe_charges_enabled", checklist.stripeChargesEnabled],
    ["cgv", checklist.cgvPresent],
    ["marketplace_terms", checklist.marketplaceTermsAccepted],
  ]
    .filter((entry) => entry[1] === false)
    .map((entry) => entry[0]);

  return missing.length > 0 ? `missing:${missing.join(",")}` : null;
}

export async function enableMarketplaceChannel(params: {
  storeId: string;
  connectedByUserId: string;
  input: MarketplaceChannelEnableInput;
}): Promise<MarketplaceChannelState> {
  const existing = await db.query.storeMarketplaceChannels.findFirst({
    where: eq(storeMarketplaceChannels.storeId, params.storeId),
  });
  const now = new Date();
  const termsAcceptedAt = params.input.acceptTerms ? now : (existing?.termsAcceptedAt ?? null);
  const checklist = await evaluateMarketplaceChecklist({
    storeId: params.storeId,
    termsAcceptedAt,
  });

  await db.transaction(async (tx) => {
    await tx
      .insert(storeIntegrations)
      .values({
        storeId: params.storeId,
        providerKey: "marketplace",
        category: "sales-channel",
        enabled: true,
        connectedByUserId: params.connectedByUserId,
        status: "active",
        updatedAt: now,
      })
      .onDuplicateKeyUpdate({
        set: {
          category: "sales-channel",
          enabled: true,
          status: "active",
          updatedAt: now,
        },
      });

    const status = checklist.complete ? "pending" : "setup_required";
    const statusReason = statusReasonFromChecklist(checklist);
    if (existing) {
      await tx
        .update(storeMarketplaceChannels)
        .set({
          enabledByOwner: true,
          status,
          disabledAt: null,
          termsAcceptedAt,
          statusReason,
          updatedAt: now,
          version: sql`${storeMarketplaceChannels.version} + 1`,
        })
        .where(eq(storeMarketplaceChannels.storeId, params.storeId));
    } else {
      await tx.insert(storeMarketplaceChannels).values({
        storeId: params.storeId,
        enabledByOwner: true,
        status,
        termsAcceptedAt,
        statusReason,
        updatedAt: now,
      });
    }

    if (checklist.complete) {
      await tx
        .update(storeMarketplaceChannels)
        .set({
          status: "published",
          publishedAt: existing?.publishedAt ?? now,
          statusReason: null,
          updatedAt: now,
          version: sql`${storeMarketplaceChannels.version} + 1`,
        })
        .where(eq(storeMarketplaceChannels.storeId, params.storeId));
    }
  });

  return getMarketplaceChannelState({ storeId: params.storeId });
}

export async function disableMarketplaceChannel(params: {
  storeId: string;
}): Promise<MarketplaceChannelState> {
  const existing = await db.query.storeMarketplaceChannels.findFirst({
    where: eq(storeMarketplaceChannels.storeId, params.storeId),
  });
  if (!existing) {
    throw new ApiServiceError("NOT_FOUND", "errors.marketplaceChannelNotFound");
  }

  const now = new Date();
  const status = existing.publishedAt ? "paused" : "disabled";
  await db.transaction(async (tx) => {
    await tx
      .update(storeMarketplaceChannels)
      .set({
        enabledByOwner: false,
        status,
        disabledAt: now,
        statusReason: "disabled_by_owner",
        updatedAt: now,
        version: sql`${storeMarketplaceChannels.version} + 1`,
      })
      .where(eq(storeMarketplaceChannels.storeId, params.storeId));
    await tx
      .update(storeIntegrations)
      .set({
        enabled: false,
        status: "disabled",
        updatedAt: now,
      })
      .where(
        and(
          eq(storeIntegrations.storeId, params.storeId),
          eq(storeIntegrations.providerKey, "marketplace"),
        ),
      );
  });

  return getMarketplaceChannelState({ storeId: params.storeId });
}

export async function saveCategoryMappings(params: {
  storeId: string;
  mappings: MarketplaceCategoryMappingsInput;
}): Promise<MarketplaceChannelState> {
  const categoryIds = params.mappings.map((mapping) => mapping.categoryId);
  if (new Set(categoryIds).size !== categoryIds.length) {
    throw new ApiServiceError("BAD_REQUEST", "errors.invalidData");
  }
  const ownedCategories =
    categoryIds.length === 0
      ? []
      : await db
          .select({ id: categories.id })
          .from(categories)
          .where(and(eq(categories.storeId, params.storeId), inArray(categories.id, categoryIds)));
  if (ownedCategories.length !== categoryIds.length) {
    throw new ApiServiceError("BAD_REQUEST", "errors.invalidData");
  }

  const existing = await db.query.storeMarketplaceChannels.findFirst({
    where: eq(storeMarketplaceChannels.storeId, params.storeId),
  });
  if (!existing) {
    throw new ApiServiceError("NOT_FOUND", "errors.marketplaceChannelNotFound");
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .delete(storeMarketplaceCategoryMappings)
      .where(eq(storeMarketplaceCategoryMappings.storeId, params.storeId));
    if (params.mappings.length > 0) {
      await tx.insert(storeMarketplaceCategoryMappings).values(
        params.mappings.map((mapping) => ({
          storeId: params.storeId,
          categoryId: mapping.categoryId,
          marketplaceCategorySlug: mapping.marketplaceCategorySlug,
          updatedAt: now,
        })),
      );
    }
    await tx
      .update(storeMarketplaceChannels)
      .set({
        updatedAt: now,
        version: sql`${storeMarketplaceChannels.version} + 1`,
      })
      .where(eq(storeMarketplaceChannels.storeId, params.storeId));
  });

  return getMarketplaceChannelState({ storeId: params.storeId });
}

export async function confirmDirectoryClaim(params: {
  storeId: string;
  businessId: string;
}): Promise<MarketplaceChannelState> {
  const businessId = params.businessId.trim();
  if (!businessId) {
    throw new ApiServiceError("BAD_REQUEST", "errors.invalidData");
  }

  const existing = await db.query.storeMarketplaceChannels.findFirst({
    where: eq(storeMarketplaceChannels.storeId, params.storeId),
    columns: { enabledByOwner: true },
  });
  if (!existing?.enabledByOwner) {
    throw new ApiServiceError("NOT_FOUND", "errors.marketplaceChannelNotFound");
  }

  const now = new Date();
  await db
    .update(storeMarketplaceChannels)
    .set({
      claimedBusinessId: businessId,
      claimConfirmedAt: now,
      updatedAt: now,
      version: sql`${storeMarketplaceChannels.version} + 1`,
    })
    .where(eq(storeMarketplaceChannels.storeId, params.storeId));

  return getMarketplaceChannelState({ storeId: params.storeId });
}

export async function dismissDirectoryClaim(params: {
  storeId: string;
}): Promise<MarketplaceChannelState> {
  const existing = await db.query.storeMarketplaceChannels.findFirst({
    where: eq(storeMarketplaceChannels.storeId, params.storeId),
    columns: { id: true },
  });
  if (!existing) {
    throw new ApiServiceError("NOT_FOUND", "errors.marketplaceChannelNotFound");
  }

  const now = new Date();
  await db
    .update(storeMarketplaceChannels)
    .set({
      claimedBusinessId: null,
      claimConfirmedAt: null,
      updatedAt: now,
      version: sql`${storeMarketplaceChannels.version} + 1`,
    })
    .where(eq(storeMarketplaceChannels.storeId, params.storeId));

  return getMarketplaceChannelState({ storeId: params.storeId });
}

export async function getMarketplaceChannelState(params: {
  storeId: string;
}): Promise<MarketplaceChannelState> {
  const channel = await db.query.storeMarketplaceChannels.findFirst({
    where: eq(storeMarketplaceChannels.storeId, params.storeId),
  });
  const [checklist, mappingRows] = await Promise.all([
    evaluateMarketplaceChecklist({
      storeId: params.storeId,
      termsAcceptedAt: channel?.termsAcceptedAt ?? null,
    }),
    db
      .select({
        categoryId: storeMarketplaceCategoryMappings.categoryId,
        marketplaceCategorySlug: storeMarketplaceCategoryMappings.marketplaceCategorySlug,
      })
      .from(storeMarketplaceCategoryMappings)
      .where(eq(storeMarketplaceCategoryMappings.storeId, params.storeId))
      .orderBy(storeMarketplaceCategoryMappings.categoryId),
  ]);

  return {
    channel: channel
      ? {
          enabledByOwner: channel.enabledByOwner,
          status: channel.status,
          publishedAt: channel.publishedAt?.toISOString() ?? null,
          disabledAt: channel.disabledAt?.toISOString() ?? null,
          termsAcceptedAt: channel.termsAcceptedAt?.toISOString() ?? null,
          claimedBusinessId: channel.claimedBusinessId,
          claimConfirmedAt: channel.claimConfirmedAt?.toISOString() ?? null,
          statusReason: channel.statusReason,
          updatedAt: channel.updatedAt.toISOString(),
          version: channel.version,
        }
      : null,
    checklist,
    categoryMappings: mappingRows,
  };
}
