import { eq } from "drizzle-orm";

import type { NewStorePort, NewStoreTerms } from "@louez/api/platform/ports";
import { subscriptions, type Transaction } from "@louez/db";

import { getDefaultAiCredits } from "@/lib/ai/advisor/credits";
import { isBillingEnabled } from "@/lib/billing/mode";
import {
  type EffectivePolicy,
  getStorePolicyThrough,
  getUncreatedStorePolicy,
  legacyBillingApplies,
} from "@/lib/billing/policy";
import { isStandaloneMode } from "@/lib/deployment";
import { resolvePayAsYouGoConfig } from "@/lib/pay-as-you-go/config";
import { getNewStorePricing } from "@/lib/pay-as-you-go/defaults";
import { insertNewStoreSubscription } from "@/lib/pay-as-you-go/new-store-subscription";
import { raiseFreeReservations } from "@/lib/pay-as-you-go/pricing-lock";
import { areAiCreditsEnabled } from "@/lib/plans";
import { getReferralProgramConfig } from "@/lib/referral/defaults";
import { referralCookieDomain, referralCookieSecure } from "@/lib/referral/link";
import { ACTIVE_STORE_COOKIE, activeStoreCookieOptions } from "@/lib/active-store-cookie";
import { isKnownSignupOrigin, SIGNUP_ORIGIN_COOKIE } from "@/lib/utils/signup-origin";

/** The referral code the proxy captured from `?ref=` (proxy.ts). */
const REFERRAL_COOKIE = "louez_referral";

function cookieValue(headers: Headers, name: string): string | null {
  for (const part of (headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key !== name) continue;
    try {
      return decodeURIComponent(rest.join("="));
    } catch {
      return null;
    }
  }
  return null;
}

/** Louez's pay-as-you-go terms, from a resolved config and the free reservations granted. */
function payAsYouGoTerms(
  config: ReturnType<typeof resolvePayAsYouGoConfig>,
  freeReservations: number,
  currency: string,
): NewStoreTerms {
  return {
    billing: "pay_as_you_go",
    freeReservations,
    tiers:
      config.flatRateCents !== null
        ? [{ upToCount: null, priceMinor: config.flatRateCents }]
        : config.tiers.map((tier) => ({ upToCount: tier.upToCount, priceMinor: tier.priceCents })),
    currency,
  };
}

/** The offer the billing service sets, whose label (in English) is the figure. */
const offerTerms = (policy: EffectivePolicy): NewStoreTerms => ({
  billing: "offer",
  offer: policy.policy?.labels.offer.en ?? null,
});

/**
 * What a store created now would pay, before it exists, as the onboarding's pricing
 * reads it: no fee without platform billing; Louez's pay-as-you-go pricing while its
 * own billing would bill the store; otherwise the offer of the billing service.
 */
async function previewTerms(input: {
  currency: string;
  referred: boolean;
}): Promise<NewStoreTerms> {
  if (!isBillingEnabled()) return { billing: "none" };
  const policy = await getUncreatedStorePolicy(new Date());
  if (!policy.legacyBillingApplies) return offerTerms(policy);
  const pricing = getNewStorePricing(input.currency);
  return payAsYouGoTerms(
    resolvePayAsYouGoConfig(pricing.payAsYouGoConfig),
    // As insertNewStoreSubscription writes it on the row.
    input.referred
      ? getReferralProgramConfig().referredRewardFreeReservations
      : pricing.freeReservationsGranted,
    input.currency,
  );
}

/**
 * In the transaction that just inserted the store: one decision, through `tx`, of
 * whether Louez bills it (insertNewStoreSubscription writes its row then), and the
 * terms of that decision, read from the row it wrote.
 */
const subscribe: NewStorePort["subscribe"] = async (tx, input) => {
  if (!isBillingEnabled()) return { billing: "none" };
  const at = new Date();
  if (!(await insertNewStoreSubscription(tx, { ...input, at }))) {
    return offerTerms(await getStorePolicyThrough(tx, input.storeId, at));
  }
  const [row] = await tx
    .select({
      payAsYouGoConfig: subscriptions.payAsYouGoConfig,
      freeReservationsGranted: subscriptions.freeReservationsGranted,
    })
    .from(subscriptions)
    .where(eq(subscriptions.storeId, input.storeId))
    .limit(1);
  if (!row) throw new Error("The new store's subscription row was not written.");
  return payAsYouGoTerms(
    resolvePayAsYouGoConfig(row.payAsYouGoConfig),
    row.freeReservationsGranted,
    input.currency,
  );
};

/**
 * The referred reward of a store that existed before its onboarding's store
 * step attributed it: more free reservations at the pricing it already pays,
 * only while Louez's own billing bills it (none when the billing service
 * does).
 */
async function rewardReferredStore(tx: Transaction, storeId: string): Promise<boolean> {
  if (!(await legacyBillingApplies(storeId, new Date()))) return false;
  await raiseFreeReservations(
    tx,
    storeId,
    getReferralProgramConfig().referredRewardFreeReservations,
  );
  return true;
}

interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  maxAge: number;
  path: string;
  domain?: string;
}

/** One `Set-Cookie` value. Names and values here are ids and fixed names: nothing to encode. */
function setCookie(name: string, value: string, options: CookieOptions): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAge}`,
    ...(options.domain ? [`Domain=${options.domain}`] : []),
    "SameSite=Lax",
    ...(options.httpOnly ? ["HttpOnly"] : []),
    ...(options.secure ? ["Secure"] : []),
  ].join("; ");
}

/**
 * The onboarding's store step's cookies: the store it saved or created
 * becomes the active one (as `setActiveStoreId` sets it), and the referral
 * cookie is cleared, host-only and on the app's domain where the proxy set
 * it, so it attributes no later store.
 */
function onboardingCookies(input: { activeStoreId: string; spendReferral: boolean }): string[] {
  const cookies = [setCookie(ACTIVE_STORE_COOKIE, input.activeStoreId, activeStoreCookieOptions)];
  if (!input.spendReferral) return cookies;
  const cleared = {
    httpOnly: true,
    secure: referralCookieSecure(),
    sameSite: "lax" as const,
    maxAge: 0,
    path: "/",
  };
  const domain = referralCookieDomain();
  return [
    ...cookies,
    setCookie(REFERRAL_COOKIE, "", cleared),
    ...(domain ? [setCookie(REFERRAL_COOKIE, "", { ...cleared, domain })] : []),
  ];
}

/** `ApiPorts.newStores`: the app's side of creating a store (packages/api services/store-creation.ts). */
export const newStorePort: NewStorePort = {
  singleStore: isStandaloneMode,
  previewTerms,
  subscribe,
  welcomeCredits: () => (areAiCreditsEnabled() ? getDefaultAiCredits() : 0),
  signupAttribution: (headers) => {
    const referralCode = cookieValue(headers, REFERRAL_COOKIE);
    const signupOrigin = cookieValue(headers, SIGNUP_ORIGIN_COOKIE);
    return {
      referralCode: referralCode || null,
      signupOrigin: isKnownSignupOrigin(signupOrigin) ? signupOrigin : null,
    };
  },
  rewardReferredStore,
  onboardingCookies,
};
