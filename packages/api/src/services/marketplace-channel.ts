import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

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
import {
  DEFAULT_REEENT_LAUNCH_COHORT_SIZE,
  marketplaceCohortStatus,
  nextMarketplaceCohortRank,
  normalizeMarketplaceCohortSize,
  type MarketplaceCohortStatus,
} from "./marketplace-cohort";

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
    ownerDecidedAt: string | null;
    status: "setup_required" | "pending" | "published" | "paused" | "disabled";
    publishedAt: string | null;
    lifetimeFeeWaiverAt: string | null;
    cohortRank: number | null;
    disabledAt: string | null;
    termsAcceptedAt: string | null;
    consentBasis: "explicit" | "terms_update";
    claimedBusinessId: string | null;
    claimConfirmedAt: string | null;
    statusReason: string | null;
    updatedAt: string;
    version: number;
  } | null;
  checklist: MarketplacePublicationChecklist;
  categoryMappings: MarketplaceCategoryMappingsInput;
}

export async function evaluateMarketplaceChecklist(params: {
  storeId: string;
  termsAcceptedAt: Date | null;
  consentBasis: "explicit" | "terms_update";
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
  // Test-only escape hatch: a store without operational Stripe charges cannot
  // take real marketplace bookings, so this must never be enabled in production.
  const skipStripeCheck = process.env.MARKETPLACE_CHECKLIST_SKIP_STRIPE === "true";
  const checklist = {
    addressAndGeolocation,
    activeProductWithImageAndPrice,
    stripeChargesEnabled: skipStripeCheck || store.stripeChargesEnabled === true,
    cgvPresent: Boolean(store.cgv?.trim()),
    marketplaceTermsAccepted:
      params.consentBasis === "terms_update" || params.termsAcceptedAt !== null,
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

type EnableMarketplaceChannelParams = {
  storeId: string;
  launchCohortSize?: number;
} & (
  | {
      source: "owner";
      connectedByUserId: string;
      input: MarketplaceChannelEnableInput;
    }
  | {
      source: "default_publication";
    }
);

export async function enableMarketplaceChannel(
  params: EnableMarketplaceChannelParams,
): Promise<MarketplaceChannelState> {
  const existing = await db.query.storeMarketplaceChannels.findFirst({
    where: eq(storeMarketplaceChannels.storeId, params.storeId),
    columns: { termsAcceptedAt: true, consentBasis: true },
  });
  const now = new Date();
  const ownerInitiated = params.source === "owner";
  const termsAcceptedAt =
    ownerInitiated && params.input.acceptTerms ? now : (existing?.termsAcceptedAt ?? null);
  // `terms_update` records consent carried by the updated CGV after the 14-day
  // customer notice; it must not fabricate an explicit checkbox acceptance date.
  const consentBasis =
    params.source === "default_publication"
      ? "terms_update"
      : params.input.acceptTerms
        ? "explicit"
        : (existing?.consentBasis ?? "explicit");
  const checklist = await evaluateMarketplaceChecklist({
    storeId: params.storeId,
    termsAcceptedAt,
    consentBasis,
  });

  const launchCohortSize = normalizeMarketplaceCohortSize(
    params.launchCohortSize ?? DEFAULT_REEENT_LAUNCH_COHORT_SIZE,
  );

  // A unique cohort-rank constraint arbitrates concurrent publications. If two stores
  // choose the same next rank, the losing transaction is retried against the new count.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let ownerDecisionSkipped = false;
    try {
      await db.transaction(async (tx) => {
        const current = await tx.query.storeMarketplaceChannels.findFirst({
          where: eq(storeMarketplaceChannels.storeId, params.storeId),
          columns: { id: true, ownerDecidedAt: true },
        });
        if (params.source === "default_publication" && current?.ownerDecidedAt) {
          ownerDecisionSkipped = true;
          return;
        }

        const status = checklist.complete ? "pending" : "setup_required";
        const checklistReason = statusReasonFromChecklist(checklist);
        const statusReason =
          checklist.complete && params.source === "default_publication"
            ? "default_publication"
            : checklistReason;
        if (current) {
          const updated = await tx
            .update(storeMarketplaceChannels)
            .set({
              enabledByOwner: true,
              ownerDecidedAt: ownerInitiated ? now : null,
              status,
              disabledAt: null,
              termsAcceptedAt,
              consentBasis,
              statusReason,
              updatedAt: now,
              version: sql`${storeMarketplaceChannels.version} + 1`,
            })
            .where(
              params.source === "default_publication"
                ? and(
                    eq(storeMarketplaceChannels.storeId, params.storeId),
                    isNull(storeMarketplaceChannels.ownerDecidedAt),
                  )
                : eq(storeMarketplaceChannels.storeId, params.storeId),
            );
          if (params.source === "default_publication" && (updated[0]?.affectedRows ?? 0) === 0) {
            ownerDecisionSkipped = true;
            return;
          }
        } else {
          await tx.insert(storeMarketplaceChannels).values({
            storeId: params.storeId,
            enabledByOwner: true,
            ownerDecidedAt: ownerInitiated ? now : null,
            status,
            termsAcceptedAt,
            consentBasis,
            statusReason,
            updatedAt: now,
          });
        }

        await tx
          .insert(storeIntegrations)
          .values({
            storeId: params.storeId,
            providerKey: "marketplace",
            category: "sales-channel",
            enabled: true,
            connectedByUserId: ownerInitiated ? params.connectedByUserId : null,
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

        if (!checklist.complete) return;

        const channel = await tx.query.storeMarketplaceChannels.findFirst({
          where: eq(storeMarketplaceChannels.storeId, params.storeId),
          columns: {
            cohortRank: true,
            lifetimeFeeWaiverAt: true,
            publishedAt: true,
          },
        });
        if (!channel) {
          throw new ApiServiceError("INTERNAL_SERVER_ERROR", "errors.internalServerError");
        }

        let cohortRank = channel.cohortRank;
        let lifetimeFeeWaiverAt = channel.lifetimeFeeWaiverAt;
        const firstPublication = channel.publishedAt === null;
        if (firstPublication && cohortRank === null && lifetimeFeeWaiverAt === null) {
          const [{ taken }] = await tx
            .select({ taken: sql<number>`count(*)` })
            .from(storeMarketplaceChannels)
            .where(sql`${storeMarketplaceChannels.lifetimeFeeWaiverAt} IS NOT NULL`);
          cohortRank = nextMarketplaceCohortRank(Number(taken), launchCohortSize);
          if (cohortRank !== null) lifetimeFeeWaiverAt = now;
        }

        await tx
          .update(storeMarketplaceChannels)
          .set({
            status: "published",
            publishedAt: channel.publishedAt ?? now,
            lifetimeFeeWaiverAt,
            cohortRank,
            statusReason: params.source === "default_publication" ? "default_publication" : null,
            updatedAt: now,
            version: sql`${storeMarketplaceChannels.version} + 1`,
          })
          .where(eq(storeMarketplaceChannels.storeId, params.storeId));
      });
      if (ownerDecisionSkipped) break;
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const duplicateCohortRank =
        message.includes("store_marketplace_channels_cohort_rank_unique") ||
        (message.includes("Duplicate") && message.includes("cohort_rank"));
      const duplicateStoreChannel =
        message.includes("store_marketplace_channels_store_id_unique") ||
        (message.includes("Duplicate") && message.includes("store_id"));
      if ((!duplicateCohortRank && !duplicateStoreChannel) || attempt === 4) throw error;
    }
  }

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
        ownerDecidedAt: now,
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
      consentBasis: channel?.consentBasis ?? "explicit",
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
          ownerDecidedAt: channel.ownerDecidedAt?.toISOString() ?? null,
          status: channel.status,
          publishedAt: channel.publishedAt?.toISOString() ?? null,
          lifetimeFeeWaiverAt: channel.lifetimeFeeWaiverAt?.toISOString() ?? null,
          cohortRank: channel.cohortRank,
          disabledAt: channel.disabledAt?.toISOString() ?? null,
          termsAcceptedAt: channel.termsAcceptedAt?.toISOString() ?? null,
          consentBasis: channel.consentBasis,
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

export interface MarketplaceDefaultPublicationCandidate {
  storeId: string;
  ownerDecidedAt: Date | null;
}

export async function listMarketplaceDefaultPublicationCandidates(): Promise<
  MarketplaceDefaultPublicationCandidate[]
> {
  return db
    .select({
      storeId: stores.id,
      ownerDecidedAt: storeMarketplaceChannels.ownerDecidedAt,
    })
    .from(stores)
    .leftJoin(storeMarketplaceChannels, eq(storeMarketplaceChannels.storeId, stores.id))
    .where(
      and(
        isNull(storeMarketplaceChannels.ownerDecidedAt),
        or(
          isNull(storeMarketplaceChannels.id),
          eq(storeMarketplaceChannels.status, "setup_required"),
        ),
      ),
    )
    .orderBy(stores.createdAt, stores.id);
}

export async function getMarketplaceCohortStatus(
  total: number = DEFAULT_REEENT_LAUNCH_COHORT_SIZE,
): Promise<MarketplaceCohortStatus> {
  const [{ taken }] = await db
    .select({ taken: sql<number>`count(*)` })
    .from(storeMarketplaceChannels)
    .where(sql`${storeMarketplaceChannels.lifetimeFeeWaiverAt} IS NOT NULL`);

  return marketplaceCohortStatus(Number(taken), total);
}
