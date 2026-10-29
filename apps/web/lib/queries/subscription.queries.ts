import { queryOptions, skipToken } from "@tanstack/react-query";

import { previewPlanChange } from "@/app/(dashboard)/dashboard/subscription/actions";
import type { Currency } from "@/lib/plans.shared";

type PlanChangeInput = {
  planSlug: string;
  interval: "monthly" | "yearly";
  currency: Currency;
};

export const subscriptionQueries = {
  /**
   * Stripe's preview of a plan change, read each time its dialog opens (null while it is
   * closed): the prorated amount moves with the clock, and a failed preview is shown,
   * not retried.
   */
  planChangePreview: (input: PlanChangeInput | null) =>
    queryOptions({
      queryKey: ["dashboard", "subscription", "plan-change-preview", input] as const,
      queryFn: input ? () => previewPlanChange(input) : skipToken,
      staleTime: 0,
      gcTime: 0,
      retry: false,
      refetchOnWindowFocus: false,
    }),
};
