import { and, desc, eq, isNull } from 'drizzle-orm'

import type { Database } from '@louez/db'
import { apiKeys, type ApiKeyPermissions } from '@louez/db/schema'

import { ApiServiceError } from './errors'

// ============================================================================
// Permission presets for quick API key creation
// ============================================================================

export const API_KEY_PERMISSION_PRESETS = {
  full: {
    reservations: 'write',
    products: 'write',
    customers: 'write',
    categories: 'write',
    payments: 'write',
    analytics: 'read',
    settings: 'write',
  },
  readOnly: {
    reservations: 'read',
    products: 'read',
    customers: 'read',
    categories: 'read',
    payments: 'read',
    analytics: 'read',
    settings: 'read',
  },
  operations: {
    reservations: 'write',
    products: 'read',
    customers: 'write',
    categories: 'read',
    payments: 'write',
    analytics: 'read',
    settings: 'none',
  },
} as const satisfies Record<string, ApiKeyPermissions>

export type ApiKeyPermissionPreset = keyof typeof API_KEY_PERMISSION_PRESETS

// ============================================================================
// Key generation & hashing
// ============================================================================

function randomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const result: string[] = []
  // Use rejection sampling to avoid modulo bias
  const maxValid = 256 - (256 % chars.length)
  while (result.length < length) {
    const bytes = new Uint8Array(length - result.length + 16)
    crypto.getRandomValues(bytes)
    for (const b of bytes) {
      if (b < maxValid && result.length < length) {
        result.push(chars[b % chars.length])
      }
    }
  }
  return result.join('')
}

/**
 * Generate a random API key with a recognizable prefix.
 * Format: lz_{4-char-prefix}_{20-char-random}
 */
function generateApiKey(): { raw: string; prefix: string } {
  const prefix = randomString(4).toLowerCase()
  const secret = randomString(20)
  const raw = `lz_${prefix}_${secret}`
  return { raw, prefix: `lz_${prefix}` }
}

/**
 * Hash an API key using SHA-256 (Web Crypto API).
 */
export async function hashApiKey(raw: string): Promise<string> {
  const data = new TextEncoder().encode(raw)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ============================================================================
// CRUD operations
// ============================================================================

export async function createApiKey(params: {
  db: Database
  storeId: string
  userId: string
  name: string
  permissions: ApiKeyPermissions
  expiresAt?: Date | null
}): Promise<{ id: string; key: string; prefix: string }> {
  const { db, storeId, userId, name, permissions, expiresAt } = params

  const { raw, prefix } = generateApiKey()
  const keyHash = await hashApiKey(raw)

  const [created] = await db
    .insert(apiKeys)
    .values({
      storeId,
      userId,
      name,
      keyPrefix: prefix,
      keyHash,
      permissions,
      expiresAt: expiresAt ?? null,
    })
    .$returningId()

  return { id: created.id, key: raw, prefix }
}

export async function listApiKeys(params: {
  db: Database
  storeId: string
}) {
  return params.db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      permissions: apiKeys.permissions,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
      createdAt: apiKeys.createdAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(
      and(eq(apiKeys.storeId, params.storeId), isNull(apiKeys.revokedAt))
    )
    .orderBy(desc(apiKeys.createdAt))
}

export async function revokeApiKey(params: {
  db: Database
  storeId: string
  keyId: string
}) {
  const result = await params.db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiKeys.id, params.keyId),
        eq(apiKeys.storeId, params.storeId),
        isNull(apiKeys.revokedAt)
      )
    )

  if (result[0].affectedRows === 0) {
    throw new ApiServiceError('NOT_FOUND', 'errors.apiKeyNotFound')
  }
}

/**
 * Validate an API key and return the associated store context.
 * Updates lastUsedAt on successful validation (non-blocking).
 */
export async function validateApiKey(params: {
  db: Database
  rawKey: string
}): Promise<{
  storeId: string
  userId: string
  permissions: ApiKeyPermissions
  apiKeyId: string
} | null> {
  const keyHash = await hashApiKey(params.rawKey)

  const rows = await params.db
    .select({
      id: apiKeys.id,
      storeId: apiKeys.storeId,
      userId: apiKeys.userId,
      permissions: apiKeys.permissions,
      expiresAt: apiKeys.expiresAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  if (row.revokedAt) return null
  if (row.expiresAt && row.expiresAt < new Date()) return null

  // Update lastUsedAt in background (non-blocking)
  void params.db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id))
    .catch(() => {})

  return {
    storeId: row.storeId,
    userId: row.userId,
    permissions: row.permissions,
    apiKeyId: row.id,
  }
}
