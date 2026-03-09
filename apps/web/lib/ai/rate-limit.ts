/**
 * Database-backed rate limiting for the AI chat endpoint.
 *
 * Limits vary by plan:
 * - Ultra: 20/min, 100/hour, 500/day
 * - Pro:   5/min,  10/hour,  25/day
 * - Free (start): AI chat disabled — prompts upgrade
 *
 * Counts user messages from the ai_chat_messages table using sliding windows.
 * Notifies platform admins via Discord when a limit is hit.
 */

import { db, aiChats, aiChatMessages } from '@louez/db'
import { and, eq, gte, sql } from 'drizzle-orm'

import { getCurrentPlanSlug } from '@/lib/stripe/subscriptions'
import { notifyAiRateLimitHit } from '@/lib/discord/platform-notifications'

type PlanLimits = {
  perMinute: number
  perHour: number
  perDay: number
}

const LIMITS_BY_PLAN: Record<string, PlanLimits> = {
  ultra: { perMinute: 20, perHour: 100, perDay: 500 },
  pro: { perMinute: 5, perHour: 10, perDay: 25 },
}

const MAX_MESSAGE_LENGTH = 10_000

export type RateLimitErrorCode =
  | 'rate_limit:minute'
  | 'rate_limit:hour'
  | 'rate_limit:day'
  | 'upgrade_required'
  | 'message_too_long'

export type RateLimitResult = {
  allowed: boolean
  code?: RateLimitErrorCode
  retryAfter?: number
}

/**
 * Check if user is within rate limits by counting recent messages in DB.
 */
export async function checkRateLimit(
  userId: string,
  storeId: string,
): Promise<RateLimitResult> {
  try {
    // Get the store's plan
    const planSlug = await getCurrentPlanSlug(storeId)

    // Free plan — AI chat not available
    if (!LIMITS_BY_PLAN[planSlug]) {
      return {
        allowed: false,
        code: 'upgrade_required',
      }
    }

    const limits = LIMITS_BY_PLAN[planSlug]
    const now = new Date()
    const oneMinuteAgo = new Date(now.getTime() - 60 * 1000)
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

    // Single query with conditional counts
    const [result] = await db
      .select({
        lastMinute: sql<number>`SUM(CASE WHEN ${aiChatMessages.createdAt} >= ${oneMinuteAgo} THEN 1 ELSE 0 END)`,
        lastHour: sql<number>`SUM(CASE WHEN ${aiChatMessages.createdAt} >= ${oneHourAgo} THEN 1 ELSE 0 END)`,
        lastDay: sql<number>`COUNT(*)`,
      })
      .from(aiChatMessages)
      .innerJoin(aiChats, eq(aiChatMessages.chatId, aiChats.id))
      .where(
        and(
          eq(aiChats.userId, userId),
          eq(aiChats.storeId, storeId),
          eq(aiChatMessages.role, 'user'),
          gte(aiChatMessages.createdAt, oneDayAgo),
        ),
      )

    const lastMinute = Number(result?.lastMinute ?? 0)
    const lastHour = Number(result?.lastHour ?? 0)
    const lastDay = Number(result?.lastDay ?? 0)

    if (lastMinute >= limits.perMinute) {
      await notifyAiRateLimitHit(storeId, userId, 'minute', lastMinute, limits.perMinute)
      return { allowed: false, code: 'rate_limit:minute', retryAfter: 60 }
    }

    if (lastHour >= limits.perHour) {
      await notifyAiRateLimitHit(storeId, userId, 'hour', lastHour, limits.perHour)
      return { allowed: false, code: 'rate_limit:hour', retryAfter: 3600 }
    }

    if (lastDay >= limits.perDay) {
      await notifyAiRateLimitHit(storeId, userId, 'day', lastDay, limits.perDay)
      return { allowed: false, code: 'rate_limit:day', retryAfter: 86400 }
    }

    return { allowed: true }
  } catch (error) {
    // Fail open
    console.error('[AI Rate Limit] Error checking limits:', error)
    return { allowed: true }
  }
}

export function validateMessageLength(content: string): RateLimitResult {
  if (content.length > MAX_MESSAGE_LENGTH) {
    return { allowed: false, code: 'message_too_long' }
  }
  return { allowed: true }
}
