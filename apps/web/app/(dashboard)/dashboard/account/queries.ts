import { and, eq, gt } from "drizzle-orm";

import { db, sessions } from "@louez/db";

import { authInstance } from "@/lib/auth";

import { summarizeLinkedAccounts, type LinkedAccountsSummary } from "./util.linked-accounts";

interface SignInOverview extends LinkedAccountsSummary {
  activeSessionCount: number;
}

/**
 * What the "Sign-in" card shows. The session count is read from the table:
 * better-auth's `listSessions` refuses any session older than a day
 * (SESSION_NOT_FRESH), which is nearly all of them with 90-day sessions.
 */
export const getSignInOverview = async (
  userId: string,
  requestHeaders: Headers,
): Promise<SignInOverview> => {
  const [accounts, activeSessionCount] = await Promise.all([
    authInstance.api.listUserAccounts({ headers: requestHeaders }),
    db.$count(sessions, and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date()))),
  ]);

  return { ...summarizeLinkedAccounts(accounts), activeSessionCount };
};
