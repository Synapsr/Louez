import type { DismissibleNoticeId } from "@louez/api/contracts/dismissed-notices";
import type { VisibilityStep } from "@louez/api/contracts/visibility";

export const VISIBILITY_GUIDE_NOTICE_ID = "visibility-guide" satisfies DismissibleNoticeId;

/**
 * Whether the home shows the guide's card: once the store is online with a
 * product to rent (sharing an empty store wastes the first impression), until
 * the user closes it. The card itself goes once no step is left.
 */
export const shouldOfferVisibilityGuide = (input: {
  online: boolean;
  hasActiveProduct: boolean;
  dismissedNoticeIds: readonly DismissibleNoticeId[];
}): boolean =>
  input.online &&
  input.hasActiveProduct &&
  !input.dismissedNoticeIds.includes(VISIBILITY_GUIDE_NOTICE_ID);

/** The first step still to do, in the guide's order; null once each is done or skipped. */
export function nextVisibilityStep(steps: readonly VisibilityStep[]): VisibilityStep | null {
  return steps.find((step) => step.status === "todo") ?? null;
}

/** How many steps are done, and how many the store said are not for it. */
export function visibilityCounts(steps: readonly VisibilityStep[]): {
  done: number;
  skipped: number;
} {
  return {
    done: steps.filter((step) => step.status === "done").length,
    skipped: steps.filter((step) => step.status === "skipped").length,
  };
}
