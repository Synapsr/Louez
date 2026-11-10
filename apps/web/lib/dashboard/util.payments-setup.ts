import type { OnlinePaymentsStep } from "./setup-progress";

/**
 * Where a store that chose online payment at onboarding stands while Stripe
 * cannot charge yet (ADR 0004: it runs as request mode meanwhile, and the
 * dashboard must say so). `null` when there is nothing to finish: paid on
 * site by choice, or Stripe live.
 *
 * - `start`: no Stripe account yet.
 * - `resume`: the account exists, its Stripe form is not finished.
 * - `verifying`: the form is done, Stripe is checking; nothing to do but wait.
 */
export type PaymentsSetupState = "start" | "resume" | "verifying";

interface PaymentsSetupInput {
  onlinePaymentsStep: OnlinePaymentsStep;
  stripeAccountId: string | null;
  stripeOnboardingComplete: boolean | null;
}

export const getPaymentsSetupState = ({
  onlinePaymentsStep,
  stripeAccountId,
  stripeOnboardingComplete,
}: PaymentsSetupInput): PaymentsSetupState | null => {
  if (onlinePaymentsStep !== "todo") return null;
  if (!stripeAccountId) return "start";
  return stripeOnboardingComplete ? "verifying" : "resume";
};

/**
 * The requests card earns its column only where requests are the work: in
 * request mode (chosen, or online payments not live yet). With online
 * payments live, a booking confirms itself when paid, so the card would sit
 * empty; it still comes back for a request waiting on the owner, and for a
 * new store's path to its first booking.
 */
export const shouldShowRequestsCard = ({
  paysOnline,
  actionablePendingCount,
  hasFirstDayPath,
}: {
  /** Online payments are live: bookings confirm themselves when paid. */
  paysOnline: boolean;
  actionablePendingCount: number;
  hasFirstDayPath: boolean;
}): boolean => !paysOnline || actionablePendingCount > 0 || hasFirstDayPath;
