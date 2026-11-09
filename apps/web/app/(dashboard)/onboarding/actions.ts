"use server";

import { cookies } from "next/headers";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { storeCreatedBy } from "@louez/api/platform/setup-analytics";
import {
  resolvePendingReferral,
  type PendingReferral,
  type ReferralAttributionOutcome,
} from "@louez/api/services/store-creation";
import { db, markStore, mergeStoreRow, storeMembers, stores } from "@louez/db";
import { getTimezoneForCountry } from "@louez/utils/countries";
import { type StoreInfoInput, storeInfoSchema } from "@louez/validations";
import { defaultBusinessHours } from "@louez/validations";

import { serverApi } from "@/lib/api/server-api";
import { auth } from "@/lib/auth";
import { legacyBillingApplies } from "@/lib/billing/policy";
import { apiErrorKey } from "@/lib/orpc/errors";
import { raiseFreeReservations } from "@/lib/pay-as-you-go/pricing-lock";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { captureProductServerEvent } from "@/lib/product-analytics/analytics";
import { productAnalyticsEvents } from "@/lib/product-analytics/analytics-events";
import { captureReferralServerEvent } from "@/lib/referral/analytics";
import { referralAnalyticsEvents } from "@/lib/referral/analytics-events";
import { getReferralProgramConfig } from "@/lib/referral/defaults";
import { referralCookieDomain, referralCookieSecure } from "@/lib/referral/link";
import { getActiveStoreId, setActiveStoreId, verifyStoreAccess } from "@/lib/store-context";

import { sendAfterResponse } from "./_lib/send-after-response";

const REFERRAL_COOKIE = "louez_referral";

const editingStoreIdSchema = z.string().length(21).nullable();

async function consumeReferralCookie(referralCookie: string | null) {
  if (!referralCookie) return;

  const cookieStore = await cookies();
  const cookieDomain = referralCookieDomain();
  const secure = referralCookieSecure();
  const clearOptions = {
    path: "/",
    maxAge: 0,
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
  };

  cookieStore.set(REFERRAL_COOKIE, "", clearOptions);
  if (!cookieDomain) return;

  cookieStore.set(REFERRAL_COOKIE, "", {
    ...clearOptions,
    domain: cookieDomain,
  });
}

async function grantReferredStoreWelcomeReward(storeId: string) {
  const referredReward = getReferralProgramConfig().referredRewardFreeReservations;

  // The store already exists (onboarding was left incomplete), so it keeps the pricing it
  // already pays: the reward only raises its free-reservation allowance.
  await raiseFreeReservations(db, storeId, referredReward);
}

/**
 * The referral events of a store the step saves again. A new store's go to the
 * outbox with it (packages/api services/store-creation.ts).
 */
async function trackReferralAttributionResolved({
  userId,
  storeId,
  pendingReferral,
  currency,
  country,
}: {
  userId: string;
  storeId: string;
  pendingReferral: PendingReferral;
  currency: string;
  country: string;
}) {
  const programConfig = getReferralProgramConfig();

  await captureReferralServerEvent({
    distinctId: userId,
    event: referralAnalyticsEvents.attributionResolved,
    properties: {
      placement: "onboarding_store_create",
      referral_attribution_outcome: pendingReferral.outcome,
      has_referral_cookie: Boolean(pendingReferral.referralCode),
      is_existing_incomplete_store: true,
      referred_store_id: storeId,
      referrer_store_id: pendingReferral.attribution?.referredByStoreId ?? null,
      referred_reward_free_reservations: programConfig.referredRewardFreeReservations,
      referrer_reward_free_reservations: programConfig.referrerRewardFreeReservations,
      min_qualifying_amount_cents: programConfig.minQualifyingAmountCents,
      monthly_cap_per_referrer: programConfig.monthlyCapPerReferrer,
      clawback_window_days: programConfig.clawbackWindowDays,
      currency,
      country,
    },
  });
}

async function trackReferredRewardGranted({
  userId,
  storeId,
  referrerStoreId,
  currency,
}: {
  userId: string;
  storeId: string;
  referrerStoreId: string;
  currency: string;
}) {
  await captureReferralServerEvent({
    distinctId: userId,
    event: referralAnalyticsEvents.referredRewardGranted,
    properties: {
      placement: "onboarding_store_create",
      referred_store_id: storeId,
      referrer_store_id: referrerStoreId,
      referred_reward_free_reservations: getReferralProgramConfig().referredRewardFreeReservations,
      currency,
    },
  });
}

/**
 * The onboarding's store step: saves the store being onboarded (an incomplete
 * store of the user, or the one being edited), or creates the user's store
 * through `stores.create`, the procedure agents call too.
 */
export async function saveStoreInfo(data: StoreInfoInput, editingStoreId: string | null = null) {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "errors.unauthenticated" };
  }

  const validated = storeInfoSchema.safeParse(data);
  if (!validated.success) {
    return { error: "errors.invalidData" };
  }

  const validatedEditingStoreId = editingStoreIdSchema.safeParse(editingStoreId);
  if (!validatedEditingStoreId.success) {
    return { error: "errors.invalidData" };
  }

  // Check if we're updating an existing incomplete store or creating a new one
  const activeStoreId = await getActiveStoreId();
  let storeToUpdate = null;

  if (validatedEditingStoreId.data) {
    const role = await verifyStoreAccess(validatedEditingStoreId.data);

    if (!role || (role !== "owner" && !isPlatformAdmin(session.user.email))) {
      return { error: "errors.unauthorized" };
    }

    storeToUpdate = await db.query.stores.findFirst({
      where: eq(stores.id, validatedEditingStoreId.data),
    });

    if (!storeToUpdate) {
      return { error: "errors.invalidData" };
    }
  } else if (activeStoreId) {
    // Check if user has access to this store and it's not completed
    const membership = await db.query.storeMembers.findFirst({
      where: and(
        eq(storeMembers.storeId, activeStoreId),
        eq(storeMembers.userId, session.user.id),
        eq(storeMembers.role, "owner"),
      ),
    });

    if (membership) {
      const store = await db.query.stores.findFirst({
        where: eq(stores.id, activeStoreId),
      });
      if (store && !store.onboardingCompleted) {
        storeToUpdate = store;
      }
    }
  }

  // Fallback: if active-store cookie is missing, reuse any incomplete store owned by the user
  if (!storeToUpdate) {
    const incompleteOwnedStores = await db.query.stores.findMany({
      where: and(eq(stores.userId, session.user.id), eq(stores.onboardingCompleted, false)),
      orderBy: (storeFields, { desc }) => [desc(storeFields.updatedAt)],
    });

    if (incompleteOwnedStores.length > 0) {
      const slugMatchedStore = incompleteOwnedStores.find(
        (store) => store.slug === validated.data.slug,
      );
      storeToUpdate = slugMatchedStore ?? incompleteOwnedStores[0];
    }
  }

  // Slug conflict check: allow keeping/editing the explicitly targeted store slug.
  const existingStore = await db.query.stores.findFirst({
    where: eq(stores.slug, validated.data.slug),
  });
  if (existingStore) {
    const canReuseExistingStore =
      existingStore.userId === session.user.id && existingStore.onboardingCompleted === false;

    if (!storeToUpdate && canReuseExistingStore) {
      storeToUpdate = existingStore;
    }

    if (!storeToUpdate || existingStore.id !== storeToUpdate.id) {
      return { error: "errors.slugTaken" };
    }
  }

  const referralCookie = (await cookies()).get(REFERRAL_COOKIE)?.value ?? null;

  if (!storeToUpdate) {
    // A new store: the procedure reads the referral and sign-up cookies of
    // this request itself.
    let createdId: string;
    try {
      const api = await serverApi();
      ({ id: createdId } = await api.stores.create(validated.data));
    } catch (error) {
      const key = apiErrorKey(error);
      return { error: key ? `errors.${key}` : "errors.generic" };
    }
    // Consume the referral cookie once, clearing it with the SAME domain it was set
    // with — a bare delete() emits a host-only expiry that does not match the .louez.io
    // cookie, so it would otherwise linger and re-attribute later signups.
    await consumeReferralCookie(referralCookie);
    const setStoreResult = await setActiveStoreId(createdId);
    if (!setStoreResult.success) {
      // This should not happen since the store and its owner were just created
      console.error("[SECURITY] Failed to set active store after creation:", setStoreResult.error);
    }
    return { success: true };
  }

  const isExistingIncompleteStore = storeToUpdate.onboardingCompleted !== true;
  const pendingReferral: PendingReferral =
    !isExistingIncompleteStore || storeToUpdate.referredByStoreId
      ? { referralCode: null, attribution: null, outcome: "already_attributed" }
      : await resolvePendingReferral({
          userId: session.user.id,
          referralCode: referralCookie,
          ignoredOwnedStoreId: storeToUpdate.id,
        });

  // Preserve settings that are configured after onboarding when the owner
  // revisits this step, or that an agent set meanwhile: they are read under
  // the store's lock.
  await mergeStoreRow(db, storeToUpdate.id, async ({ settings: existingSettings }, tx) => {
    const existingBusinessHours =
      existingSettings?.businessHours?.enabled !== undefined
        ? existingSettings.businessHours
        : defaultBusinessHours;
    // The slug, settings and referral columns are in the store's billing snapshot.
    await markStore(tx, storeToUpdate.id);
    return {
      set: {
        name: validated.data.name,
        slug: validated.data.slug,
        address: validated.data.address || null,
        latitude: validated.data.latitude?.toString() || null,
        longitude: validated.data.longitude?.toString() || null,
        email: validated.data.email || null,
        phone: validated.data.phone || null,
        referredByUserId:
          pendingReferral.attribution?.referredByUserId ?? storeToUpdate.referredByUserId,
        referredByStoreId:
          pendingReferral.attribution?.referredByStoreId ?? storeToUpdate.referredByStoreId,
        settings: {
          ...existingSettings,
          reservationMode: existingSettings?.reservationMode ?? "payment",
          minRentalMinutes: existingSettings?.minRentalMinutes ?? 60,
          maxRentalMinutes: existingSettings?.maxRentalMinutes ?? null,
          advanceNoticeMinutes: existingSettings?.advanceNoticeMinutes ?? 1440,
          turnoverBufferMinutes: existingSettings?.turnoverBufferMinutes ?? 0,
          businessHours: existingBusinessHours,
          country: validated.data.country,
          timezone: getTimezoneForCountry(validated.data.country),
          currency: validated.data.currency,
        },
      },
    };
  });

  const storeId = storeToUpdate.id;
  const referralOutcome: ReferralAttributionOutcome | null = isExistingIncompleteStore
    ? pendingReferral.outcome
    : null;
  if (isExistingIncompleteStore) {
    // The Referred Reward is a legacy billing credit: none without platform billing,
    // and none for a store the billing service bills (README §8.3).
    if (pendingReferral.attribution && (await legacyBillingApplies(storeId, new Date()))) {
      await grantReferredStoreWelcomeReward(storeId);
      const { referredByStoreId } = pendingReferral.attribution;
      sendAfterResponse(() =>
        trackReferredRewardGranted({
          userId: session.user.id,
          storeId,
          referrerStoreId: referredByStoreId,
          currency: validated.data.currency,
        }),
      );
    }
    await consumeReferralCookie(pendingReferral.referralCode);

    sendAfterResponse(() =>
      trackReferralAttributionResolved({
        userId: session.user.id,
        storeId,
        pendingReferral,
        currency: validated.data.currency,
        country: validated.data.country,
      }),
    );
  }

  // Ensure the updated store stays active for subsequent onboarding steps
  const setStoreResult = await setActiveStoreId(storeId);
  if (!setStoreResult.success) {
    console.error(
      "[SECURITY] Failed to set active store after onboarding update:",
      setStoreResult.error,
    );
  }

  sendAfterResponse(async () =>
    captureProductServerEvent({
      distinctId: session.user.id,
      event: productAnalyticsEvents.onboardingStoreInfoSaved,
      properties: {
        feature: "onboarding",
        surface: "dashboard",
        store_id: storeId,
        // A human finishing the store, which an agent may have created.
        credential_kind: "session",
        store_created_by: await storeCreatedBy(storeId).catch(() => null),
        is_existing_incomplete_store: isExistingIncompleteStore,
        referral_outcome: referralOutcome,
        country: validated.data.country,
        currency: validated.data.currency,
        has_address: Boolean(validated.data.address),
        has_coordinates: Boolean(
          validated.data.latitude != null && validated.data.longitude != null,
        ),
        has_email: Boolean(validated.data.email),
        has_phone: Boolean(validated.data.phone),
      },
    }),
  );

  return { success: true };
}
