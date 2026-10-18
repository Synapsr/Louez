import { and, eq, lte } from "drizzle-orm";
import { db, voiceSessionsTable } from "@louez/db";
import { finishLiveSession } from "./live-session";
import { log } from "@/lib/evlog";

/** Recover accounting after a worker crash; never invent unobserved usage. */
export async function reconcileVoiceSessions(now = new Date()) {
  const sessions = await db
    .select()
    .from(voiceSessionsTable)
    .where(
      and(
        eq(voiceSessionsTable.settled, false),
        lte(voiceSessionsTable.createdAt, new Date(now.getTime() - 120_000)),
      ),
    )
    .orderBy(voiceSessionsTable.createdAt)
    .limit(100);
  let reconciled = 0;
  for (const session of sessions) {
    const ended = session.pstnEndedAt && now.getTime() - session.pstnEndedAt.getTime() > 90_000;
    const expired = now.getTime() > session.createdAt.getTime() + (session.maxSeconds + 120) * 1000;
    if (!ended && !expired) continue;
    await finishLiveSession({
      conversationId: session.conversationId,
      storeId: session.storeId,
      seconds: session.audioSeconds,
      finalized: false,
      sessionId: session.openaiSessionId,
      outcome: "failed",
    });
    log.warn("voice", `Unconfirmed usage requires reconciliation: ${session.conversationId}`);
    reconciled++;
  }
  return { reconciled };
}
