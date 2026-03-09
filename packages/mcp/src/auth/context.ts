import type { ApiKeyPermissions } from '@louez/db/schema'

/**
 * Context for an authenticated MCP session.
 * Resolved once at connection time and injected into every tool/resource handler.
 */
export interface McpSessionContext {
  storeId: string
  userId: string
  storeName: string
  permissions: ApiKeyPermissions
  apiKeyId: string
}

type PermissionDomain = keyof ApiKeyPermissions

/**
 * Check if the current session has the required permission level for a domain.
 * Throws if the permission is insufficient.
 */
export function requirePermission(
  ctx: McpSessionContext,
  domain: PermissionDomain,
  level: 'read' | 'write'
): void {
  const perm = ctx.permissions[domain]
  if (perm === 'none') {
    throw new Error(`Permission denied: requires ${domain}:${level}`)
  }
  if (level === 'write' && perm === 'read') {
    throw new Error(`Permission denied: requires ${domain}:write (current: read)`)
  }
}

/**
 * Check if the current session has at least the specified permission level.
 */
export function hasPermission(
  ctx: McpSessionContext,
  domain: PermissionDomain,
  level: 'read' | 'write'
): boolean {
  const perm = ctx.permissions[domain]
  if (perm === 'none') return false
  if (level === 'write' && perm === 'read') return false
  return true
}
