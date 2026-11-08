import type { NewStorePort, NewStoreTerms } from "./ports";

/**
 * The new-store port of a test deployment: a multi-store instance whose new
 * stores pay `terms` (pay-as-you-go by default) and get no subscription row,
 * and whose requests carry no sign-up attribution unless the test says so.
 */
export function createTestNewStores(
  overrides: Partial<NewStorePort> & { terms?: NewStoreTerms } = {},
): NewStorePort {
  const { terms, ...rest } = overrides;
  return {
    singleStore: () => false,
    terms: async () =>
      terms ?? {
        billing: "pay_as_you_go",
        freeReservations: 15,
        tiers: [
          { upToCount: 50, priceMinor: 100 },
          { upToCount: null, priceMinor: 50 },
        ],
        currency: "EUR",
      },
    insertSubscription: async () => false,
    signupAttribution: () => ({ referralCode: null, signupOrigin: null }),
    ...rest,
  };
}
