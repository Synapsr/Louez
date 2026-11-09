import { db, users } from "@louez/db";
import { eq } from "drizzle-orm";

import { parseDismissedNotices, type DismissibleNoticeId } from "../contracts/dismissed-notices";

/**
 * Closes a notice for good, for this user on every device. Merged under the
 * user's row lock, so a second tab cannot erase what the first one closed.
 */
export async function dismissNotice(input: {
  userId: string;
  noticeId: DismissibleNoticeId;
}): Promise<DismissibleNoticeId[]> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ dismissedNotices: users.dismissedNotices })
      .from(users)
      .where(eq(users.id, input.userId))
      .for("update")
      .limit(1);
    const dismissed = parseDismissedNotices(row?.dismissedNotices);
    if (dismissed.includes(input.noticeId)) return dismissed;

    const next = [...dismissed, input.noticeId];
    await tx
      .update(users)
      .set({ dismissedNotices: next, updatedAt: new Date() })
      .where(eq(users.id, input.userId));
    return next;
  });
}
