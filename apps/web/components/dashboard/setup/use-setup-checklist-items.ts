"use client";

import type { OnlinePaymentsStep, SetupProgressCounts } from "@/lib/dashboard/setup-progress";

/**
 * Why the store needs online payments. A store that came from reeent is not
 * published there until Stripe is chargeable, which makes the step urgent
 * enough to outrank the catalogue and worth its own wording.
 */
export type OnlinePaymentsContext = "default" | "reeent";

export interface SetupChecklistItem {
  key: string;
  completed: boolean;
  href?: string;
  action?: string;
  /** Translation key under setup.descriptions — makes the step expandable */
  description?: string;
  showStoreLink?: boolean;
}

/** The setup steps in order, with the next one to do and the overall count. */
export const useSetupChecklistItems = ({
  counts,
  onlinePaymentsStep,
  onlinePaymentsContext,
}: {
  counts: SetupProgressCounts;
  onlinePaymentsStep: OnlinePaymentsStep;
  onlinePaymentsContext: OnlinePaymentsContext;
}) => {
  const isReeentContext = onlinePaymentsContext === "reeent";

  const onlinePaymentsItems: SetupChecklistItem[] =
    onlinePaymentsStep === "hidden"
      ? []
      : [
          {
            key: "connectStripe",
            completed: onlinePaymentsStep === "done",
            href: "/dashboard/settings/payments",
            action: "setup.connectStripe",
            description: isReeentContext ? "connectStripeReeent" : "connectStripe",
          },
        ];

  const items: SetupChecklistItem[] = [
    { key: "createAccount", completed: true },
    { key: "configureStore", completed: true },
    // A reeent store stays unlisted there until Stripe is chargeable, so the
    // payment step comes before the catalogue and becomes the current step.
    ...(isReeentContext ? onlinePaymentsItems : []),
    {
      key: "addFirstProduct",
      completed: counts.activeProductCount > 0,
      href: "/dashboard/products/new",
      action: "setup.addFirstProduct",
      description: "addFirstProduct",
    },
    ...(isReeentContext ? [] : onlinePaymentsItems),
    {
      key: "firstReservation",
      completed: counts.totalReservations > 0,
      href: "/dashboard/reservations/new?source=onboarding",
      action: "setup.createReservation",
      description: "firstReservation",
      showStoreLink: true,
    },
    {
      key: "firstCompleted",
      completed: counts.completedReservations > 0,
      description: "firstCompleted",
    },
  ];

  const completedCount = items.filter((item) => item.completed).length;

  return {
    items,
    completedCount,
    progress: Math.round((completedCount / items.length) * 100),
    nextStep: items.find((item) => !item.completed) ?? null,
  };
};
