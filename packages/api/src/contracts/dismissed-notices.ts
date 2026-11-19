import { z } from "zod";

/**
 * Informational notices a user can close for good. Kept per user, on
 * `users.dismissed_notices`, so a closed notice stays closed on every browser.
 * A notice that asks for an action (pending requests, Stripe setup) is not
 * listed here: it goes away when the action is done.
 *
 * `reeent-cohort-seats` is the home's invitation to claim a reeent launch
 * seat (the member badge it once had, `reeent-cohort-member`, is retired: the
 * home no longer shows it). `agent-assistant` is the offer to
 * connect an AI assistant; `visibility-guide` the home's card of the "Se faire
 * connaître" guide; `test-reservation` the home's test reservation card, also
 * closed when the user deletes the test's data.
 */
export const DISMISSIBLE_NOTICE_IDS = [
  "reeent-cohort-seats",
  "agent-assistant",
  "visibility-guide",
  "test-reservation",
] as const;

export type DismissibleNoticeId = (typeof DISMISSIBLE_NOTICE_IDS)[number];

export const dismissibleNoticeIdSchema = z.enum(DISMISSIBLE_NOTICE_IDS);

/** A never-touched column, or an id retired since, reads as not dismissed. */
export const parseDismissedNotices = (value: unknown): DismissibleNoticeId[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (id): id is DismissibleNoticeId => dismissibleNoticeIdSchema.safeParse(id).success,
  );
};

export const dismissNoticeInput = z.object({ noticeId: dismissibleNoticeIdSchema });

/** Every notice the user has closed, this one included. */
export const dismissNoticeOutput = z.object({
  dismissedNoticeIds: z.array(dismissibleNoticeIdSchema),
});
