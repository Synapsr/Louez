"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@louez/db";
import { storeMembers, stores, subscriptions } from "@louez/db";
import { type StoreInfoInput, storeInfoSchema } from "@louez/validations";
import { defaultBusinessHours } from "@louez/validations";

import { auth } from "@/lib/auth";
import { creditAiCredits, getDefaultAiCredits } from "@/lib/ai/advisor/credits";
import {
  getDefaultFreeReservations,
  getDefaultPayAsYouGoConfigSnapshot,
} from "@/lib/pay-as-you-go/defaults";
import { areAiCreditsEnabled } from "@/lib/plans";
import { captureProductServerEvent } from "@/lib/product-analytics/analytics";
import { productAnalyticsEvents } from "@/lib/product-analytics/analytics-events";
import { captureReferralServerEvent } from "@/lib/referral/analytics";
import { referralAnalyticsEvents } from "@/lib/referral/analytics-events";
import { type ReferralAttribution, resolveReferralAttribution } from "@/lib/referral/attribution";
import { getReferralProgramConfig } from "@/lib/referral/defaults";
import { referralCookieDomain, referralCookieSecure } from "@/lib/referral/link";
import { getActiveStoreId, setActiveStoreId } from "@/lib/store-context";
import { getTimezoneForCountry } from "@/lib/utils/countries";
import { generateReferralCode, isValidReferralCode } from "@/lib/utils/referral";

type ReferralAttributionOutcome =
  | "no_cookie"
  | "invalid_code"
  | "existing_owner"
  | "unknown_referrer"
  | "self_referral"
  | "already_attributed"
  | "attributed";

interface PendingReferralAttribution {
  referralCookie: string | null;
  attribution: ReferralAttribution | null;
  outcome: ReferralAttributionOutcome;
}

const editingStoreIdSchema = z.string().length(21).nullable();

async function resolvePendingReferralAttribution({
  currentUserId,
  ignoredOwnedStoreId,
}: {
  currentUserId: string;
  ignoredOwnedStoreId?: string;
}): Promise<PendingReferralAttribution> {
  const cookieStore = await cookies();
  const referralCookie = cookieStore.get("louez_referral")?.value ?? null;

  if (!referralCookie) {
    return { referralCookie, attribution: null, outcome: "no_cookie" };
  }

  if (!isValidReferralCode(referralCookie)) {
    return { referralCookie, attribution: null, outcome: "invalid_code" };
  }

  const ownsAStore = await db.query.storeMembers.findFirst({
    where: ignoredOwnedStoreId
      ? and(
          eq(storeMembers.userId, currentUserId),
          eq(storeMembers.role, "owner"),
          ne(storeMembers.storeId, ignoredOwnedStoreId),
        )
      : and(eq(storeMembers.userId, currentUserId), eq(storeMembers.role, "owner")),
    columns: { id: true },
  });
  if (ownsAStore) {
    return { referralCookie, attribution: null, outcome: "existing_owner" };
  }

  const referrerStore = await db.query.stores.findFirst({
    where: eq(stores.referralCode, referralCookie),
    columns: { id: true, userId: true },
  });

  if (!referrerStore) {
    return { referralCookie, attribution: null, outcome: "unknown_referrer" };
  }

  const attribution = resolveReferralAttribution({
    refCode: referralCookie,
    referrerStore,
    currentUserId,
  });

  if (!attribution) {
    return { referralCookie, attribution: null, outcome: "self_referral" };
  }

  return {
    referralCookie,
    attribution,
    outcome: "attributed",
  };
}

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

  cookieStore.set("louez_referral", "", clearOptions);
  if (!cookieDomain) return;

  cookieStore.set("louez_referral", "", {
    ...clearOptions,
    domain: cookieDomain,
  });
}

async function grantReferredStoreWelcomeReward({
  storeId,
  currency,
}: {
  storeId: string;
  currency: string;
}) {
  const referredReward = getReferralProgramConfig().referredRewardFreeReservations;

  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.storeId, storeId),
    columns: { id: true },
  });

  if (subscription) {
    await db
      .update(subscriptions)
      .set({
        freeReservationsGranted: sql`GREATEST(${subscriptions.freeReservationsGranted}, ${referredReward})`,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.storeId, storeId));
    return;
  }

  await db.insert(subscriptions).values({
    storeId,
    planSlug: "pay_as_you_go",
    billingMode: "pay_as_you_go",
    payAsYouGoConfig: getDefaultPayAsYouGoConfigSnapshot(currency),
    freeReservationsGranted: referredReward,
  });
}

async function trackReferralAttributionResolved({
  userId,
  storeId,
  pendingReferral,
  isExistingIncompleteStore,
  currency,
  country,
}: {
  userId: string;
  storeId: string;
  pendingReferral: PendingReferralAttribution;
  isExistingIncompleteStore: boolean;
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
      has_referral_cookie: Boolean(pendingReferral.referralCookie),
      is_existing_incomplete_store: isExistingIncompleteStore,
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

export async function createStore(data: StoreInfoInput, editingStoreId: string | null = null) {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "errors.unauthorized" };
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
  let analyticsStoreId: string | null = null;
  let analyticsIsExistingIncompleteStore = false;
  let analyticsReferralOutcome: ReferralAttributionOutcome | null = null;

  if (validatedEditingStoreId.data) {
    const membership = await db.query.storeMembers.findFirst({
      where: and(
        eq(storeMembers.storeId, validatedEditingStoreId.data),
        eq(storeMembers.userId, session.user.id),
        eq(storeMembers.role, "owner"),
      ),
      columns: { id: true },
    });

    if (!membership) {
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

  if (storeToUpdate) {
    const isExistingIncompleteStore = storeToUpdate.onboardingCompleted !== true;
    const pendingReferral =
      !isExistingIncompleteStore || storeToUpdate.referredByStoreId
        ? ({
            referralCookie: null,
            attribution: null,
            outcome: "already_attributed",
          } satisfies PendingReferralAttribution)
        : await resolvePendingReferralAttribution({
            currentUserId: session.user.id,
            ignoredOwnedStoreId: storeToUpdate.id,
          });

    // Preserve settings that are configured after onboarding when the owner revisits this step.
    const existingSettings = storeToUpdate.settings;
    const existingBusinessHours =
      existingSettings?.businessHours?.enabled !== undefined
        ? existingSettings.businessHours
        : defaultBusinessHours;
    await db
      .update(stores)
      .set({
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
        updatedAt: new Date(),
      })
      .where(eq(stores.id, storeToUpdate.id));

    if (isExistingIncompleteStore) {
      if (pendingReferral.attribution) {
        await grantReferredStoreWelcomeReward({
          storeId: storeToUpdate.id,
          currency: validated.data.currency,
        });
        await trackReferredRewardGranted({
          userId: session.user.id,
          storeId: storeToUpdate.id,
          referrerStoreId: pendingReferral.attribution.referredByStoreId,
          currency: validated.data.currency,
        });
      }
      await consumeReferralCookie(pendingReferral.referralCookie);

      await trackReferralAttributionResolved({
        userId: session.user.id,
        storeId: storeToUpdate.id,
        pendingReferral,
        isExistingIncompleteStore: true,
        currency: validated.data.currency,
        country: validated.data.country,
      });
    }

    analyticsStoreId = storeToUpdate.id;
    analyticsIsExistingIncompleteStore = isExistingIncompleteStore;
    analyticsReferralOutcome = isExistingIncompleteStore ? pendingReferral.outcome : null;

    // Ensure the updated store stays active for subsequent onboarding steps
    const setStoreResult = await setActiveStoreId(storeToUpdate.id);
    if (!setStoreResult.success) {
      console.error(
        "[SECURITY] Failed to set active store after onboarding update:",
        setStoreResult.error,
      );
    }
  } else {
    // Resolve referral code from cookie (set during login with ?ref= param)
    const pendingReferral = await resolvePendingReferralAttribution({
      currentUserId: session.user.id,
    });
    const referredByUserId = pendingReferral.attribution?.referredByUserId ?? null;
    const referredByStoreId = pendingReferral.attribution?.referredByStoreId ?? null;

    // Consume the referral cookie exactly once, clearing it with the SAME domain it was set
    // with — a bare delete() emits a host-only expiry that does not match the .louez.io
    // cookie, so it would otherwise linger and re-attribute later signups.
    await consumeReferralCookie(pendingReferral.referralCookie);

    // Generate a unique referral code for this new store
    let newReferralCode = generateReferralCode();
    for (let attempt = 0; attempt < 10; attempt++) {
      const exists = await db.query.stores.findFirst({
        where: eq(stores.referralCode, newReferralCode),
      });
      if (!exists) break;
      newReferralCode = generateReferralCode();
    }

    // Create new store
    const [newStore] = await db
      .insert(stores)
      .values({
        userId: session.user.id,
        name: validated.data.name,
        slug: validated.data.slug,
        address: validated.data.address || null,
        latitude: validated.data.latitude?.toString() || null,
        longitude: validated.data.longitude?.toString() || null,
        email: validated.data.email || null,
        phone: validated.data.phone || null,
        referralCode: newReferralCode,
        referredByUserId,
        referredByStoreId,
        settings: {
          reservationMode: "payment",
          minRentalMinutes: 60,
          maxRentalMinutes: null,
          advanceNoticeMinutes: 1440,
          turnoverBufferMinutes: 0,
          businessHours: defaultBusinessHours,
          country: validated.data.country,
          timezone: getTimezoneForCountry(validated.data.country),
          currency: validated.data.currency,
        },
      })
      .$returningId();

    // Create owner membership
    await db.insert(storeMembers).values({
      storeId: newStore.id,
      userId: session.user.id,
      role: "owner",
    });

    // New stores default to pay-as-you-go billing (the owner can switch to a
    // subscription plan at any time from the subscription page). Snapshot the current
    // default pricing offer (PAYG_DEFAULT_PRICING env, or the platform default ladder)
    // so the store keeps these tariffs for life even if the offer later changes.
    await db.insert(subscriptions).values({
      storeId: newStore.id,
      planSlug: "pay_as_you_go",
      billingMode: "pay_as_you_go",
      payAsYouGoConfig: getDefaultPayAsYouGoConfigSnapshot(validated.data.currency),
      // Welcome gift: free reservations (commission waived) for the new store. A store
      // that signed up through a referral gets the larger Referred Reward instead.
      freeReservationsGranted: referredByStoreId
        ? getReferralProgramConfig().referredRewardFreeReservations
        : getDefaultFreeReservations(),
    });

    // Welcome AI advisor credits (cloud commercial layer). Idempotent per store
    // (dedup key) and inert unless the credit layer is enabled.
    if (areAiCreditsEnabled()) {
      await creditAiCredits({
        storeId: newStore.id,
        credits: getDefaultAiCredits(),
        type: "grant",
        dedupKey: `grant:${newStore.id}`,
      });
    }

    await trackReferralAttributionResolved({
      userId: session.user.id,
      storeId: newStore.id,
      pendingReferral,
      isExistingIncompleteStore: false,
      currency: validated.data.currency,
      country: validated.data.country,
    });

    analyticsStoreId = newStore.id;
    analyticsReferralOutcome = pendingReferral.outcome;

    if (pendingReferral.attribution) {
      await trackReferredRewardGranted({
        userId: session.user.id,
        storeId: newStore.id,
        referrerStoreId: pendingReferral.attribution.referredByStoreId,
        currency: validated.data.currency,
      });
    }

    // Set as active store (will succeed since we just created ownership above)
    const setStoreResult = await setActiveStoreId(newStore.id);
    if (!setStoreResult.success) {
      // This should not happen since we just created the store and membership
      console.error("[SECURITY] Failed to set active store after creation:", setStoreResult.error);
    }
  }

  if (analyticsStoreId) {
    await captureProductServerEvent({
      distinctId: session.user.id,
      event: productAnalyticsEvents.onboardingStoreInfoSaved,
      properties: {
        feature: "onboarding",
        surface: "dashboard",
        store_id: analyticsStoreId,
        is_existing_incomplete_store: analyticsIsExistingIncompleteStore,
        referral_outcome: analyticsReferralOutcome,
        country: validated.data.country,
        currency: validated.data.currency,
        has_address: Boolean(validated.data.address),
        has_coordinates: Boolean(
          validated.data.latitude != null && validated.data.longitude != null,
        ),
        has_email: Boolean(validated.data.email),
        has_phone: Boolean(validated.data.phone),
      },
    });
  }

  revalidatePath("/onboarding");
  return { success: true };
}
