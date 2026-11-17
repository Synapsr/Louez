import { orpc } from "@/lib/orpc/react";

/** The home's plan offer: counting its card as seen, closing it, opening the plan's Checkout. Session-only. */
export const billingMutations = {
  recordPlanOfferShown: () => orpc.dashboard.billing.recordPlanOfferShown.mutationOptions(),
  dismissPlanOffer: () => orpc.dashboard.billing.dismissPlanOffer.mutationOptions(),
  startPlanOffer: () => orpc.dashboard.billing.startPlanOffer.mutationOptions(),
};
