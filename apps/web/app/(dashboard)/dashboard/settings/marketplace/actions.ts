"use server";

import {
  ApiServiceError,
  confirmDirectoryClaim as confirmDirectoryClaimService,
  disableMarketplaceChannel as disableMarketplaceChannelService,
  dismissDirectoryClaim as dismissDirectoryClaimService,
  enableMarketplaceChannel as enableMarketplaceChannelService,
  getMarketplaceChannelState as getMarketplaceChannelStateService,
  saveCategoryMappings as saveCategoryMappingsService,
} from "@louez/api/services";
import {
  directoryClaimSchema,
  dismissDirectoryClaimSchema,
  marketplaceCategoryMappingsSchema,
  marketplaceChannelEnableSchema,
} from "@louez/validations";
import { revalidatePath } from "next/cache";

import { env } from "@/env";
import { auth } from "@/lib/auth";
import { fetchMarketplaceMatches, inferMarketplaceMatchCity } from "@/lib/marketplace-match";
import { getCurrentStore } from "@/lib/store-context";

async function getOwnerContext() {
  const [store, session] = await Promise.all([getCurrentStore(), auth()]);
  if (!store || !session?.user?.id || (store.role !== "owner" && store.role !== "platform_admin")) {
    return null;
  }

  return { store, storeId: store.id, userId: session.user.id };
}

function revalidateMarketplaceSettings() {
  revalidatePath("/dashboard/settings/marketplace");
  revalidatePath("/dashboard/settings");
}

function serviceError(error: unknown) {
  if (error instanceof ApiServiceError) {
    return { error: error.key };
  }
  throw error;
}

export async function enableMarketplaceChannel(input: unknown) {
  const context = await getOwnerContext();
  if (!context) return { error: "errors.unauthorized" };

  const parsed = marketplaceChannelEnableSchema.safeParse(input);
  if (!parsed.success) return { error: "errors.invalidData" };

  try {
    const state = await enableMarketplaceChannelService({
      source: "owner",
      storeId: context.storeId,
      connectedByUserId: context.userId,
      input: parsed.data,
      launchCohortSize: env.REEENT_LAUNCH_COHORT_SIZE,
    });
    revalidateMarketplaceSettings();
    return { success: true, state };
  } catch (error) {
    return serviceError(error);
  }
}

export async function disableMarketplaceChannel() {
  const context = await getOwnerContext();
  if (!context) return { error: "errors.unauthorized" };

  try {
    const state = await disableMarketplaceChannelService({
      storeId: context.storeId,
    });
    revalidateMarketplaceSettings();
    return { success: true, state };
  } catch (error) {
    return serviceError(error);
  }
}

export async function saveCategoryMappings(input: unknown) {
  const context = await getOwnerContext();
  if (!context) return { error: "errors.unauthorized" };

  const parsed = marketplaceCategoryMappingsSchema.safeParse(input);
  if (!parsed.success) return { error: "errors.invalidData" };

  try {
    const state = await saveCategoryMappingsService({
      storeId: context.storeId,
      mappings: parsed.data,
    });
    revalidateMarketplaceSettings();
    return { success: true, state };
  } catch (error) {
    return serviceError(error);
  }
}

export async function confirmDirectoryClaim(input: unknown) {
  const context = await getOwnerContext();
  if (!context) return { error: "errors.unauthorized" };

  const parsed = directoryClaimSchema.safeParse(input);
  if (!parsed.success) return { error: "errors.invalidData" };

  const candidates = await fetchMarketplaceMatches({
    name: context.store.name,
    latitude: context.store.latitude,
    longitude: context.store.longitude,
    city: inferMarketplaceMatchCity(context.store.address),
  });
  if (!candidates?.some((candidate) => candidate.businessId === parsed.data.businessId)) {
    return { error: "errors.invalidData" };
  }

  try {
    const state = await confirmDirectoryClaimService({
      storeId: context.storeId,
      businessId: parsed.data.businessId,
    });
    revalidateMarketplaceSettings();
    return { success: true, state };
  } catch (error) {
    return serviceError(error);
  }
}

export async function dismissDirectoryClaim(input: unknown = {}) {
  const context = await getOwnerContext();
  if (!context) return { error: "errors.unauthorized" };

  const parsed = dismissDirectoryClaimSchema.safeParse(input);
  if (!parsed.success) return { error: "errors.invalidData" };

  try {
    const state = await dismissDirectoryClaimService({
      storeId: context.storeId,
    });
    revalidateMarketplaceSettings();
    return { success: true, state };
  } catch (error) {
    return serviceError(error);
  }
}

export async function getMarketplaceChannelState() {
  const context = await getOwnerContext();
  if (!context) return { error: "errors.unauthorized" };

  try {
    return {
      success: true,
      state: await getMarketplaceChannelStateService({
        storeId: context.storeId,
      }),
    };
  } catch (error) {
    return serviceError(error);
  }
}
