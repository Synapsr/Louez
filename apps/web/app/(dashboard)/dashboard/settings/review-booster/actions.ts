"use server";

import { revalidatePath } from "next/cache";

import { db, mergeStoreRow } from "@louez/db";
import { getCurrentStore, hasPermission } from "@/lib/store-context";
import { getStorePlan } from "@/lib/plan-limits";
import { searchPlaces, getPlaceDetails } from "@/lib/google-places";
import {
  reviewBoosterSettingsSchema,
  googlePlaceSearchSchema,
  type ReviewBoosterSettingsInput,
} from "@louez/validations";

export async function updateReviewBoosterSettings(data: ReviewBoosterSettingsInput) {
  const store = await getCurrentStore();
  if (!store) {
    return { error: "errors.unauthorized" };
  }

  if (!hasPermission(store.role, "manage_settings")) {
    return { error: "errors.permissionDenied" };
  }

  // Check plan access
  const plan = await getStorePlan(store.id);
  if (!plan.features.reviewBooster) {
    return { error: "errors.featureNotAvailable" };
  }

  const validated = reviewBoosterSettingsSchema.safeParse(data);
  if (!validated.success) {
    return { error: "errors.invalidData" };
  }

  // Merged into what is stored now, under the store's lock: the message
  // template, saved apart, is kept.
  await mergeStoreRow(db, store.id, ({ reviewBoosterSettings }) => ({
    set: { reviewBoosterSettings: { ...reviewBoosterSettings, ...validated.data } },
  }));

  revalidatePath("/dashboard/settings/review-booster");
  revalidatePath(`/${store.slug}`); // Revalidate storefront
  return { success: true };
}

export async function searchGooglePlaces(query: string) {
  const store = await getCurrentStore();
  if (!store) {
    return { error: "errors.unauthorized", results: [] };
  }

  const validated = googlePlaceSearchSchema.safeParse({ query });
  if (!validated.success) {
    return { error: "errors.invalidData", results: [] };
  }

  const results = await searchPlaces(validated.data.query);
  return { results };
}

export async function fetchGooglePlaceDetails(placeId: string) {
  const store = await getCurrentStore();
  if (!store) {
    return { error: "errors.unauthorized", details: null };
  }

  if (!placeId) {
    return { error: "errors.invalidData", details: null };
  }

  const details = await getPlaceDetails(placeId);
  return { details };
}

export async function getReviewBoosterTemplate() {
  const store = await getCurrentStore();
  if (!store) {
    return { error: "errors.unauthorized" };
  }

  const template = store.reviewBoosterSettings?.template || {};
  return { template };
}

export async function updateReviewBoosterTemplate(template: {
  subject?: string;
  emailMessage?: string;
  smsMessage?: string;
}) {
  const store = await getCurrentStore();
  if (!store) {
    return { error: "errors.unauthorized" };
  }

  if (!hasPermission(store.role, "manage_settings")) {
    return { error: "errors.permissionDenied" };
  }

  // Check plan access
  const plan = await getStorePlan(store.id);
  if (!plan.features.reviewBooster) {
    return { error: "errors.featureNotAvailable" };
  }

  // The template, within the settings as stored now, under the store's lock:
  // a settings save meanwhile is kept.
  await mergeStoreRow(db, store.id, ({ reviewBoosterSettings }) => {
    const currentSettings = reviewBoosterSettings || {
      enabled: false,
      googlePlaceId: null,
      googlePlaceName: null,
      googlePlaceAddress: null,
      googleRating: null,
      googleReviewCount: null,
      displayReviewsOnStorefront: false,
      showReviewPromptInPortal: false,
      autoSendThankYouEmail: false,
      autoSendThankYouSms: false,
      emailDelayHours: 24,
      smsDelayHours: 24,
    };
    return { set: { reviewBoosterSettings: { ...currentSettings, template } } };
  });

  revalidatePath("/dashboard/settings/review-booster");
  return { success: true };
}
