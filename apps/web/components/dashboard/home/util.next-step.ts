import type { DismissibleNoticeId } from "@louez/api/contracts/dismissed-notices";
import type { ReservationStatus } from "@louez/api/contracts/reservations";

/**
 * The home's one "next step" card (docs/product/accueil-prochaine-etape.md):
 * the guidance the store needs now, chosen from its real state. Everything
 * else waits in the "Mise en route" checklist or on its own page.
 */
export type HomeNextStep =
  | "reeentStripe"
  | "firstProduct"
  | "testReservation"
  | "planOffer"
  | "visibility"
  | "agentAssistant"
  | "cohort";

export const TEST_RESERVATION_NOTICE_ID = "test-reservation" satisfies DismissibleNoticeId;

/** A test that reached its end or was closed: nothing left to rehearse. */
const FINISHED_TEST_STATUSES: ReadonlySet<ReservationStatus> = new Set([
  "completed",
  "cancelled",
  "rejected",
  "declined",
]);

export interface HomeNextStepFacts {
  dismissedNoticeIds: readonly DismissibleNoticeId[];
  /** The store signed up from reeent, and wants online payments Stripe cannot take yet. */
  reeentAwaitsStripe: boolean;
  hasActiveProduct: boolean;
  /** The store already rents to real customers (`isEstablishedStore`): no getting-started card. */
  established: boolean;
  /** A real (not test) reservation exists, whatever its status. */
  hasRealReservation: boolean;
  /** The store's test reservation: its status, or null when it has none. */
  testReservationStatus: ReservationStatus | null;
  /** The user owns the store on an instance that bills: a plan may be offered. */
  canOfferPlan: boolean;
  /** The "Se faire connaître" guide has a step left to do, and its card is not closed. */
  visibilityHasNextStep: boolean;
  /** The AI assistant offer is not closed, and no agent acts on the store yet. */
  agentAssistantOffered: boolean;
  /** The reeent launch offer has something to say: the badge earned, or seats left. */
  cohortNotice: "member" | "seats" | null;
}

/**
 * A store is established once a real customer rented from it: a real (not
 * test) reservation the store accepted (confirmed, ongoing or completed), or a
 * rental payment received. A request still pending, refused or cancelled is
 * not one; the home's counters (getStoreMetrics) already leave tests out.
 */
export function isEstablishedStore(metrics: {
  confirmedReservations: number;
  ongoingReservations: number;
  completedReservations: number;
  allTimeRevenue: number;
}): boolean {
  return (
    metrics.confirmedReservations + metrics.ongoingReservations + metrics.completedReservations >
      0 || metrics.allTimeRevenue > 0
  );
}

/**
 * Every card the store could see now, the most useful first. The home shows
 * the first; `planOffer` is read from the billing service after the page, so
 * when it has no offer the one after it takes its place.
 */
export function homeNextSteps(facts: HomeNextStepFacts): HomeNextStep[] {
  const steps: HomeNextStep[] = [];
  // reeent does not publish the store until Stripe can charge.
  if (facts.reeentAwaitsStripe) steps.push("reeentStripe");
  if (!facts.hasActiveProduct && !facts.established) steps.push("firstProduct");
  if (
    facts.hasActiveProduct &&
    !facts.hasRealReservation &&
    !(facts.testReservationStatus && FINISHED_TEST_STATUSES.has(facts.testReservationStatus)) &&
    !facts.dismissedNoticeIds.includes(TEST_RESERVATION_NOTICE_ID)
  ) {
    steps.push("testReservation");
  }
  // Only a store that has paid commissions gets an offer: past its first customers.
  if (facts.canOfferPlan && facts.hasRealReservation) steps.push("planOffer");
  // Finding first customers and letting an assistant set the store up are
  // behind a store that rents already: the guide stays in the sidebar, the
  // assistant in Settings -> Integrations.
  if (facts.visibilityHasNextStep && !facts.established) steps.push("visibility");
  if (facts.agentAssistantOffered && !facts.established) steps.push("agentAssistant");
  if (facts.cohortNotice) steps.push("cohort");
  return steps;
}

/** The card to show, and the one that replaces it when the plan offer turns out empty. */
export function pickHomeNextStep(facts: HomeNextStepFacts): {
  step: HomeNextStep | null;
  fallback: HomeNextStep | null;
} {
  const [step = null, fallback = null] = homeNextSteps(facts);
  return { step, fallback: step === "planOffer" ? fallback : null };
}

/**
 * Which reeent launch notice the store may see: the badge it earned, or the
 * seats still open to a store that did not come from reeent (one that did has
 * signed up already, its Stripe card carries the offer). Null when there is
 * nothing to say or the user closed it.
 */
export function cohortNoticeOf(input: {
  billingEnabled: boolean;
  isFromReeent: boolean;
  hasLifetimeFeeWaiver: boolean;
  remainingSeats: number;
  dismissedNoticeIds: readonly DismissibleNoticeId[];
}): "member" | "seats" | null {
  if (!input.billingEnabled) return null;
  if (input.hasLifetimeFeeWaiver) {
    return input.dismissedNoticeIds.includes("reeent-cohort-member") ? null : "member";
  }
  if (input.isFromReeent || input.remainingSeats <= 0) return null;
  return input.dismissedNoticeIds.includes("reeent-cohort-seats") ? null : "seats";
}
