import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { AppRouter } from '@louez/api'
import type { RouterClient } from '@orpc/server'
import { env } from '@/env'

/**
 * Extract store slug from subdomain (preferred for production and local subdomain dev)
 */
function getStoreSlugFromHost(): string | null {
  if (typeof window === 'undefined') return null

  const hostname = window.location.hostname
  const hostParts = hostname.split('.')
  const appDomain = env.NEXT_PUBLIC_APP_DOMAIN.split(':')[0]
  const domainParts = appDomain.split('.')

  // If hostname has more parts than base domain, extract subdomain.
  // Example: teo-org-2.localhost vs localhost -> teo-org-2
  if (hostParts.length > domainParts.length) {
    const candidate = hostParts.slice(0, hostParts.length - domainParts.length).join('.')
    const excludedSubdomains = ['www', env.NEXT_PUBLIC_DASHBOARD_SUBDOMAIN]
    if (candidate && !excludedSubdomains.includes(candidate)) {
      return candidate
    }
  }

  return null
}

/**
 * Extract store slug from pathname fallback (used for localhost path-based routing)
 */
function getStoreSlugFromPath(): string | null {
  if (typeof window === 'undefined') return null

  const pathname = window.location.pathname
  const match = pathname.match(/^\/([a-zA-Z0-9-]+)/)
  if (!match) return null

  const potentialSlug = match[1]
  const excludedPaths = [
    'dashboard',
    'login',
    'api',
    'verify-request',
    'onboarding',
    'invitation',
    'multi-store',
    '_next',
    'rental',
    'catalog',
    'checkout',
    'legal',
    'product',
    'terms',
    'account',
    'confirmation',
    'authorize-deposit',
    'review',
    'r',
  ]

  if (!excludedPaths.includes(potentialSlug)) {
    return potentialSlug
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
    // Include store slug header for storefront routes.
    // Prefer subdomain resolution to avoid mis-detecting routes like /rental as slug.
    const storeSlug = getStoreSlugFromHost() || getStoreSlugFromPath()
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
