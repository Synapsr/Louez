import type { DismissibleNoticeId } from "./dismissed-notices";

/**
 * The "next step" tips of the home's requests card, one at a time, in this
 * order. Each leads to a page that already exists, and each can be closed for
 * good (it is a dismissible notice).
 *
 * - `onlinePayments`: a store on "Demande de réservation", offered online
 *   payment — after its first day, whose path already offers the switch.
 * - `manualReservation`, `reviewBooster`: a starting store that is up to date.
 */
export type HomeTipKey = "onlinePayments" | "manualReservation" | "reviewBooster";

export const HOME_TIP_NOTICE_ID: Record<HomeTipKey, DismissibleNoticeId> = {
  onlinePayments: "home-tip-online-payments",
  manualReservation: "home-tip-manual-reservation",
  reviewBooster: "home-tip-review-booster",
};

interface HomeTipInput {
  dismissed: DismissibleNoticeId[];
  /** "Demande de réservation" chosen at onboarding: no Stripe. */
  paysOnSite: boolean;
  /** The first-day path is on the card, and its payments step offers the switch. */
  hasFirstDayPath: boolean;
  /** Fewer than five rentals done, and no request waiting. */
  isStartingAndUpToDate: boolean;
  /** The plan includes review requests. */
  reviewBoosterAvailable: boolean;
  reviewBoosterEnabled: boolean;
}

export const getHomeTip = ({
  dismissed,
  paysOnSite,
  hasFirstDayPath,
  isStartingAndUpToDate,
  reviewBoosterAvailable,
  reviewBoosterEnabled,
}: HomeTipInput): HomeTipKey | null => {
  const eligible: HomeTipKey[] = [
    ...(paysOnSite && !hasFirstDayPath ? (["onlinePayments"] as const) : []),
    ...(isStartingAndUpToDate ? (["manualReservation"] as const) : []),
    ...(isStartingAndUpToDate && reviewBoosterAvailable && !reviewBoosterEnabled
      ? (["reviewBooster"] as const)
      : []),
  ];
  return eligible.find((key) => !dismissed.includes(HOME_TIP_NOTICE_ID[key])) ?? null;
};
