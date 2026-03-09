import { db, stores } from '@louez/db'
import { validateApiKey } from '@louez/api/services'
import { eq } from 'drizzle-orm'

import type { McpSessionContext } from './context'

/**
 * Resolve an API key into a full MCP session context.
 * Returns null if the key is invalid, expired, or revoked.
 */
export async function resolveApiKeyContext(
  rawKey: string
): Promise<McpSessionContext | null> {
  const result = await validateApiKey({ db, rawKey })
  if (!result) return null

  // Load store name for display in resources/prompts
  const store = await db.query.stores.findFirst({
    where: eq(stores.id, result.storeId),
    columns: { name: true },
  })

  if (!store) return null

  return {
    storeId: result.storeId,
    userId: result.userId,
    permissions: result.permissions,
    apiKeyId: result.apiKeyId,
    storeName: store.name,
  }
}
