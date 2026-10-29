import { type Transaction, db } from '@louez/db'
import {
  products,
  reservations,
  customers,
  subscriptions,
  storeMembers,
  smsLogs,
  smsCredits,
} from '@louez/db'
import { eq, count, and, gte, sql } from 'drizzle-orm'
import { isBillingEnabled } from '@/lib/billing/mode'
import { getPlan, getDefaultPlan, getPayAsYouGoPlan, SMS_TOPUP_PRICING, type Plan } from '@/lib/plans'

// ============================================================================
// Types
// ============================================================================

export interface StoreUsage {
  products: number
  reservationsThisMonth: number
  customers: number
}

export interface LimitStatus {
  current: number
  limit: number | null // null = unlimited
  isAtLimit: boolean
  isOverLimit: boolean
  remaining: number | null // null = unlimited
  percentUsed: number // 0-100, capped at 100 for unlimited
}

export interface StoreLimits {
  products: LimitStatus
  reservationsThisMonth: LimitStatus
  customers: LimitStatus
}

// ============================================================================
// Usage Queries
// ============================================================================

/** The columns of a store's `subscriptions` row that say which plan it is on. */
export type PlanRow = Pick<
  typeof subscriptions.$inferSelect,
  'billingMode' | 'planSlug' | 'status' | 'stripeSubscriptionId'
>

/** A row whose plan is in force (planInForce). */
export type PlanInForceRow<Row extends PlanRow> = Row & {
  readonly billingMode: 'subscription'
  readonly status: 'active' | 'trialing' | 'past_due'
  readonly stripeSubscriptionId: string
}

/**
 * Whether a Louez plan is in force on the row (louez-billing docs/api, README §8.7):
 * subscription billing, a status other than `cancelled`, a plan Louez knows, and a
 * Stripe subscription that bills it. The `store` snapshot sends the plan only then.
 * On every row with a Stripe subscription id it agrees with getStorePlan, which also
 * gives a plan's limits to a row the platform admin set to subscription billing.
 */
export function planInForce<Row extends PlanRow>(
  row: Row | null | undefined,
): row is PlanInForceRow<Row> {
  return (
    row !== null &&
    row !== undefined &&
    row.billingMode === 'subscription' &&
    row.status !== 'cancelled' &&
    Boolean(row.stripeSubscriptionId) &&
    getPlan(row.planSlug) !== undefined
  )
}

/**
 * The slug of the plan in force on the row (planInForce), or null. It is all the billing
 * service reads of the store snapshot's plan to issue a version of the store's policy
 * (louez-billing docs/api, README §8.7): a status, period or cancellation change that
 * keeps the plan in force issues none.
 */
export function planInForceSlug(row: PlanRow | null | undefined): string | null {
  return planInForce(row) ? row.planSlug : null
}

/**
 * The plan in force on the store's row (planInForceSlug), read in `tx` with the row
 * locked, so a concurrent write waits. Read before and after a write in the same
 * transaction, it tells whether the write started, changed or ended the plan, the one
 * kind of write that calls syncPlanSoon (lib/billing-sync/plan-sync-soon.ts). Call it
 * once the row exists: a locking read of a missing row takes a gap lock, and two
 * transactions that then insert it deadlock.
 */
export async function lockPlanInForce(tx: Transaction, storeId: string): Promise<string | null> {
  const [row] = await tx
    .select({
      billingMode: subscriptions.billingMode,
      planSlug: subscriptions.planSlug,
      status: subscriptions.status,
      stripeSubscriptionId: subscriptions.stripeSubscriptionId,
    })
    .from(subscriptions)
    .where(eq(subscriptions.storeId, storeId))
    .for('update')
  return planInForceSlug(row)
}

/** The plan a store's row gives, with platform billing on (getStorePlan). */
export function storePlanOfRow(
  row: Pick<PlanRow, 'billingMode' | 'planSlug' | 'status'> | null | undefined,
): Plan {
  // Pay-as-you-go stores get the unlimited PAYG plan regardless of plan slug.
  if (row?.billingMode === 'pay_as_you_go') {
    return getPayAsYouGoPlan()
  }

  // No subscription or a cancelled one → no paid tier active, fall back to the
  // default plan (pay-as-you-go: unlimited, billed per rental, no monthly fee).
  if (!row || row.status === 'cancelled') {
    return getDefaultPlan()
  }

  return getPlan(row.planSlug) || getDefaultPlan()
}

/**
 * Get the current plan for a store. Without platform billing (LOUEZ_BILLING off) a store
 * has no plan to buy, so every store gets the unlimited pay-as-you-go plan, whatever row
 * an earlier version left: no limit, no blur and no upgrade prompt.
 */
export async function getStorePlan(storeId: string): Promise<Plan> {
  if (!isBillingEnabled()) return getPayAsYouGoPlan()

  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.storeId, storeId),
    columns: { planSlug: true, status: true, billingMode: true },
  })
  return storePlanOfRow(subscription)
}

/**
 * Get current usage statistics for a store
 */
export async function getStoreUsage(storeId: string): Promise<StoreUsage> {
  // Get start of current month for reservation count
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

  const [productsCount, reservationsCount, customersCount] = await Promise.all([
    // Count all products (not archived)
    db
      .select({ count: count() })
      .from(products)
      .where(
        and(
          eq(products.storeId, storeId),
          sql`${products.status} != 'archived'`
        )
      )
      .then((res) => res[0]?.count || 0),

    // Count reservations this month (excluding cancelled/rejected)
    db
      .select({ count: count() })
      .from(reservations)
      .where(
        and(
          eq(reservations.storeId, storeId),
          gte(reservations.createdAt, startOfMonth),
          sql`${reservations.status} NOT IN ('cancelled', 'rejected')`
        )
      )
      .then((res) => res[0]?.count || 0),

    // Count all customers
    db
      .select({ count: count() })
      .from(customers)
      .where(eq(customers.storeId, storeId))
      .then((res) => res[0]?.count || 0),
  ])

  return {
    products: productsCount,
    reservationsThisMonth: reservationsCount,
    customers: customersCount,
  }
}

/**
 * Calculate limit status for a specific metric
 */
function calculateLimitStatus(current: number, limit: number | null): LimitStatus {
  if (limit === null) {
    // Unlimited
    return {
      current,
      limit: null,
      isAtLimit: false,
      isOverLimit: false,
      remaining: null,
      percentUsed: 0,
    }
  }

  const remaining = Math.max(0, limit - current)
  const percentUsed = limit > 0 ? Math.min(100, Math.round((current / limit) * 100)) : 0

  return {
    current,
    limit,
    isAtLimit: current >= limit,
    isOverLimit: current > limit,
    remaining,
    percentUsed,
  }
}

/**
 * Get complete limit status for a store
 */
export async function getStoreLimits(storeId: string): Promise<StoreLimits> {
  const [plan, usage] = await Promise.all([
    getStorePlan(storeId),
    getStoreUsage(storeId),
  ])

  return {
    products: calculateLimitStatus(usage.products, plan.features.maxProducts),
    reservationsThisMonth: calculateLimitStatus(
      usage.reservationsThisMonth,
      plan.features.maxReservationsPerMonth
    ),
    customers: calculateLimitStatus(usage.customers, plan.features.maxCustomers),
  }
}

// ============================================================================
// Quick Checks (for actions/guards)
// ============================================================================

/**
 * Check if a store can create a new product
 */
export async function canCreateProduct(storeId: string): Promise<{
  allowed: boolean
  current: number
  limit: number | null
}> {
  const limits = await getStoreLimits(storeId)
  return {
    allowed: !limits.products.isAtLimit,
    current: limits.products.current,
    limit: limits.products.limit,
  }
}

/**
 * Check if a store can create a new reservation
 */
export async function canCreateReservation(storeId: string): Promise<{
  allowed: boolean
  current: number
  limit: number | null
}> {
  const limits = await getStoreLimits(storeId)
  return {
    allowed: !limits.reservationsThisMonth.isAtLimit,
    current: limits.reservationsThisMonth.current,
    limit: limits.reservationsThisMonth.limit,
  }
}

/**
 * Check if a store can add a new customer
 */
export async function canCreateCustomer(storeId: string): Promise<{
  allowed: boolean
  current: number
  limit: number | null
}> {
  const limits = await getStoreLimits(storeId)
  return {
    allowed: !limits.customers.isAtLimit,
    current: limits.customers.current,
    limit: limits.customers.limit,
  }
}

/**
 * Check if a store can add a new team member (collaborator)
 * Note: Only counts members with role 'member', not 'owner'
 */
export async function canAddTeamMember(storeId: string): Promise<{
  allowed: boolean
  current: number
  limit: number | null
}> {
  const [plan, collaboratorCount] = await Promise.all([
    getStorePlan(storeId),
    db
      .select({ count: count() })
      .from(storeMembers)
      .where(
        and(
          eq(storeMembers.storeId, storeId),
          eq(storeMembers.role, 'member')
        )
      )
      .then((res) => res[0]?.count || 0),
  ])

  const limit = plan.features.maxCollaborators

  // null means unlimited, 0 means no collaborators allowed
  if (limit === null) {
    return { allowed: true, current: collaboratorCount, limit: null }
  }

  return {
    allowed: collaboratorCount < limit,
    current: collaboratorCount,
    limit,
  }
}

/**
 * Get the number of SMS sent this month for a store
 */
export async function getSmsUsageThisMonth(storeId: string): Promise<number> {
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

  const result = await db
    .select({ count: count() })
    .from(smsLogs)
    .where(
      and(
        eq(smsLogs.storeId, storeId),
        gte(smsLogs.sentAt, startOfMonth),
        // Only count successfully sent SMS
        sql`${smsLogs.status} = 'sent'`
      )
    )

  return result[0]?.count || 0
}

/**
 * Get the prepaid SMS credit balance for a store
 */
export async function getSmsPrepaidBalance(storeId: string): Promise<number> {
  const credits = await db.query.smsCredits.findFirst({
    where: eq(smsCredits.storeId, storeId),
  })
  return credits?.balance ?? 0
}

/**
 * Get full SMS credits info for a store
 */
export async function getSmsCreditsInfo(storeId: string): Promise<{
  balance: number
  totalPurchased: number
  totalUsed: number
}> {
  const credits = await db.query.smsCredits.findFirst({
    where: eq(smsCredits.storeId, storeId),
  })
  return {
    balance: credits?.balance ?? 0,
    totalPurchased: credits?.totalPurchased ?? 0,
    totalUsed: credits?.totalUsed ?? 0,
  }
}

/**
 * Extended SMS status including prepaid credits
 */
export interface SmsQuotaStatus {
  allowed: boolean
  current: number // SMS sent this month
  planLimit: number | null // Monthly limit from plan
  prepaidBalance: number // Available prepaid credits
  totalAvailable: number // planLimit + prepaidBalance
  planSlug: string
  canTopup: boolean // Whether the plan allows top-ups
  topupPriceCents: number | null // Price per SMS for top-up (in cents)
}

/**
 * Check if a store can send an SMS based on plan limits + prepaid credits
 * Returns detailed info for UI display
 */
export async function canSendSms(storeId: string): Promise<{
  allowed: boolean
  current: number
  limit: number | null
  planSlug: string
}> {
  const status = await getSmsQuotaStatus(storeId)

  return {
    allowed: status.allowed,
    current: status.current,
    limit: status.planLimit,
    planSlug: status.planSlug,
  }
}

/**
 * Get full SMS quota status including prepaid credits
 * This is the main function to use for the SMS page UI
 */
export async function getSmsQuotaStatus(storeId: string): Promise<SmsQuotaStatus> {
  const [plan, smsCount, prepaidBalance] = await Promise.all([
    getStorePlan(storeId),
    getSmsUsageThisMonth(storeId),
    getSmsPrepaidBalance(storeId),
  ])

  // Without platform billing the operator pays its own SMS provider: Louez sets no quota
  // and sells no top-up.
  if (!isBillingEnabled()) {
    return {
      allowed: true,
      current: smsCount,
      planLimit: null,
      prepaidBalance,
      totalAvailable: Infinity,
      planSlug: plan.slug,
      canTopup: false,
      topupPriceCents: null,
    }
  }

  const planLimit = plan.features.maxSmsPerMonth
  const topupPriceCents = SMS_TOPUP_PRICING[plan.slug] ?? null
  const canTopup = topupPriceCents !== null

  // Calculate total available SMS (plan limit + prepaid)
  // If plan limit is null (unlimited), we don't need prepaid
  if (planLimit === null) {
    return {
      allowed: true,
      current: smsCount,
      planLimit: null,
      prepaidBalance,
      totalAvailable: Infinity,
      planSlug: plan.slug,
      canTopup,
      topupPriceCents,
    }
  }

  // Total available = plan monthly limit + prepaid balance
  const totalAvailable = planLimit + prepaidBalance
  const allowed = smsCount < totalAvailable

  return {
    allowed,
    current: smsCount,
    planLimit,
    prepaidBalance,
    totalAvailable,
    planSlug: plan.slug,
    canTopup,
    topupPriceCents,
  }
}

/**
 * Determine where to deduct SMS credit from (plan or prepaid)
 * Returns 'plan' if within monthly limit, 'topup' if using prepaid
 */
export async function determineSmsSource(storeId: string): Promise<'plan' | 'topup'> {
  // No quota without platform billing, so prepaid credits are never drawn.
  if (!isBillingEnabled()) return 'plan'

  const [plan, smsCount] = await Promise.all([
    getStorePlan(storeId),
    getSmsUsageThisMonth(storeId),
  ])

  const planLimit = plan.features.maxSmsPerMonth

  // If unlimited plan or still within plan limit, use plan
  if (planLimit === null || smsCount < planLimit) {
    return 'plan'
  }

  // Otherwise, use prepaid credits
  return 'topup'
}

/**
 * Deduct one SMS credit from prepaid balance
 * Call this after successfully sending an SMS that used prepaid credits
 */
export async function deductPrepaidSmsCredit(storeId: string): Promise<boolean> {
  const credits = await db.query.smsCredits.findFirst({
    where: eq(smsCredits.storeId, storeId),
  })

  if (!credits || credits.balance <= 0) {
    return false
  }

  await db
    .update(smsCredits)
    .set({
      balance: sql`${smsCredits.balance} - 1`,
      totalUsed: sql`${smsCredits.totalUsed} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(smsCredits.storeId, storeId))

  return true
}

// ============================================================================
// Display Limits (for list pages)
// ============================================================================

/**
 * Get the number of items to show before blurring based on plan
 * - Pro: shows last M items
 * - Ultra / pay-as-you-go: shows all (unlimited)
 */
export function getDisplayLimit(
  planSlug: string,
  type: 'products' | 'reservations' | 'customers'
): number | null {
  // Unknown / pay-as-you-go slug → unlimited (PAYG default), never the old free cap.
  const plan = getPlan(planSlug) ?? getPayAsYouGoPlan()

  switch (type) {
    case 'products':
      return plan.features.maxProducts
    case 'reservations':
      return plan.features.maxReservationsPerMonth
    case 'customers':
      return plan.features.maxCustomers
  }
}

/**
 * Get suggested plan for upgrade based on current plan
 */
export function getSuggestedUpgradePlan(currentPlanSlug: string): string {
  switch (currentPlanSlug) {
    case 'pro':
      return 'ultra'
    default:
      return 'pro'
  }
}
