'use server'

import { db } from '@/lib/db'
import { smsLogs, customers } from '@/lib/db/schema'
import { eq, desc, and, gte, lt, count } from 'drizzle-orm'

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
