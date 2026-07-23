import { and, eq, gte, sql } from 'drizzle-orm'

import { aiCreditDebits, aiCredits, db, storePhoneNumbers } from '@louez/db'

import {
  CREDIT_MICRO,
  getNumberRentalCredits,
  numberRentalCostMicroUsd,
} from '@/lib/ai/pricing'
import { log } from '@/lib/evlog'
import type { Plan } from '@/lib/plans'

/**
 * Monthly rental billing of a PROVISIONED phone number, paid in AI credits.
 * Debited once at activation and once per monthly cycle by the renewal job.
 * Unlike usage debits (which may dip slightly negative to finish a reply), the
 * rental is all-or-nothing: either the full amount is available across the two
 * pockets (monthly-included first, then prepaid) or nothing is debited — an
 * insufficient balance starts the warn → remind → release grace flow instead.
 * The real provider cost (env) is frozen on each debit row, so billed-vs-cost
 * reporting covers the rental line like any usage row.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Whether number rental billing is configured at all (env-driven). */
export function isNumberRentalEnabled(): boolean {
  return getNumberRentalCredits() > 0
}

/** Exactly-once key for one number's billing cycle (ISO day of the cycle anchor). */
export function rentalDedupKey(numberId: string, cycleDate: Date): string {
  return `number:${numberId}:${cycleDate.toISOString().slice(0, 10)}`
}

/**
 * Same day next month, clamped to the target month's length (Jan 31 → Feb 28).
 * Pass `anchorDay` (the cycle's ORIGINAL day-of-month, e.g. the activation day)
 * so a clamped cycle springs back (Feb 28 → Mar 31) instead of drifting
 * earlier forever.
 */
export function addOneMonthClamped(date: Date, anchorDay?: number): Date {
  const year = date.getFullYear()
  const month = date.getMonth()
  const day = anchorDay ?? date.getDate()
  const lastDayOfNextMonth = new Date(year, month + 2, 0).getDate()
  const next = new Date(date)
  next.setFullYear(year, month + 1, Math.min(day, lastDayOfNextMonth))
  return next
}

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

export type NumberRentalDebitResult =
  | 'debited'
  | 'already'
  | 'insufficient'
  | 'disabled'
  /** The number binding no longer exists (released concurrently) — no charge. */
  | 'gone'
  /** Infrastructure failure — NOT a funds problem; retry later, no grace flow. */
  | 'error'

/**
 * Debit one rental cycle inside an existing transaction. Serialized per store
 * by the ai_credits row lock; exactly-once per cycle via the UNIQUE dedup key
 * (pre-checked under the lock, so it returns 'already' instead of throwing).
 * With `requireBindingRow`, the number row is re-checked FOR UPDATE under the
 * same transaction so a concurrent release can never be charged for.
 */
export async function applyNumberRentalDebit(
  tx: Tx,
  params: {
    storeId: string
    numberId: string
    cycleDate: Date
    plan: Plan
    requireBindingRow?: boolean
  },
): Promise<NumberRentalDebitResult> {
  const rentalCredits = getNumberRentalCredits()
  if (rentalCredits <= 0) return 'disabled'
  const rentalMicro = Math.round(rentalCredits * CREDIT_MICRO)
  const dedupKey = rentalDedupKey(params.numberId, params.cycleDate)

  // Lock the store's balance row (creating it on demand) — serializes against
  // every other debit and makes the dedup pre-check race-free.
  await tx
    .insert(aiCredits)
    .values({ storeId: params.storeId })
    .onDuplicateKeyUpdate({ set: { storeId: params.storeId } })
  const [balanceRow] = await tx
    .select({ balanceMicro: aiCredits.balanceMicro })
    .from(aiCredits)
    .where(eq(aiCredits.storeId, params.storeId))
    .for('update')

  if (params.requireBindingRow) {
    const [bindingRow] = await tx
      .select({ id: storePhoneNumbers.id })
      .from(storePhoneNumbers)
      .where(eq(storePhoneNumbers.id, params.numberId))
      .for('update')
    if (!bindingRow) return 'gone'
  }

  const existing = await tx.query.aiCreditDebits.findFirst({
    where: eq(aiCreditDebits.dedupKey, dedupKey),
    columns: { id: true },
  })
  if (existing) return 'already'

  // All-or-nothing across the two pockets: monthly-included first, then prepaid.
  const perMonth = params.plan.features.aiCreditsPerMonth
  let monthlyRemaining: number
  if (perMonth === null) {
    monthlyRemaining = Number.POSITIVE_INFINITY // unlimited allowance
  } else if (perMonth > 0) {
    const monthlyUsed = await sumMonthlyUsedMicro(tx, params.storeId)
    monthlyRemaining = Math.max(0, perMonth * CREDIT_MICRO - monthlyUsed)
  } else {
    monthlyRemaining = 0
  }
  const prepaid = balanceRow?.balanceMicro ?? 0
  if (monthlyRemaining + prepaid < rentalMicro) return 'insufficient'

  const fromMonthly = Math.min(rentalMicro, monthlyRemaining)
  const fromPrepaid = rentalMicro - fromMonthly

  await tx.insert(aiCreditDebits).values({
    storeId: params.storeId,
    conversationId: null,
    kind: 'number_rental',
    dedupKey,
    costMicroUsd: numberRentalCostMicroUsd(),
    debitedMicro: rentalMicro,
    fromMonthlyMicro: fromMonthly,
    fromPrepaidMicro: fromPrepaid,
  })

  if (fromPrepaid > 0) {
    await tx
      .update(aiCredits)
      .set({
        balanceMicro: sql`${aiCredits.balanceMicro} - ${fromPrepaid}`,
        totalUsedMicro: sql`${aiCredits.totalUsedMicro} + ${fromPrepaid}`,
        updatedAt: new Date(),
      })
      .where(eq(aiCredits.storeId, params.storeId))
  }

  return 'debited'
}

/**
 * Standalone-transaction wrapper around applyNumberRentalDebit. Never throws:
 * an infrastructure failure maps to 'error' (NOT 'insufficient'), so callers
 * never mistake a deadlock or outage for a funds problem and start the
 * lose-your-number grace flow on a solvent store.
 */
export async function debitNumberRental(params: {
  storeId: string
  numberId: string
  cycleDate: Date
  plan: Plan
  requireBindingRow?: boolean
}): Promise<NumberRentalDebitResult> {
  try {
    return await db.transaction((tx) => applyNumberRentalDebit(tx, params))
  } catch (error) {
    log.error(
      'phone',
      `number rental debit failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return 'error'
  }
}

/**
 * Whether the store currently has enough credits (both pockets combined) to
 * cover one rental cycle. Used to refuse provisioning upfront with a recharge
 * nudge instead of failing after the purchase.
 */
export async function hasNumberRentalFunds(
  storeId: string,
  plan: Plan,
): Promise<boolean> {
  const rentalCredits = getNumberRentalCredits()
  if (rentalCredits <= 0) return true
  const perMonth = plan.features.aiCreditsPerMonth
  let monthlyRemaining: number
  if (perMonth === null) {
    monthlyRemaining = Number.POSITIVE_INFINITY
  } else if (perMonth > 0) {
    const monthlyUsed = await sumMonthlyUsedMicro(db, storeId)
    monthlyRemaining = Math.max(0, perMonth * CREDIT_MICRO - monthlyUsed)
  } else {
    monthlyRemaining = 0
  }
  const row = await db.query.aiCredits.findFirst({
    where: eq(aiCredits.storeId, storeId),
    columns: { balanceMicro: true },
  })
  const prepaid = row?.balanceMicro ?? 0
  return monthlyRemaining + prepaid >= rentalCredits * CREDIT_MICRO
}
