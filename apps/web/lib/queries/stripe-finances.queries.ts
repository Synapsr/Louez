import { orpc } from "@/lib/orpc/react";

import type { ConnectedAccountPayoutPage } from "@/lib/stripe/connected-account-finances";

export const stripeFinancesQueries = {
  /** Reads the Stripe account from Stripe and saves its state on the store. */
  syncStatus: () => orpc.dashboard.payments.syncStripeStatus.mutationOptions(),
  payouts: (initialPage: ConnectedAccountPayoutPage) =>
    orpc.dashboard.payments.payouts.infiniteOptions({
      input: (cursor: string | undefined) => ({ cursor: cursor ?? undefined }),
      initialData: {
        pages: [initialPage],
        pageParams: [undefined],
      },
      initialPageParam: undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      staleTime: 30_000,
    }),
};
