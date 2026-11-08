import type { NewStorePort, NewStoreTerms } from "./ports";

/**
 * The new-store port of a test deployment: a multi-store instance whose new
 * stores pay `terms` (pay-as-you-go by default), in the preview and once
 * created, with no subscription row written, no welcome credits, and requests
 * that carry no sign-up attribution unless the test says so.
 */
export function createTestNewStores(
  overrides: Partial<NewStorePort> & { terms?: NewStoreTerms } = {},
): NewStorePort {
  const { terms, ...rest } = overrides;
  const paid: NewStoreTerms = terms ?? {
    billing: "pay_as_you_go",
    freeReservations: 15,
    tiers: [
      { upToCount: 50, priceMinor: 100 },
      { upToCount: null, priceMinor: 50 },
    ],
    currency: "EUR",
  };
  return {
    singleStore: () => false,
    previewTerms: async () => paid,
    subscribe: async () => paid,
    welcomeCredits: () => 0,
    signupAttribution: () => ({ referralCode: null, signupOrigin: null }),
    ...rest,
  };
}
