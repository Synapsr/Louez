import { and, eq } from "drizzle-orm";
import { aiAdvisorMessages, aiCreditDebits, db, voiceSessionsTable } from "@louez/db";
import type { CallBinding, LiveRequest } from "@louez/voice/protocol";
import { getMaxCallSeconds } from "@/lib/voice/config";
import { getAiCreditsInfo } from "@/lib/ai/advisor/credits";
import { CREDIT_MICRO, getPhoneCreditsPerMinute } from "@/lib/ai/pricing";
import {
  checkPhoneCredits,
  recordCallTurnDebit,
  settleCallAudioDebit,
} from "@/lib/ai/phone/credits";
import { getStorePlan } from "@/lib/plan-limits";
import { areAiCreditsEnabled, type Plan } from "@/lib/plans";

export async function callDurationBudget(storeId: string, plan: Plan): Promise<number> {
  const maximum = getMaxCallSeconds();
  const tariff = getPhoneCreditsPerMinute();
  if (!areAiCreditsEnabled() || tariff <= 0) return maximum;
  const info = await getAiCreditsInfo(storeId, plan);
  if (info.monthlyRemainingMicro === null) return maximum;
  const available = Math.max(0, info.monthlyRemainingMicro + info.prepaidBalanceMicro);
  return Math.min(maximum, Math.floor(available / (tariff * CREDIT_MICRO)) * 60);
}

export async function claimLiveSession(binding: CallBinding, storeId: string) {
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(voiceSessionsTable)
      .where(
        and(
          eq(voiceSessionsTable.conversationId, binding.conversationId),
          eq(voiceSessionsTable.storeId, storeId),
          eq(voiceSessionsTable.providerCallId, binding.callId),
        ),
      )
      .for("update");
    if (!session) return null;
    if (
      session.status === "active" &&
      session.streamId === binding.streamId &&
      session.connectionId === binding.connectionId
    )
      return session;
    if (session.status !== "pending" || Date.now() - session.createdAt.getTime() > 300_000)
      return null;
    const startedAt = new Date();
    await tx
      .update(voiceSessionsTable)
      .set({
        status: "active",
        streamId: binding.streamId,
        connectionId: binding.connectionId,
        startedAt,
        updatedAt: startedAt,
      })
      .where(eq(voiceSessionsTable.conversationId, binding.conversationId));
    return { ...session, startedAt };
  });
}

export async function syncLiveSession(
  request: Extract<LiveRequest, { type: "sync" }>,
  storeId: string,
) {
  const plan = await getStorePlan(storeId);
  await db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(voiceSessionsTable)
      .where(
        and(
          eq(voiceSessionsTable.conversationId, request.conversationId),
          eq(voiceSessionsTable.storeId, storeId),
        ),
      )
      .for("update");
    if (!session || session.settled || !session.startedAt) return;
    for (const segment of request.transcripts) {
      await tx
        .insert(aiAdvisorMessages)
        .values({
          id: segment.id,
          conversationId: request.conversationId,
          storeId,
          role: segment.role,
          content: segment.text,
          createdAt: new Date(
            session.startedAt.getTime() + Math.min(segment.startMs, session.maxSeconds * 1000),
          ),
        })
        .onDuplicateKeyUpdate({ set: { content: segment.text } });
    }
    const backendUsage = { ...session.backendUsage };
    for (const response of request.responses) {
      if (Object.hasOwn(backendUsage, response.id)) continue;
      if (Object.keys(backendUsage).length >= 100) throw new Error("Backend usage limit exceeded");
      backendUsage[response.id] = response.usage;
    }
    if (areAiCreditsEnabled()) {
      for (const response of request.responses) {
        const dedupKey = `call:turn:${response.id}`;
        const existing = await tx.query.aiCreditDebits.findFirst({
          where: eq(aiCreditDebits.dedupKey, dedupKey),
          columns: { id: true },
        });
        if (!existing)
          await recordCallTurnDebit(tx, {
            storeId,
            conversationId: request.conversationId,
            assistantMessageId: response.id,
            usage: response.usage,
            plan,
          });
      }
    }
    await tx
      .update(voiceSessionsTable)
      .set({
        backendUsage,
        audioSeconds: Math.max(session.audioSeconds, Math.ceil(request.seconds)),
        updatedAt: new Date(),
      })
      .where(eq(voiceSessionsTable.conversationId, request.conversationId));
  });
  const credit = !areAiCreditsEnabled() || (await checkPhoneCredits(storeId, plan)).allowed;
  const remaining = await callDurationBudget(storeId, plan);
  return { allowed: credit && request.seconds < remaining };
}

export async function finishLiveSession(params: {
  conversationId: string;
  storeId: string;
  seconds: number;
  finalized: boolean;
  sessionId: string | null;
  outcome: "end" | "transfer" | "failed";
}) {
  const plan = await getStorePlan(params.storeId);
  await db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(voiceSessionsTable)
      .where(
        and(
          eq(voiceSessionsTable.conversationId, params.conversationId),
          eq(voiceSessionsTable.storeId, params.storeId),
        ),
      )
      .for("update");
    if (!session || session.settled) return;
    // Missing session.closed is recorded as an observed lower bound, never
    // replaced with PSTN duration (which can include time with a human).
    const seconds = Math.ceil(params.seconds);
    if (areAiCreditsEnabled())
      await settleCallAudioDebit(tx, {
        storeId: params.storeId,
        conversationId: params.conversationId,
        callId: session.providerCallId,
        audioSeconds: seconds,
        billableAudioSeconds: Math.min(seconds, session.maxSeconds),
        plan,
      });
    await tx
      .update(voiceSessionsTable)
      .set({
        audioSeconds: seconds,
        usageFinalized: params.finalized,
        settled: true,
        openaiSessionId: params.sessionId,
        status: params.outcome,
        updatedAt: new Date(),
      })
      .where(eq(voiceSessionsTable.conversationId, params.conversationId));
  });
}
