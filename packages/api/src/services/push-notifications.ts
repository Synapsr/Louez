import { and, desc, eq } from 'drizzle-orm'

import type { Database } from '@louez/db'
import { pushSubscriptions } from '@louez/db/schema'

/**
 * SHA-256 hex of a push endpoint. MySQL cannot UNIQUE a TEXT column, so the
 * endpoint is deduped on this hash (mirrors hashApiKey in api-keys.ts).
 */
async function hashEndpoint(endpoint: string): Promise<string> {
  const data = new TextEncoder().encode(endpoint)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Upsert a device's push subscription, keyed by endpoint. */
export async function subscribePush(params: {
  db: Database
  userId: string
  storeId: string
  endpoint: string
  p256dh: string
  auth: string
  userAgent?: string | null
}): Promise<{ success: true }> {
  const { db, userId, storeId, endpoint, p256dh, auth, userAgent } = params
  const endpointHash = await hashEndpoint(endpoint)

  await db
    .insert(pushSubscriptions)
    .values({
      userId,
      storeId,
      endpoint,
      endpointHash,
      p256dh,
      auth,
      userAgent: userAgent ?? null,
    })
    .onDuplicateKeyUpdate({
      set: {
        userId,
        storeId,
        p256dh,
        auth,
        userAgent: userAgent ?? null,
        failureCount: 0,
        updatedAt: new Date(),
      },
    })

  return { success: true }
}

/** Remove one of the current user's device subscriptions. */
export async function unsubscribePush(params: {
  db: Database
  userId: string
  endpoint: string
}): Promise<{ success: true }> {
  const endpointHash = await hashEndpoint(params.endpoint)
  await params.db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.endpointHash, endpointHash),
        eq(pushSubscriptions.userId, params.userId),
      ),
    )
  return { success: true }
}

/** List the current user's registered devices (no secret material returned). */
export async function listPushSubscriptions(params: {
  db: Database
  userId: string
}) {
  return params.db
    .select({
      id: pushSubscriptions.id,
      userAgent: pushSubscriptions.userAgent,
      createdAt: pushSubscriptions.createdAt,
      lastSuccessAt: pushSubscriptions.lastSuccessAt,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, params.userId))
    .orderBy(desc(pushSubscriptions.createdAt))
}
