'use server'

import { db } from '@/lib/db'
import { smsLogs, customers, smsTopupTransactions } from '@/lib/db/schema'
import { eq, desc, and, gte, lt, count } from 'drizzle-orm'
import { getCurrentStore, verifyStoreAccess } from '@/lib/store-context'
import { createSmsTopupCheckoutSession, getSmsTopupPrice } from '@/lib/stripe/sms-topup'
import { SMS_TOPUP_PACKAGES, type SmsTopupPackage } from '@/lib/plans'

// ===== INPUT VALIDATION HELPERS =====
// Validate inputs to prevent unauthorized access and parameter manipulation

/**
 * Validate storeId format (21-char nanoid)
 */
function isValidStoreId(storeId: unknown): storeId is string {
  return typeof storeId === 'string' && storeId.length === 21
}

/**
 * Validate year is a reasonable integer (1970-2100)
 */
function isValidYear(year: unknown): year is number {
  return typeof year === 'number' &&
    Number.isInteger(year) &&
    year >= 1970 &&
    year <= 2100
}

/**
 * Validate month is 0-11 (JavaScript Date month)
 */
function isValidMonth(month: unknown): month is number {
  return typeof month === 'number' &&
    Number.isInteger(month) &&
    month >= 0 &&
    month <= 11
}

export interface SmsLog {
  id: string
  to: string
  message: string
  templateType: string
  status: string | null
  error: string | null
  sentAt: Date
  customerName: string | null
}

export interface SmsMonthStats {
  sent: number
  failed: number
  total: number
}

export async function getSmsLogs(
  storeId: string,
  year: number,
  month: number
): Promise<SmsLog[]> {
  // SECURITY: Validate all inputs
  if (!isValidStoreId(storeId) || !isValidYear(year) || !isValidMonth(month)) {
    console.warn('[SECURITY] getSmsLogs called with invalid parameters:', { storeId: storeId?.substring(0, 30), year, month })
    return []
  }

  // SECURITY: Verify user has access to this store
  const role = await verifyStoreAccess(storeId)
  if (!role) {
    console.warn('[SECURITY] getSmsLogs: unauthorized access attempt to store:', storeId)
    return []
  }

  // Get start and end of the selected month
  const startOfMonth = new Date(year, month, 1)
  const endOfMonth = new Date(year, month + 1, 1)

  const logs = await db
    .select({
      id: smsLogs.id,
      to: smsLogs.to,
      message: smsLogs.message,
      templateType: smsLogs.templateType,
      status: smsLogs.status,
      error: smsLogs.error,
      sentAt: smsLogs.sentAt,
      customerId: smsLogs.customerId,
    })
    .from(smsLogs)
    .where(
      and(
        eq(smsLogs.storeId, storeId),
        gte(smsLogs.sentAt, startOfMonth),
        lt(smsLogs.sentAt, endOfMonth)
      )
    )
    .orderBy(desc(smsLogs.sentAt))
    .limit(1000)

  // Get customer names for logs that have customerId
  const customerIds = logs
    .filter((log) => log.customerId)
    .map((log) => log.customerId as string)

  const uniqueCustomerIds = [...new Set(customerIds)]

  let customerMap: Map<string, string> = new Map()

  if (uniqueCustomerIds.length > 0) {
    const customersData = await db
      .select({
        id: customers.id,
        firstName: customers.firstName,
        lastName: customers.lastName,
      })
      .from(customers)
      .where(eq(customers.storeId, storeId))

    customerMap = new Map(
      customersData.map((c) => [c.id, `${c.firstName} ${c.lastName}`.trim()])
    )
  }

  return logs.map((log) => ({
    id: log.id,
    to: log.to,
    message: log.message,
    templateType: log.templateType,
    status: log.status,
    error: log.error,
    sentAt: log.sentAt,
    customerName: log.customerId ? customerMap.get(log.customerId) || null : null,
  }))
}

export async function getSmsMonthStats(
  storeId: string,
  year: number,
  month: number
): Promise<SmsMonthStats> {
  // SECURITY: Validate all inputs
  if (!isValidStoreId(storeId) || !isValidYear(year) || !isValidMonth(month)) {
    console.warn('[SECURITY] getSmsMonthStats called with invalid parameters')
    return { sent: 0, failed: 0, total: 0 }
  }

  // SECURITY: Verify user has access to this store
  const role = await verifyStoreAccess(storeId)
  if (!role) {
    return { sent: 0, failed: 0, total: 0 }
  }

  const startOfMonth = new Date(year, month, 1)
  const endOfMonth = new Date(year, month + 1, 1)

  const result = await db
    .select({
      status: smsLogs.status,
      count: count(),
    })
    .from(smsLogs)
    .where(
      and(
        eq(smsLogs.storeId, storeId),
        gte(smsLogs.sentAt, startOfMonth),
        lt(smsLogs.sentAt, endOfMonth)
      )
    )
    .groupBy(smsLogs.status)

  const sent = result.find((r) => r.status === 'sent')?.count || 0
  const failed = result.find((r) => r.status === 'failed')?.count || 0

  return {
    sent,
    failed,
    total: sent + failed,
  }
}

export async function getAvailableMonths(storeId: string): Promise<{ year: number; month: number }[]> {
  // SECURITY: Validate storeId
  if (!isValidStoreId(storeId)) {
    return []
  }

  // SECURITY: Verify user has access to this store
  const role = await verifyStoreAccess(storeId)
  if (!role) {
    return []
  }

  // Get all distinct months that have SMS logs
  const result = await db
    .selectDistinct({
      sentAt: smsLogs.sentAt,
    })
    .from(smsLogs)
    .where(eq(smsLogs.storeId, storeId))
    .orderBy(desc(smsLogs.sentAt))

  // Extract unique year-month combinations
  const monthsSet = new Set<string>()
  const months: { year: number; month: number }[] = []

  for (const row of result) {
    const date = new Date(row.sentAt)
    const key = `${date.getFullYear()}-${date.getMonth()}`
    if (!monthsSet.has(key)) {
      monthsSet.add(key)
      months.push({ year: date.getFullYear(), month: date.getMonth() })
    }
  }

  // Always include current month even if no SMS
  const now = new Date()
  const currentKey = `${now.getFullYear()}-${now.getMonth()}`
  if (!monthsSet.has(currentKey)) {
    months.unshift({ year: now.getFullYear(), month: now.getMonth() })
  }

  return months.slice(0, 12) // Limit to last 12 months
}

// ============================================================================
// SMS Top-up Actions
// ============================================================================

export interface TopupTransaction {
  id: string
  quantity: number
  unitPriceCents: number
  totalAmountCents: number
  currency: string
  status: 'pending' | 'completed' | 'failed' | 'refunded'
  createdAt: Date
  completedAt: Date | null
}

/**
 * Get top-up price info for the current store
 */
export async function getTopupPriceInfo(): Promise<{
  canTopup: boolean
  priceCents: number | null
  planSlug: string
}> {
  const store = await getCurrentStore()
  if (!store) {
    return { canTopup: false, priceCents: null, planSlug: 'start' }
  }

  return getSmsTopupPrice(store.id)
}

/**
 * Get top-up transaction history for a store
 */
export async function getTopupHistory(storeId: string): Promise<TopupTransaction[]> {
  // SECURITY: Validate storeId
  if (!isValidStoreId(storeId)) {
    return []
  }

  // SECURITY: Verify user has access to this store
  const role = await verifyStoreAccess(storeId)
  if (!role) {
    return []
  }

  const transactions = await db
    .select({
      id: smsTopupTransactions.id,
      quantity: smsTopupTransactions.quantity,
      unitPriceCents: smsTopupTransactions.unitPriceCents,
      totalAmountCents: smsTopupTransactions.totalAmountCents,
      currency: smsTopupTransactions.currency,
      status: smsTopupTransactions.status,
      createdAt: smsTopupTransactions.createdAt,
      completedAt: smsTopupTransactions.completedAt,
    })
    .from(smsTopupTransactions)
    .where(eq(smsTopupTransactions.storeId, storeId))
    .orderBy(desc(smsTopupTransactions.createdAt))
    .limit(50)

  return transactions as TopupTransaction[]
}

// Stripe translations for SMS top-up (hardcoded to avoid i18n caching issues)
const STRIPE_TRANSLATIONS: Record<string, { productName: string; productDescription: string }> = {
  fr: {
    productName: 'Recharge SMS - {quantity} crédits',
    productDescription: 'Pack de {quantity} SMS à {price}€/SMS (Plan {plan})',
  },
  en: {
    productName: 'SMS Top-up - {quantity} credits',
    productDescription: 'Pack of {quantity} SMS at {price}€/SMS ({plan} Plan)',
  },
  de: {
    productName: 'SMS-Aufladung - {quantity} Guthaben',
    productDescription: '{quantity} SMS-Paket zu {price}€/SMS ({plan}-Plan)',
  },
  es: {
    productName: 'Recarga SMS - {quantity} créditos',
    productDescription: 'Pack de {quantity} SMS a {price}€/SMS (Plan {plan})',
  },
  it: {
    productName: 'Ricarica SMS - {quantity} crediti',
    productDescription: 'Pack di {quantity} SMS a {price}€/SMS (Piano {plan})',
  },
  nl: {
    productName: 'SMS-opwaardering - {quantity} tegoed',
    productDescription: 'Pakket van {quantity} SMS voor {price}€/SMS ({plan}-plan)',
  },
  pl: {
    productName: 'Doładowanie SMS - {quantity} kredytów',
    productDescription: 'Pakiet {quantity} SMS po {price}€/SMS (Plan {plan})',
  },
  pt: {
    productName: 'Recarga SMS - {quantity} créditos',
    productDescription: 'Pack de {quantity} SMS a {price}€/SMS (Plano {plan})',
  },
}

/**
 * Create a checkout session for SMS top-up
 */
export async function createTopupCheckout(
  quantity: number,
  locale: string
): Promise<{
  success: boolean
  url?: string
  error?: string
}> {
  const store = await getCurrentStore()
  if (!store) {
    return { success: false, error: 'errors.unauthorized' }
  }

  // Validate quantity is a valid package
  if (!SMS_TOPUP_PACKAGES.includes(quantity as SmsTopupPackage)) {
    return { success: false, error: 'errors.invalidPackage' }
  }

  // Get translations for the locale (fallback to French)
  const translations = STRIPE_TRANSLATIONS[locale] || STRIPE_TRANSLATIONS.fr

  try {
    const result = await createSmsTopupCheckoutSession({
      storeId: store.id,
      quantity: quantity as SmsTopupPackage,
      successUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/sms?topup=success`,
      cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/sms?topup=cancelled`,
      translations,
    })

    return { success: true, url: result.url || undefined }
  } catch (error) {
    console.error('Failed to create top-up checkout:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'errors.checkoutFailed',
    }
  }
}
