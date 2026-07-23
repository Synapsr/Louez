import { and, desc, eq, gte, sql } from 'drizzle-orm'

import {
  aiAdvisorConversations,
  aiCreditDebits,
  aiCreditTransactions,
  aiCredits,
  db,
} from '@louez/db'

import { env } from '@/env'
import {
  CREDIT_MICRO,
  costMicroUsdToCreditsMicro,
  getCreditCostBasisUsd,
  runCostMicroUsd,
  type AdvisorUsage,
} from '@/lib/ai/pricing'
import { log } from '@/lib/evlog'
import type { Plan } from '@/lib/plans'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Micro-credits ⇄ whole credits (for display and env-configured amounts). */
export const microToCredits = (micro: number): number => micro / CREDIT_MICRO
export const creditsToMicro = (credits: number): number =>
  Math.round(credits * CREDIT_MICRO)

/**
 * Prepaid credits to gift a NEW store at account creation. Read from env,
 * snapshotted at onboarding (changing the env only affects future accounts).
 */
export function getDefaultAiCredits(): number {
  const n = Number(env.FREE_AI_CREDITS)
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0
}

/** Start of the current calendar month (the monthly-allowance reset boundary). */
function startOfCalendarMonth(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

/** Sum of the monthly-pocket consumption for a store this calendar month (micro-credits). */
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

export type AiCreditsInfo = {
  /** null = unlimited monthly allowance. */
  monthlyIncludedMicro: number | null
  monthlyUsedMicro: number
  /** null = unlimited. */
  monthlyRemainingMicro: number | null
  prepaidBalanceMicro: number
  autoTopupEnabled: boolean
  autoTopupThresholdMicro: number | null
  autoTopupCredits: number | null
  autoTopupPriceCents: number | null
}

/** Full credit standing for a store: monthly-included pocket + prepaid balance. */
export async function getAiCreditsInfo(
  storeId: string,
  plan: Plan,
): Promise<AiCreditsInfo> {
  const [creditsRow, monthlyUsedMicro] = await Promise.all([
    db.query.aiCredits.findFirst({ where: eq(aiCredits.storeId, storeId) }),
    sumMonthlyUsedMicro(db, storeId),
  ])
  const perMonth = plan.features.aiCreditsPerMonth
  const monthlyIncludedMicro = perMonth === null ? null : perMonth * CREDIT_MICRO
  const monthlyRemainingMicro =
    monthlyIncludedMicro === null
      ? null
      : Math.max(0, monthlyIncludedMicro - monthlyUsedMicro)
  return {
    monthlyIncludedMicro,
    monthlyUsedMicro,
    monthlyRemainingMicro,
    prepaidBalanceMicro: creditsRow?.balanceMicro ?? 0,
    autoTopupEnabled: creditsRow?.autoTopupEnabled ?? false,
    autoTopupThresholdMicro: creditsRow?.autoTopupThresholdMicro ?? null,
    autoTopupCredits: creditsRow?.autoTopupCredits ?? null,
    autoTopupPriceCents: creditsRow?.autoTopupPriceCents ?? null,
  }
}

export type AdvisorCreditCheck = { allowed: boolean; code?: 'credits_exhausted' }

/**
 * Pre-model credit gate — fail-closed. Blocks a new run only when there is no
 * credit left in either pocket. Inert (allows) when no cost basis is configured
 * so a mis-configured deploy never blocks the advisor silently.
 */
export async function checkAdvisorCredits(
  storeId: string,
  plan: Plan,
): Promise<AdvisorCreditCheck> {
  if (getCreditCostBasisUsd() <= 0) return { allowed: true }
  try {
    const info = await getAiCreditsInfo(storeId, plan)
    const monthlyOk =
      info.monthlyRemainingMicro === null || info.monthlyRemainingMicro > 0
    if (monthlyOk || info.prepaidBalanceMicro > 0) return { allowed: true }
    return { allowed: false, code: 'credits_exhausted' }
  } catch (error) {
    log.error(
      'advisor',
      `credit check failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return { allowed: false, code: 'credits_exhausted' }
  }
}

/**
 * Metered, capped, two-pocket debit for ONE model run. Runs inside the onFinish
 * transaction (alongside the assistant-message insert) so accounting and
 * persistence commit atomically. The debit is capped so a whole conversation
 * never costs more than 1 credit, and is spent from the monthly-included pocket
 * first, then the prepaid balance. Idempotent via a UNIQUE dedup key.
 */
export async function recordAdvisorRunDebit(
  tx: Tx,
  params: {
    storeId: string
    conversationId: string
    assistantMessageId: string
    usage: AdvisorUsage
    plan: Plan
  },
): Promise<number> {
  const { storeId, conversationId, assistantMessageId, usage, plan } = params

  const costMicroUsd = runCostMicroUsd(usage)
  const rawCreditsMicro = costMicroUsdToCreditsMicro(costMicroUsd)
  if (rawCreditsMicro <= 0) return 0

  // Serialize all of a store's debits (and guarantee the balance row exists) by
  // locking the ai_credits row up front. This makes the monthly-pocket split and
  // the per-conversation cap race-free across concurrent runs, and guarantees the
  // prepaid decrement always lands (no silent loss when the row was absent).
  await tx
    .insert(aiCredits)
    .values({ storeId })
    .onDuplicateKeyUpdate({ set: { storeId } })
  await tx
    .select({ balanceMicro: aiCredits.balanceMicro })
    .from(aiCredits)
    .where(eq(aiCredits.storeId, storeId))
    .for('update')

  // Read the conversation's accrued total under the lock (fresh) for the cap.
  const conv = await tx.query.aiAdvisorConversations.findFirst({
    where: eq(aiAdvisorConversations.id, conversationId),
    columns: { accruedCreditsMicro: true },
  })

  // Per-conversation cap: never more than 1 credit total.
  const capRemaining = Math.max(
    0,
    CREDIT_MICRO - (conv?.accruedCreditsMicro ?? 0),
  )
  const debitMicro = Math.min(rawCreditsMicro, capRemaining)
  if (debitMicro <= 0) return 0

  // Split across the monthly-included pocket first, then prepaid.
  const perMonth = plan.features.aiCreditsPerMonth
  let fromMonthly = 0
  if (perMonth === null) {
    fromMonthly = debitMicro // unlimited monthly allowance
  } else if (perMonth > 0) {
    const monthlyUsed = await sumMonthlyUsedMicro(tx, storeId)
    const monthlyRemaining = Math.max(0, perMonth * CREDIT_MICRO - monthlyUsed)
    fromMonthly = Math.min(debitMicro, monthlyRemaining)
  }
  const fromPrepaid = debitMicro - fromMonthly

  // Insert the debit row first — the UNIQUE dedup key makes it exactly-once (a
  // retry throws, rolling back the whole tx, so nothing is double-debited).
  await tx.insert(aiCreditDebits).values({
    storeId,
    conversationId,
    dedupKey: `run:${assistantMessageId}`,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    costMicroUsd,
    debitedMicro: debitMicro,
    fromMonthlyMicro: fromMonthly,
    fromPrepaidMicro: fromPrepaid,
  })

  // Bump the conversation accumulator (drives the cap on the next run).
  await tx
    .update(aiAdvisorConversations)
    .set({
      accruedCreditsMicro: sql`${aiAdvisorConversations.accruedCreditsMicro} + ${debitMicro}`,
    })
    .where(eq(aiAdvisorConversations.id, conversationId))

  // Only the prepaid portion touches the stored balance. It may dip slightly
  // negative on the exact run that exhausts the balance (bounded to < 1 credit
  // by the per-conversation cap) rather than cut a reply mid-answer; the
  // shortfall nets against the next top-up.
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
 * Idempotently add prepaid credits to a store (welcome grant or purchase),
 * creating the balance row on demand. Returns false when the dedup key was
 * already applied (safe under duplicate webhook deliveries).
 */
export async function creditAiCredits(params: {
  storeId: string
  credits: number
  type: 'grant' | 'topup' | 'auto_topup' | 'adjustment'
  amountCents?: number
  currency?: string
  dedupKey?: string
  stripeSessionId?: string
  stripePaymentIntentId?: string
  stripeInvoiceId?: string
}): Promise<boolean> {
  const creditsMicro = creditsToMicro(params.credits)
  if (creditsMicro <= 0) return false
  try {
    return await db.transaction(async (tx) => {
      if (params.dedupKey) {
        const existing = await tx.query.aiCreditTransactions.findFirst({
          where: eq(aiCreditTransactions.dedupKey, params.dedupKey),
        })
        if (existing) return false // already credited
      }

      // Ensure the balance row exists (no-op update on conflict), then increment.
      await tx
        .insert(aiCredits)
        .values({ storeId: params.storeId })
        .onDuplicateKeyUpdate({ set: { storeId: params.storeId } })

      const isPurchase = params.type === 'topup' || params.type === 'auto_topup'
      await tx
        .update(aiCredits)
        .set({
          balanceMicro: sql`${aiCredits.balanceMicro} + ${creditsMicro}`,
          totalGrantedMicro:
            params.type === 'grant'
              ? sql`${aiCredits.totalGrantedMicro} + ${creditsMicro}`
              : sql`${aiCredits.totalGrantedMicro}`,
          totalPurchasedMicro: isPurchase
            ? sql`${aiCredits.totalPurchasedMicro} + ${creditsMicro}`
            : sql`${aiCredits.totalPurchasedMicro}`,
          updatedAt: new Date(),
        })
        .where(eq(aiCredits.storeId, params.storeId))

      await tx.insert(aiCreditTransactions).values({
        storeId: params.storeId,
        type: params.type,
        creditsMicro,
        amountCents: params.amountCents ?? 0,
        currency: params.currency ?? 'eur',
        dedupKey: params.dedupKey,
        stripeSessionId: params.stripeSessionId,
        stripePaymentIntentId: params.stripePaymentIntentId,
        stripeInvoiceId: params.stripeInvoiceId,
        status: 'completed',
        completedAt: new Date(),
      })
      return true
    })
  } catch (error) {
    log.error(
      'advisor',
      `creditAiCredits failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return false
  }
}

/** Persist the merchant's off-session auto-top-up configuration. */
export async function updateAutoTopupConfig(
  storeId: string,
  config: {
    enabled: boolean
    thresholdCredits: number
    credits: number
    priceCents: number
  },
): Promise<void> {
  await db
    .insert(aiCredits)
    .values({ storeId })
    .onDuplicateKeyUpdate({ set: { storeId } })
  await db
    .update(aiCredits)
    .set({
      autoTopupEnabled: config.enabled,
      autoTopupThresholdMicro: creditsToMicro(Math.max(0, config.thresholdCredits)),
      autoTopupCredits: config.credits > 0 ? config.credits : null,
      autoTopupPriceCents: config.priceCents > 0 ? config.priceCents : null,
      updatedAt: new Date(),
    })
    .where(eq(aiCredits.storeId, storeId))
}

export type AiCreditTransactionRow = {
  id: string
  type: 'grant' | 'topup' | 'auto_topup' | 'adjustment'
  creditsMicro: number
  amountCents: number
  currency: string
  status: 'pending' | 'completed' | 'failed'
  createdAt: Date
  completedAt: Date | null
}

/** Recent credit acquisitions (grants + purchases) for the dashboard history. */
export async function getAiCreditHistory(
  storeId: string,
  limit = 20,
): Promise<AiCreditTransactionRow[]> {
  const rows = await db
    .select({
      id: aiCreditTransactions.id,
      type: aiCreditTransactions.type,
      creditsMicro: aiCreditTransactions.creditsMicro,
      amountCents: aiCreditTransactions.amountCents,
      currency: aiCreditTransactions.currency,
      status: aiCreditTransactions.status,
      createdAt: aiCreditTransactions.createdAt,
      completedAt: aiCreditTransactions.completedAt,
    })
    .from(aiCreditTransactions)
    .where(eq(aiCreditTransactions.storeId, storeId))
    .orderBy(desc(aiCreditTransactions.createdAt))
    .limit(limit)
  return rows
}
