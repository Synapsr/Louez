import { NextResponse } from 'next/server'
import { processReviewRequests } from '@/lib/review-booster/automation'
import { refreshAllStoresCache, cleanExpiredCache } from '@/lib/google-places/cache'
import { aggregateDailyAnalytics, cleanupOldAnalyticsData } from '@/lib/analytics/aggregation'

/**
 * Unified cron endpoint - called every minute
 *
 * Tasks and their frequencies:
 * - Review requests: every minute (checks for eligible reservations)
 * - Analytics aggregation: daily at 2:00 AM UTC (aggregates yesterday's data)
 * - Google Places cache refresh: every 5 days (day 1, 6, 11, 16, 21, 26 at 3:00 AM UTC)
 * - Analytics cleanup: daily at 3:30 AM UTC (removes raw data older than 90 days)
 * - Cache cleanup: daily at 4:00 AM UTC
 *
 * vercel.json:
 *   "crons": [{ "path": "/api/cron", "schedule": "* * * * *" }]
 *
 * Environment variables:
 * - CRON_SECRET: Required secret to authenticate cron requests
 * - GOOGLE_PLACES_CACHE_TTL_HOURS: Cache TTL in hours (default: 120 = 5 days)
 */
export async function GET(request: Request) {
  // Verify cron secret - required
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const minute = now.getMinutes()
  const hour = now.getHours()
  const day = now.getDate()

  const tasks: string[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: Record<string, any> = {
    timestamp: now.toISOString(),
  }

  try {
    // Review requests: every minute
    tasks.push('review-requests')
    results.reviewRequests = await processReviewRequests()

    // Analytics aggregation: daily at 2:00 AM
    if (hour === 2 && minute === 0) {
      tasks.push('analytics-aggregation')
      results.analyticsAggregation = await aggregateDailyAnalytics()
    }

    // Google Places cache refresh: every 5 days at 3:00 AM
    // Days 1, 6, 11, 16, 21, 26 of each month
    if (hour === 3 && minute === 0 && [1, 6, 11, 16, 21, 26].includes(day)) {
      tasks.push('google-places-refresh')
      results.googlePlacesRefresh = await refreshAllStoresCache()
    }

    // Analytics cleanup: daily at 3:30 AM (removes raw data older than 90 days)
    if (hour === 3 && minute === 30) {
      tasks.push('analytics-cleanup')
      results.analyticsCleanup = await cleanupOldAnalyticsData()
    }

    // Cache cleanup: daily at 4:00 AM
    if (hour === 4 && minute === 0) {
      tasks.push('cache-cleanup')
      const cleaned = await cleanExpiredCache()
      results.cacheCleanup = { cleaned }
    }

    return NextResponse.json({
      success: true,
      tasks,
      ...results,
    })
  } catch (error) {
    console.error('Cron error:', error)
    return NextResponse.json(
      {
        success: false,
        tasks,
        error: error instanceof Error ? error.message : 'Unknown error',
        ...results,
      },
      { status: 500 }
    )
  }
}

export const dynamic = 'force-dynamic'
