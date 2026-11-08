import type { NewStorePort, NewStoreTerms } from "@louez/api/platform/ports";

import { isBillingEnabled } from "@/lib/billing/mode";
import { getUncreatedStorePolicy } from "@/lib/billing/policy";
import { isStandaloneMode } from "@/lib/deployment";
import { resolvePayAsYouGoConfig } from "@/lib/pay-as-you-go/config";
import { getNewStorePricing } from "@/lib/pay-as-you-go/defaults";
import { insertNewStoreSubscription } from "@/lib/pay-as-you-go/new-store-subscription";
import { getReferralProgramConfig } from "@/lib/referral/defaults";
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

/**
 * What a store created now pays, as the onboarding's pricing reads it: no
 * fee without platform billing; Louez's pay-as-you-go pricing while its own
 * billing would bill the store; otherwise the offer the billing service sets
 * for new stores, whose label (in English) is the figure.
 */
async function newStoreTerms(input: {
  currency: string;
  referred: boolean;
}): Promise<NewStoreTerms> {
  if (!isBillingEnabled()) return { billing: "none" };
  const policy = await getUncreatedStorePolicy(new Date());
  if (!policy.legacyBillingApplies) {
    return { billing: "offer", offer: policy.policy?.labels.offer.en ?? null };
  }
  const pricing = getNewStorePricing(input.currency);
  const config = resolvePayAsYouGoConfig(pricing.payAsYouGoConfig);
  return {
    billing: "pay_as_you_go",
    // As insertNewStoreSubscription writes it on the row.
    freeReservations: input.referred
      ? getReferralProgramConfig().referredRewardFreeReservations
      : pricing.freeReservationsGranted,
    tiers:
      config.flatRateCents !== null
        ? [{ upToCount: null, priceMinor: config.flatRateCents }]
        : config.tiers.map((tier) => ({ upToCount: tier.upToCount, priceMinor: tier.priceCents })),
    currency: input.currency,
  };
}

/** `ApiPorts.newStores`: the app's side of creating a store (packages/api services/store-creation.ts). */
export const newStorePort: NewStorePort = {
  singleStore: isStandaloneMode,
  terms: newStoreTerms,
  insertSubscription: insertNewStoreSubscription,
  signupAttribution: (headers) => {
    const referralCode = cookieValue(headers, REFERRAL_COOKIE);
    const signupOrigin = cookieValue(headers, SIGNUP_ORIGIN_COOKIE);
    return {
      referralCode: referralCode || null,
      signupOrigin: isKnownSignupOrigin(signupOrigin) ? signupOrigin : null,
    };
  },
};
