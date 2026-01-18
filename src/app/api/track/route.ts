import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { pageViews, storefrontEvents, stores } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Validation schemas
const pageViewSchema = z.object({
  type: z.literal('page_view'),
  storeSlug: z.string().min(1),
  sessionId: z.string().uuid(),
  page: z.enum(['home', 'catalog', 'product', 'cart', 'checkout', 'confirmation', 'account']),
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

// Simple in-memory rate limiting (per session)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT = 100 // requests per minute
const RATE_WINDOW = 60 * 1000 // 1 minute

function checkRateLimit(sessionId: string): boolean {
  const now = Date.now()
  const record = rateLimitMap.get(sessionId)

  if (!record || now > record.resetAt) {
    rateLimitMap.set(sessionId, { count: 1, resetAt: now + RATE_WINDOW })
    return true
  }

  if (record.count >= RATE_LIMIT) {
    return false
  }

  record.count++
  return true
}

// Cleanup old rate limit entries periodically
setInterval(() => {
  const now = Date.now()
  for (const [key, value] of rateLimitMap.entries()) {
    if (now > value.resetAt) {
      rateLimitMap.delete(key)
    }
  }
}, 60 * 1000) // Every minute

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
    const body = await request.json()
    const parsed = trackingSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid data' }, { status: 400 })
    }

    const data = parsed.data

    // Rate limiting
    if (!checkRateLimit(data.sessionId)) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
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
