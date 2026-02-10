import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { AppRouter } from '@louez/api'
import type { RouterClient } from '@orpc/server'
import { env } from '@/env'

/**
 * Extract store slug from the current URL path (for storefront routes)
 * Returns null if not in a storefront context
 */
function getStoreSlugFromPath(): string | null {
  if (typeof window === 'undefined') return null

  const pathname = window.location.pathname
  // Match /{slug}/... pattern (storefront routes)
  // Exclude known app routes like /dashboard, /login, /api, etc.
  const match = pathname.match(/^\/([a-zA-Z0-9-]+)/)
  if (match) {
    const potentialSlug = match[1]
    // Exclude known non-store paths
    const excludedPaths = [
      'dashboard',
      'login',
      'api',
      'verify-request',
      'onboarding',
      '_next',
    ]
    if (!excludedPaths.includes(potentialSlug)) {
      return potentialSlug
    }
  }
  return null
}

/**
 * RPC Link configuration for client-server communication
 */
function getRpcUrl(): string {
  if (typeof window !== 'undefined') {
    return new URL('/api/rpc', window.location.origin).toString()
  }

  return new URL('/api/rpc', env.NEXT_PUBLIC_APP_URL).toString()
}

const link = new RPCLink({
  url: getRpcUrl(),
  headers: () => {
    // Include store slug header for storefront routes
    const storeSlug = getStoreSlugFromPath()
    return storeSlug ? { 'x-store-slug': storeSlug } : {}
  },
  fetch: (input, init) => {
    // Use native fetch with credentials for cookie-based auth
    return globalThis.fetch(input, {
      ...init,
      credentials: 'include',
    })
  },
})

/**
 * Type-safe oRPC client for making API calls
 *
 * Usage:
 * ```ts
 * // Direct call
 * const result = await orpcClient.dashboard.ping({ message: 'hello' })
 *
 * // With TanStack Query (see react.ts)
 * const { data } = useQuery(orpc.dashboard.ping.queryOptions({ input: { message: 'hello' } }))
 * ```
 */
export const orpcClient: RouterClient<AppRouter> = createORPCClient(link)
