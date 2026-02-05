import { NextRequest, NextResponse } from 'next/server'
import { db } from '@louez/db'
import { pageViews, storefrontEvents, stores } from '@louez/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getClientIp } from '@/lib/request'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Validation schemas
const pageViewSchema = z.object({
  type: z.literal('page_view'),
  storeSlug: z.string().min(1),
  sessionId: z.string().uuid(),
  page: z.enum(['home', 'catalog', 'product', 'cart', 'checkout', 'confirmation', 'account', 'rental']),
  productId: z.string().length(21).optional(),
  categoryId: z.string().length(21).optional(),
  referrer: z.string().max(500).optional(),
  device: z.enum(['mobile', 'tablet', 'desktop']).optional(),
})

const eventSchema = z.object({
  type: z.literal('event'),
  storeSlug: z.string().min(1),
  sessionId: z.string().uuid(),
  customerId: z.string().length(21).optional(),
  eventType: z.enum([
    'product_view',
    'add_to_cart',
    'remove_from_cart',
    'update_quantity',
    'checkout_started',
    'checkout_completed',
    'checkout_abandoned',
    'payment_initiated',
    'payment_completed',
    'payment_failed',
    'login_requested',
    'login_completed',
  ]),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const trackingSchema = z.discriminatedUnion('type', [pageViewSchema, eventSchema])

// ===== RATE LIMITING =====
// Dual-layer rate limiting to prevent analytics abuse
// Layer 1: IP-based (primary) - prevents one attacker from flooding the API
// Layer 2: Session-based (secondary) - prevents session abuse within limits

interface RateLimitEntry {
  count: number
  resetAt: number
}

// IP-based rate limiting (primary defense)
const ipRateLimitMap = new Map<string, RateLimitEntry>()
const IP_RATE_LIMIT = 200 // requests per minute per IP (covers multiple tabs/sessions)
const IP_RATE_WINDOW = 60 * 1000 // 1 minute

// Session-based rate limiting (secondary)
const sessionRateLimitMap = new Map<string, RateLimitEntry>()
const SESSION_RATE_LIMIT = 50 // requests per minute per session
const SESSION_RATE_WINDOW = 60 * 1000 // 1 minute

// Maximum entries to prevent memory exhaustion
const MAX_IP_ENTRIES = 10000
const MAX_SESSION_ENTRIES = 50000

/**
 * Check rate limit for a given map
 */
function checkMapRateLimit(
  map: Map<string, RateLimitEntry>,
  key: string,
  limit: number,
  window: number,
  maxEntries: number
): boolean {
  const now = Date.now()
  const record = map.get(key)

  // Prevent memory exhaustion - if at capacity, do aggressive cleanup first
  if (map.size >= maxEntries && !record) {
    const cutoff = now - window
    let cleaned = 0
    for (const [k, v] of map.entries()) {
      if (v.resetAt < cutoff || cleaned < map.size - maxEntries * 0.9) {
        map.delete(k)
        cleaned++
      }
      if (map.size < maxEntries * 0.9) break
    }
    // If still at capacity after cleanup, reject new entries
    if (map.size >= maxEntries) {
      console.warn(`[SECURITY] Rate limit map at capacity (${maxEntries}), rejecting request`)
      return false
    }
  }

  if (!record || now > record.resetAt) {
    map.set(key, { count: 1, resetAt: now + window })
    return true
  }

  if (record.count >= limit) {
    return false
  }

  record.count++
  return true
}

/**
 * Dual-layer rate limit check
 * Returns true if allowed, false if rate limited
 */
function checkRateLimit(ip: string, sessionId: string): { allowed: boolean; reason?: string } {
  // Layer 1: IP-based check (primary)
  if (!checkMapRateLimit(ipRateLimitMap, ip, IP_RATE_LIMIT, IP_RATE_WINDOW, MAX_IP_ENTRIES)) {
    return { allowed: false, reason: 'ip' }
  }

  // Layer 2: Session-based check (secondary)
  if (!checkMapRateLimit(sessionRateLimitMap, sessionId, SESSION_RATE_LIMIT, SESSION_RATE_WINDOW, MAX_SESSION_ENTRIES)) {
    return { allowed: false, reason: 'session' }
  }

  return { allowed: true }
}

// Cleanup old rate limit entries periodically
let lastCleanup = Date.now()
function cleanupRateLimits() {
  const now = Date.now()
  // Only cleanup every minute
  if (now - lastCleanup < 60 * 1000) return
  lastCleanup = now

  for (const [key, value] of ipRateLimitMap.entries()) {
    if (now > value.resetAt) {
      ipRateLimitMap.delete(key)
    }
  }
  for (const [key, value] of sessionRateLimitMap.entries()) {
    if (now > value.resetAt) {
      sessionRateLimitMap.delete(key)
    }
  }
}

// Store ID cache to avoid repeated lookups
const storeIdCache = new Map<string, { id: string; expiresAt: number }>()
const STORE_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

async function getStoreId(slug: string): Promise<string | null> {
  const cached = storeIdCache.get(slug)
  if (cached && Date.now() < cached.expiresAt) {
    return cached.id
  }

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
    columns: { id: true },
  })

  if (store) {
    storeIdCache.set(slug, { id: store.id, expiresAt: Date.now() + STORE_CACHE_TTL })
    return store.id
  }

  return null
}

export async function POST(request: NextRequest) {
  try {
    // Cleanup rate limits periodically (called at beginning of requests)
    cleanupRateLimits()

    const body = await request.json()
    const parsed = trackingSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid data' }, { status: 400 })
    }

    const data = parsed.data

    // Get client IP for rate limiting (supports Cloudflare, Traefik, nginx, etc.)
    const clientIp = getClientIp(request.headers)

    // Dual-layer rate limiting (IP + session)
    const rateCheck = checkRateLimit(clientIp, data.sessionId)
    if (!rateCheck.allowed) {
      // Log rate limit hits for monitoring
      console.warn(`[RATE_LIMIT] /api/track blocked: ip=${clientIp}, session=${data.sessionId.substring(0, 8)}..., reason=${rateCheck.reason}`)
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        {
          status: 429,
          headers: {
            'Retry-After': '60',
          },
        }
      )
    }

    // Get store ID
    const storeId = await getStoreId(data.storeSlug)
    if (!storeId) {
      return NextResponse.json({ error: 'Store not found' }, { status: 404 })
    }

    // Insert data asynchronously (fire-and-forget for performance)
    if (data.type === 'page_view') {
      // Don't await - fire and forget for performance
      db.insert(pageViews)
        .values({
          storeId,
          sessionId: data.sessionId,
          page: data.page,
          productId: data.productId,
          categoryId: data.categoryId,
          referrer: data.referrer,
          device: data.device || 'desktop',
        })
        .catch((err) => console.error('[Analytics] Failed to insert page view:', err))
    } else {
      // Event tracking
      db.insert(storefrontEvents)
        .values({
          storeId,
          sessionId: data.sessionId,
          customerId: data.customerId,
          eventType: data.eventType,
          metadata: data.metadata,
        })
        .catch((err) => console.error('[Analytics] Failed to insert event:', err))
    }

    // Return immediately with 202 Accepted
    return NextResponse.json({ success: true }, { status: 202 })
  } catch (error) {
    console.error('[Analytics] Tracking error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Health check for the tracking endpoint
export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'analytics' }, { status: 200 })
}
