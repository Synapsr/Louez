import { and, eq, gte, sql } from 'drizzle-orm'

import {
  aiAdvisorConversations,
  aiCreditDebits,
  aiCredits,
  db,
} from '@louez/db'

import { env } from '@/env'
import {
  CREDIT_MICRO,
  audioCostMicroUsd,
  costMicroUsdToCreditsMicro,
  flatCallBillMicro,
  getPhoneCreditsPerMinute,
  runCostMicroUsd,
  type AdvisorUsage,
} from '@/lib/ai/pricing'
import { log } from '@/lib/evlog'
import type { Plan } from '@/lib/plans'

// The phone receptionist reuses the exact same prepaid AI-credit balance as the
// text advisor. The pre-call gate is therefore identical — re-exported here so
// the phone code has a single, well-named entry point.
export { checkAdvisorCredits as checkPhoneCredits } from '@/lib/ai/advisor/credits'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Start of the current calendar month (the monthly-allowance reset boundary). */
function startOfCalendarMonth(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

/** Sum of the monthly-pocket consumption for a store this calendar month. */
async function sumMonthlyUsedMicro(
  runner: Tx | typeof db,
  storeId: string,
): Promise<number> {
  const [row] = await runner
    .select({
      used: sql<number>`COALESCE(SUM(${aiCreditDebits.fromMonthlyMicro}), 0)`.mapWith(
        Number,
      ),
    })
    .from(aiCreditDebits)
    .where(
      and(
        eq(aiCreditDebits.storeId, storeId),
        gte(aiCreditDebits.createdAt, startOfCalendarMonth()),
      ),
    )
  return row?.used ?? 0
}

/**
 * Metered, capped, two-pocket debit for ONE phone billing event (either a
 * model turn's tokens, or the whole call's audio at settle time). Mirrors the
 * advisor's recordAdvisorRunDebit but (a) also prices audio seconds and (b)
 * caps at AI_PHONE_MAX_CREDITS_PER_CALL credits per CALL — a voice call
 * legitimately costs more than the advisor's 1-credit-per-conversation cap.
 * The per-call accumulator is the conversation's accruedCreditsMicro, shared
 * across every debit of the same call. Idempotent via the UNIQUE dedup key.
 */
async function applyCallDebit(
  tx: Tx,
  params: {
    storeId: string
    conversationId: string
    dedupKey: string
    usage: AdvisorUsage
    audioSeconds: number
    plan: Plan
  },
): Promise<number> {
  const { storeId, conversationId, dedupKey, usage, audioSeconds, plan } =
    params

  // The REAL cost is always frozen on the row (cost-vs-billed reporting); what
  // the store is DEBITED depends on the billing mode: flat per-started-minute
  // when AI_PHONE_CREDITS_PER_MINUTE is set, else the USD-metered conversion.
  const costMicroUsd =
    runCostMicroUsd(usage) + audioCostMicroUsd(audioSeconds)
  const flatMode = getPhoneCreditsPerMinute() > 0
  let rawCreditsMicro: number
  if (flatMode) {
    // Flat tariff: only the whole-call audio settle bills credits (token turns
    // become cost-only rows below). Duration is clamped to the configured max
    // call length so a malformed provider duration can never overbill.
    const maxSeconds = Math.trunc(Number(env.AI_PHONE_MAX_CALL_SECONDS))
    const clampedSeconds =
      Number.isFinite(maxSeconds) && maxSeconds > 0
        ? Math.min(audioSeconds, maxSeconds)
        : audioSeconds
    rawCreditsMicro = flatCallBillMicro(clampedSeconds)
  } else {
    rawCreditsMicro = costMicroUsdToCreditsMicro(costMicroUsd)
  }
  if (!Number.isFinite(rawCreditsMicro) || rawCreditsMicro < 0) {
    rawCreditsMicro = 0
  }
  if (rawCreditsMicro <= 0 && costMicroUsd <= 0) return 0

  // Cost-only row (flat mode's token turns): freeze the real cost for the
  // margin reporting without touching the balance, the cap, or the per-call
  // accumulator. Still exactly-once via the UNIQUE dedup key.
  if (rawCreditsMicro <= 0) {
    await tx.insert(aiCreditDebits).values({
      storeId,
      conversationId,
      dedupKey,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      audioSeconds,
      costMicroUsd,
      debitedMicro: 0,
      fromMonthlyMicro: 0,
      fromPrepaidMicro: 0,
    })
    return 0
  }

  // Serialize a store's debits by locking the ai_credits row up front (creating
  // it on demand) so the per-call cap and the monthly split are race-free.
  await tx
    .insert(aiCredits)
    .values({ storeId })
    .onDuplicateKeyUpdate({ set: { storeId } })
  await tx
    .select({ balanceMicro: aiCredits.balanceMicro })
    .from(aiCredits)
    .where(eq(aiCredits.storeId, storeId))
    .for('update')

  const conv = await tx.query.aiAdvisorConversations.findFirst({
    where: eq(aiAdvisorConversations.id, conversationId),
    columns: { accruedCreditsMicro: true },
  })

  // Env numbers can arrive unparsed (string/undefined) when env validation is
  // skipped at runtime (SKIP_ENV_VALIDATION), which would make the Zod default
  // vanish and Math.max(1, undefined) === NaN poison the whole debit. Coerce
  // defensively so a missing cap falls back to 20 credits, never NaN.
  // The cap protects USD-metered billing; the flat tariff is already bounded
  // above by the max call duration, so it bypasses this cap.
  const maxCreditsPerCall = Math.trunc(Number(env.AI_PHONE_MAX_CREDITS_PER_CALL))
  const capCredits =
    Number.isFinite(maxCreditsPerCall) && maxCreditsPerCall >= 1
      ? maxCreditsPerCall
      : 20
  const capMicro = capCredits * CREDIT_MICRO
  const capRemaining = flatMode
    ? rawCreditsMicro
    : Math.max(0, capMicro - (conv?.accruedCreditsMicro ?? 0))
  const debitMicro = Math.min(rawCreditsMicro, capRemaining)
  if (!Number.isFinite(debitMicro) || debitMicro <= 0) return 0

  const perMonth = plan.features.aiCreditsPerMonth
  let fromMonthly = 0
  if (perMonth === null) {
    fromMonthly = debitMicro
  } else if (perMonth > 0) {
    const monthlyUsed = await sumMonthlyUsedMicro(tx, storeId)
    const monthlyRemaining = Math.max(0, perMonth * CREDIT_MICRO - monthlyUsed)
    fromMonthly = Math.min(debitMicro, monthlyRemaining)
  }
  const fromPrepaid = debitMicro - fromMonthly

  // Insert the debit first — the UNIQUE dedupKey makes it exactly-once (a retry
  // throws and rolls back the whole tx, so nothing is double-debited).
  await tx.insert(aiCreditDebits).values({
    storeId,
    conversationId,
    dedupKey,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    audioSeconds,
    costMicroUsd,
    debitedMicro: debitMicro,
    fromMonthlyMicro: fromMonthly,
    fromPrepaidMicro: fromPrepaid,
  })

  await tx
    .update(aiAdvisorConversations)
    .set({
      accruedCreditsMicro: sql`${aiAdvisorConversations.accruedCreditsMicro} + ${debitMicro}`,
    })
    .where(eq(aiAdvisorConversations.id, conversationId))

  if (fromPrepaid > 0) {
    await tx
      .update(aiCredits)
      .set({
        balanceMicro: sql`${aiCredits.balanceMicro} - ${fromPrepaid}`,
        totalUsedMicro: sql`${aiCredits.totalUsedMicro} + ${fromPrepaid}`,
        updatedAt: new Date(),
      })
      .where(eq(aiCredits.storeId, storeId))
  }

  return debitMicro
}

/**
 * Meter one model turn's tokens during a call. Runs inside the turn's
 * persistence transaction (alongside the assistant-message insert) so
 * accounting and transcript commit atomically. Keyed on the assistant message.
 */
export async function recordCallTurnDebit(
  tx: Tx,
  params: {
    storeId: string
    conversationId: string
    assistantMessageId: string
    usage: AdvisorUsage
    plan: Plan
  },
): Promise<number> {
  return applyCallDebit(tx, {
    storeId: params.storeId,
    conversationId: params.conversationId,
    dedupKey: `call:turn:${params.assistantMessageId}`,
    usage: params.usage,
    audioSeconds: 0,
    plan: params.plan,
  })
}

const ZERO_USAGE: AdvisorUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
}

/**
 * Settle the call's AUDIO cost once, at the end-of-call status callback. Keyed
 * on the call id, so a duplicate status callback is a no-op (the UNIQUE dedup
 * key throws and the transaction rolls back). Returns micro-credits debited.
 */
export async function recordCallAudioDebit(params: {
  storeId: string
  conversationId: string
  callId: string
  audioSeconds: number
  plan: Plan
}): Promise<number> {
  if (params.audioSeconds <= 0) return 0
  try {
    return await db.transaction((tx) =>
      applyCallDebit(tx, {
        storeId: params.storeId,
        conversationId: params.conversationId,
        dedupKey: `call:audio:${params.callId}`,
        usage: ZERO_USAGE,
        audioSeconds: params.audioSeconds,
        plan: params.plan,
      }),
    )
  } catch (error) {
    // A duplicate status callback (same callId) hits the UNIQUE dedup key and
    // rolls back — expected and harmless. Log anything else.
    log.error(
      'phone',
      `recordCallAudioDebit failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return 0
  }
}
