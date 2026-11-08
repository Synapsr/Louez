import { eq } from "drizzle-orm";

import { db, markStore, mergeStoreRow, stores } from "@louez/db";
import type { StripeSetupInput } from "@louez/validations";

import { ApiServiceError } from "./errors";

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

export async function completeOnboarding(params: CompleteOnboardingParams) {
  const { storeId, input, notifyStoreCreated } = params;

  const store = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
  });

  if (!store) {
    throw new ApiServiceError("NOT_FOUND", "errors.storeNotFound");
  }

  // The settings are read under the store's lock: another section saved
  // meanwhile (taxes, hours) is kept.
  await mergeStoreRow(db, storeId, async ({ settings }, tx) => {
    // onboardingCompleted is in the store's billing snapshot.
    await markStore(tx, storeId);
    return {
      set: {
        settings: {
          minRentalMinutes: 60,
          maxRentalMinutes: null,
          advanceNoticeMinutes: 1440,
          turnoverBufferMinutes: 0,
          ...settings,
          reservationMode: input.reservationMode,
        },
        onboardingCompleted: true,
      },
    };
  });

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
    stripe: {
      // A Connect account exists but the KYC isn't finished — lets the UI say
      // "resume the setup" instead of "start it".
      hasPendingAccount: Boolean(store.stripeAccountId && !store.stripeChargesEnabled),
    },
  };
}
