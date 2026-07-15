import { eq } from "drizzle-orm";

import { db, stores } from "@louez/db";
import { type BrandingInput, type StripeSetupInput, isOwnedImageUrl } from "@louez/validations";

import { ApiServiceError } from "./errors";

interface UpdateOnboardingBrandingParams {
  storeId: string;
  input: BrandingInput;
}

interface CompleteOnboardingParams {
  storeId: string;
  input: StripeSetupInput;
  notifyStoreCreated?: (store: {
    id: string;
    name: string;
    slug: string;
    userId: string;
    reservationMode: StripeSetupInput["reservationMode"];
  }) => Promise<void>;
}

interface GetOnboardingDraftParams {
  storeId: string;
}

export async function updateOnboardingBranding(params: UpdateOnboardingBrandingParams) {
  const { storeId, input } = params;

  if (input.logoUrl && !isOwnedImageUrl(input.logoUrl, `${storeId}/logo`)) {
    throw new ApiServiceError("BAD_REQUEST", "errors.invalidData");
  }

  await db
    .update(stores)
    .set({
      logoUrl: input.logoUrl || null,
      theme: {
        mode: input.theme,
        primaryColor: input.primaryColor,
      },
      updatedAt: new Date(),
    })
    .where(eq(stores.id, storeId));

  return { success: true as const };
}

export async function completeOnboarding(params: CompleteOnboardingParams) {
  const { storeId, input, notifyStoreCreated } = params;

  const store = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
  });

  if (!store) {
    throw new ApiServiceError("NOT_FOUND", "errors.storeNotFound");
  }

  const currentSettings = store.settings || {
    minRentalMinutes: 60,
    maxRentalMinutes: null,
    advanceNoticeMinutes: 1440,
    turnoverBufferMinutes: 0,
    openingHours: null,
  };

  await db
    .update(stores)
    .set({
      settings: {
        ...currentSettings,
        reservationMode: input.reservationMode,
      },
      onboardingCompleted: true,
      updatedAt: new Date(),
    })
    .where(eq(stores.id, storeId));

  if (notifyStoreCreated) {
    notifyStoreCreated({
      id: storeId,
      name: store.name,
      slug: store.slug,
      userId: store.userId,
      reservationMode: input.reservationMode,
    }).catch(() => {});
  }

  return { success: true as const };
}

export async function getOnboardingDraft(params: GetOnboardingDraftParams) {
  const { storeId } = params;

  const store = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
  });

  if (!store) {
    throw new ApiServiceError("NOT_FOUND", "errors.storeNotFound");
  }

  const settings = store.settings;
  const country = settings?.country ?? null;
  const currency = settings?.currency ?? null;

  const latitude =
    store.latitude !== null && store.latitude !== undefined ? Number(store.latitude) : null;
  const longitude =
    store.longitude !== null && store.longitude !== undefined ? Number(store.longitude) : null;

  const theme = store.theme;
  const primaryColor = theme?.primaryColor ?? "#0066FF";
  const mode = theme?.mode === "dark" ? "dark" : "light";

  return {
    store: {
      name: store.name,
      slug: store.slug,
      country,
      currency,
      address: store.address ?? "",
      latitude: Number.isFinite(latitude) ? latitude : null,
      longitude: Number.isFinite(longitude) ? longitude : null,
      email: store.email ?? "",
      phone: store.phone ?? "",
    },
    branding: {
      logoUrl: store.logoUrl ?? "",
      primaryColor,
      theme: mode as "light" | "dark",
    },
  };
}
