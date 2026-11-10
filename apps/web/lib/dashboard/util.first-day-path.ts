import type { OnlinePaymentsStep } from "./setup-progress";
import type { PaymentsSetupState } from "./util.payments-setup";

/**
 * What a new store does before its first request can arrive, as the home's
 * requests card walks it. It reads the same counts as the sidebar's setup
 * list, so publishing a product ticks it here and there.
 *
 * - `product`: a published product the customers can book. A draft does not
 *   count: until something is live, the store is brand new.
 * - `payments`: how the store gets paid, chosen at onboarding. "Demande de
 *   réservation" is a choice made, so the step reads done — with a way to
 *   switch to online payment. "Paiement en ligne" is done once Stripe
 *   actually charges.
 * - `share`: sending the store out. Nothing records it, so it never shows as
 *   done: it stays the last step until the first request takes the card over.
 *   A reeent store has no Louez storefront to promote, so it skips it.
 */
export type FirstDayStepKey = "product" | "payments" | "share";

/** `waiting`: nothing to do but wait (Stripe checking the account). */
export type FirstDayStepState = "done" | "current" | "waiting" | "upcoming";

export interface FirstDayStep {
  key: FirstDayStepKey;
  state: FirstDayStepState;
}

export interface FirstDayPath {
  steps: FirstDayStep[];
  completedCount: number;
  /** The step whose action the card offers; null once nothing is left to do. */
  current: FirstDayStepKey | null;
  /** The mode chosen at onboarding, which the payments step names. */
  paymentsMode: "request" | "online";
}

interface FirstDayPathInput {
  activeProductCount: number;
  onlinePaymentsStep: OnlinePaymentsStep;
  paymentsSetup: PaymentsSetupState | null;
  isFromReeent: boolean;
}

export const getFirstDayPath = ({
  activeProductCount,
  onlinePaymentsStep,
  paymentsSetup,
  isFromReeent,
}: FirstDayPathInput): FirstDayPath => {
  const done: Record<FirstDayStepKey, boolean> = {
    product: activeProductCount > 0,
    // Request mode is a settled choice; online payment waits on Stripe.
    payments: onlinePaymentsStep !== "todo",
    share: false,
  };
  const waiting = (key: FirstDayStepKey) => key === "payments" && paymentsSetup === "verifying";
  // A reeent store is not listed there until Stripe charges: payments lead.
  const order: FirstDayStepKey[] = isFromReeent
    ? ["payments", "product"]
    : ["product", "payments", "share"];
  const current = order.find((key) => !done[key] && !waiting(key)) ?? null;

  return {
    steps: order.map((key) => ({
      key,
      state: done[key]
        ? "done"
        : waiting(key)
          ? "waiting"
          : key === current
            ? "current"
            : "upcoming",
    })),
    completedCount: order.filter((key) => done[key]).length,
    current,
    paymentsMode: onlinePaymentsStep === "hidden" ? "request" : "online",
  };
};
