import { redirect } from 'next/navigation'

import { isStandaloneMode } from '@/lib/deployment'

import { env } from '@/env'

const APP_DOMAIN = env.NEXT_PUBLIC_APP_DOMAIN

/**
 * Build an absolute storefront URL for server-side redirects.
 *
 * This is the server-side equivalent of the `useStorefrontUrl` client hook.
 * It generates the correct absolute URL based on the deployment environment:
 *
 * Production (subdomain routing):
 *   getStorefrontUrl('ddm', '/account') → 'https://ddm.louez.io/account'
 *
 * Localhost (path-based routing):
 *   getStorefrontUrl('ddm', '/account') → 'http://localhost:3000/ddm/account'
 *
 * Using absolute URLs eliminates ambiguity with the proxy middleware rewrite,
 * which transforms subdomain requests into path-based routes internally.
 * Relative paths in redirect() can cause double-slug issues on subdomains
 * or routing mismatches on localhost.
 *
 * @see src/hooks/use-storefront-url.ts for the client-side equivalent
 * @see src/proxy.ts for the subdomain → path rewrite logic
 */
export function getStorefrontUrl(slug: string, path: string = '/'): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http'

  // Standalone: one store on one origin — the storefront lives at the root of
  // the app URL and the proxy injects the slug internally, so links never
  // carry it. NEXT_PUBLIC_APP_URL is read server-side at runtime, which keeps
  // this correct in the prebuilt Docker image on any domain.
  if (isStandaloneMode()) {
    const appUrl = (env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '')
    return `${appUrl}${normalizedPath}`
  }

  if (APP_DOMAIN.includes('localhost') || APP_DOMAIN.includes('127.0.0.1')) {
    return `${protocol}://${APP_DOMAIN}/${slug}${normalizedPath}`
  }

  return `${protocol}://${slug}.${APP_DOMAIN}${normalizedPath}`
}

/**
 * Redirect to a storefront page with the correct absolute URL.
 *
 * Use this instead of Next.js `redirect()` in storefront server components
 * and route handlers to ensure correct URL generation across environments.
 *
 * @example
 *   // In a server component or route handler:
 *   storefrontRedirect(slug, '/account/login')
 *   storefrontRedirect(slug, '/') // redirect to store homepage
 */
export function storefrontRedirect(slug: string, path: string = '/'): never {
  redirect(getStorefrontUrl(slug, path))
}
