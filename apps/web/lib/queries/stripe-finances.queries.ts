import { orpc } from "@/lib/orpc/react";

import type { ConnectedAccountPayoutPage } from "@/lib/stripe/connected-account-finances";

export const stripeFinancesQueries = {
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
