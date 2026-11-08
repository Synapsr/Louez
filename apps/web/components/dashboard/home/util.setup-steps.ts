import type { LaunchChecklistView } from "@louez/api/contracts/launch";

/**
 * Whether the checklist shows the "activate online payments" step: hidden for
 * stores that chose request mode, otherwise tracks Stripe chargeability (the
 * KYC can be left pending during onboarding — payment mode silently degrades
 * to request mode until it's done).
 */
export type OnlinePaymentsStep = "hidden" | "todo" | "done";

/**
 * Why the store needs online payments. A store that came from reeent is not
 * published there until Stripe is chargeable, which makes the step urgent
 * enough to outrank the catalogue and worth its own wording.
 */
export type OnlinePaymentsContext = "default" | "reeent";

export interface SetupStep {
  key: string;
  completed: boolean;
  href?: string;
  action?: string;
  /** Translation key under setup.descriptions — makes the step expandable */
  description?: string;
  showStoreLink?: boolean;
}

const isDone = (checklist: LaunchChecklistView, key: LaunchChecklistView["items"][number]["key"]) =>
  checklist.items.some((item) => item.key === key && item.status === "done");

/** The payment step of the store's launch checklist (stores.getLaunchChecklist). */
export function onlinePaymentsStepOf(checklist: LaunchChecklistView): OnlinePaymentsStep {
  if (checklist.bookingMode.intended !== "payment") return "hidden";
  return isDone(checklist, "onlinePayments") ? "done" : "todo";
}

/**
 * The home's setup steps, from the store's launch checklist: the dashboard
 * and the agents read the same items.
 */
export function homeSetupSteps(
  checklist: LaunchChecklistView,
  context: OnlinePaymentsContext,
): SetupStep[] {
  const isReeent = context === "reeent";
  const paymentsStep = onlinePaymentsStepOf(checklist);
  const onlinePayments: SetupStep[] =
    paymentsStep === "hidden"
      ? []
      : [
          {
            key: "connectStripe",
            completed: paymentsStep === "done",
            href: "/dashboard/settings/payments",
            action: "setup.connectStripe",
            description: isReeent ? "connectStripeReeent" : "connectStripe",
          },
        ];

  return [
    { key: "createAccount", completed: true },
    { key: "configureStore", completed: true },
    // A reeent store stays unlisted there until Stripe is chargeable, so the
    // payment step comes before the catalogue and becomes the current step.
    ...(isReeent ? onlinePayments : []),
    {
      key: "addFirstProduct",
      // Any active product, free ones included; the launch item asks a price.
      completed: checklist.catalog.hasActiveProduct,
      href: "/dashboard/products/new",
      action: "setup.addFirstProduct",
      description: "addFirstProduct",
    },
    ...(isReeent ? [] : onlinePayments),
    {
      key: "firstReservation",
      completed: checklist.milestones?.firstReservation ?? false,
      href: "/dashboard/reservations/new?source=onboarding",
      action: "setup.createReservation",
      description: "firstReservation",
      showStoreLink: true,
    },
    {
      key: "firstCompleted",
      completed: checklist.milestones?.firstCompletedReservation ?? false,
      description: "firstCompleted",
    },
  ];
}
