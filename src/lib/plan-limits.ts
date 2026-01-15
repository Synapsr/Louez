import { db } from '@/lib/db'
import { products, reservations, customers, subscriptions } from '@/lib/db/schema'
import { eq, count, and, gte, sql } from 'drizzle-orm'
import { getPlan, getDefaultPlan, type Plan } from '@/lib/plans'
import type { PlanFeatures } from '@/types'

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

/**
 * Get the current plan for a store
 */
export async function getStorePlan(storeId: string): Promise<Plan> {
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.storeId, storeId),
    columns: { planSlug: true, status: true },
  })

  // If no subscription or cancelled, return free plan
  if (!subscription || subscription.status === 'cancelled') {
    return getDefaultPlan()
  }

  const plan = getPlan(subscription.planSlug)
  return plan || getDefaultPlan()
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

// ============================================================================
// Display Limits (for list pages)
// ============================================================================

/**
 * Get the number of items to show before blurring based on plan
 * - Free: shows last N items (older ones blurred)
 * - Pro: shows last M items
 * - Ultra: shows all
 */
export function getDisplayLimit(
  planSlug: string,
  type: 'products' | 'reservations' | 'customers'
): number | null {
  const plan = getPlan(planSlug)
  if (!plan) return 5 // Default to free plan limits

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
    case 'start':
      return 'pro'
    case 'pro':
      return 'ultra'
    default:
      return 'pro'
  }
}
