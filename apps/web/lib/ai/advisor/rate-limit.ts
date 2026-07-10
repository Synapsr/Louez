/**
 * Rate limiting for the storefront AI advisor — anonymous, public traffic.
 *
 * Three layers, all fail-closed:
 * - per IP: in-memory sliding window (fast pre-check, mirrors /api/track)
 * - per conversation: 30 user messages per rolling day (DB-backed)
 * - per store: 500 user messages per rolling day by default (DB-backed,
 *   override with AI_ADVISOR_DAILY_STORE_LIMIT) — protects token spend.
 */

import { and, eq, gte, sql } from 'drizzle-orm'

import { aiAdvisorMessages, db } from '@louez/db'

import { env } from '@/env'
import { log } from '@/lib/evlog'

const IP_LIMIT_PER_MINUTE = 10
const CONVERSATION_LIMIT_PER_DAY = 30
const DEFAULT_STORE_LIMIT_PER_DAY = 500
const MAX_IP_ENTRIES = 10_000

export type AdvisorRateLimitCode =
  | 'rate_limit:ip'
  | 'rate_limit:conversation'
  | 'rate_limit:store'

export type AdvisorRateLimitResult = {
  allowed: boolean
  code?: AdvisorRateLimitCode
  retryAfter?: number
}

const ipWindows = new Map<string, { count: number; resetAt: number }>()

function checkIpWindow(ip: string): boolean {
  const now = Date.now()

  if (ipWindows.size > MAX_IP_ENTRIES) {
    for (const [key, value] of ipWindows) {
      if (value.resetAt <= now) ipWindows.delete(key)
    }
    // Still saturated after cleanup — refuse rather than grow unbounded.
    if (ipWindows.size > MAX_IP_ENTRIES) return false
  }

  const window = ipWindows.get(ip)
  if (!window || window.resetAt <= now) {
    ipWindows.set(ip, { count: 1, resetAt: now + 60_000 })
    return true
  }

  window.count += 1
  return window.count <= IP_LIMIT_PER_MINUTE
}

export async function checkAdvisorRateLimit(params: {
  storeId: string
  conversationId: string | null
  ip: string
}): Promise<AdvisorRateLimitResult> {
  const { storeId, conversationId, ip } = params

  if (!checkIpWindow(ip)) {
    return { allowed: false, code: 'rate_limit:ip', retryAfter: 60 }
  }

  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const storeLimit =
      env.AI_ADVISOR_DAILY_STORE_LIMIT ?? DEFAULT_STORE_LIMIT_PER_DAY

    const [result] = await db
      .select({
        storeCount: sql<number>`COUNT(*)`.mapWith(Number),
        conversationCount: conversationId
          ? sql<number>`SUM(CASE WHEN ${aiAdvisorMessages.conversationId} = ${conversationId} THEN 1 ELSE 0 END)`.mapWith(
              Number,
            )
          : sql<number>`0`.mapWith(Number),
      })
      .from(aiAdvisorMessages)
      .where(
        and(
          eq(aiAdvisorMessages.storeId, storeId),
          eq(aiAdvisorMessages.role, 'user'),
          gte(aiAdvisorMessages.createdAt, oneDayAgo),
        ),
      )

    if ((result?.conversationCount ?? 0) >= CONVERSATION_LIMIT_PER_DAY) {
      return {
        allowed: false,
        code: 'rate_limit:conversation',
        retryAfter: 3600,
      }
    }

    if ((result?.storeCount ?? 0) >= storeLimit) {
      return { allowed: false, code: 'rate_limit:store', retryAfter: 3600 }
    }

    return { allowed: true }
  } catch (error) {
    // Fail closed — block requests when rate limiting is unavailable.
    log.error(
      'advisor',
      `rate limit check failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    return { allowed: false, code: 'rate_limit:store', retryAfter: 60 }
  }
}
