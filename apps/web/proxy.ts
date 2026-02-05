import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { env } from '@/env'

// =============================================================================
// CONFIGURATION
// =============================================================================
// All configuration is done via environment variables for maximum flexibility.
// No domains are hardcoded - this works with any domain setup.
//
// Required:
//   NEXT_PUBLIC_APP_DOMAIN - Your base domain (e.g., "louez.io" or "localhost:3000")
//
// Optional:
//   NEXT_PUBLIC_DASHBOARD_SUBDOMAIN - Subdomain for dashboard (default: "app")
//   PREVIEW_STORE_SLUG - For local dev, show this store's storefront instead of dashboard
// =============================================================================

const APP_DOMAIN = env.NEXT_PUBLIC_APP_DOMAIN
const DASHBOARD_SUBDOMAIN = env.NEXT_PUBLIC_DASHBOARD_SUBDOMAIN
const PREVIEW_STORE_SLUG = env.PREVIEW_STORE_SLUG

// Routes that should never be rewritten to storefront (dashboard/auth routes)
const DASHBOARD_ROUTES = [
  '/login',
  '/verify-request',
  '/register',
  '/dashboard',
  '/onboarding',
  '/invitation',
  '/multi-store',
]

/**
 * Extract subdomain from the host header.
 * Works with any domain configured in APP_DOMAIN.
 *
 * Examples (with APP_DOMAIN="example.com"):
 *   "app.example.com" → "app"
 *   "myboutique.example.com" → "myboutique"
 *   "example.com" → null
 *   "www.example.com" → "www"
 *
 * Examples (with APP_DOMAIN="localhost:3000"):
 *   "localhost:3000" → null (localhost has no subdomains)
 */
function getSubdomain(host: string): string | null {
  // Remove port if present
  const hostname = host.split(':')[0]

  // Localhost and 127.0.0.1 don't support subdomains
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return null
  }

  // Extract subdomain by comparing with base domain
  const hostParts = hostname.split('.')
  const baseDomain = APP_DOMAIN.split(':')[0]
  const baseParts = baseDomain.split('.')

  // If hostname has more parts than base domain, extract subdomain(s)
  if (hostParts.length > baseParts.length) {
    return hostParts.slice(0, hostParts.length - baseParts.length).join('.')
  }

  return null
}

/**
 * Check if the pathname is a dashboard/auth route that should not be rewritten.
 */
function isDashboardRoute(pathname: string): boolean {
  return DASHBOARD_ROUTES.some((route) => pathname.startsWith(route))
}

/**
 * Check if the request is for static assets or Next.js internals.
 */
function isStaticAsset(pathname: string): boolean {
  return (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  )
}

export function proxy(request: NextRequest) {
  const host = request.headers.get('host') || ''
  const subdomain = getSubdomain(host)
  const { pathname } = request.nextUrl

  // -----------------------------------------------------------------------------
  // 1. PASS THROUGH: API routes and static assets
  // -----------------------------------------------------------------------------
  if (pathname.startsWith('/api') || isStaticAsset(pathname)) {
    return NextResponse.next()
  }

  // -----------------------------------------------------------------------------
  // 2. LOCAL DEVELOPMENT: Preview a storefront without subdomains
  // -----------------------------------------------------------------------------
  // When running locally with PREVIEW_STORE_SLUG set, rewrite to that store's
  // storefront (except for dashboard routes which should remain accessible).
  const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1')

  if (isLocalhost && !subdomain && PREVIEW_STORE_SLUG && !isDashboardRoute(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = `/${PREVIEW_STORE_SLUG}${pathname}`
    return NextResponse.rewrite(url)
  }

  // -----------------------------------------------------------------------------
  // 3. DASHBOARD: Configured subdomain or localhost without preview mode
  // -----------------------------------------------------------------------------
  // Dashboard is served from:
  //   - {DASHBOARD_SUBDOMAIN}.{APP_DOMAIN} (e.g., app.example.com)
  //   - localhost (when PREVIEW_STORE_SLUG is not set)
  if (subdomain === DASHBOARD_SUBDOMAIN || (isLocalhost && !subdomain)) {
    return NextResponse.next()
  }

  // -----------------------------------------------------------------------------
  // 4. STOREFRONT: Any other subdomain becomes a store slug
  // -----------------------------------------------------------------------------
  // {slug}.{APP_DOMAIN} → rewrite to /{slug}/* routes
  // Excludes "www" which should show the landing page
  if (subdomain && subdomain !== 'www') {
    const url = request.nextUrl.clone()
    url.pathname = `/${subdomain}${pathname}`
    return NextResponse.rewrite(url)
  }

  // -----------------------------------------------------------------------------
  // 5. DEFAULT: Pass through (landing page, www, etc.)
  // -----------------------------------------------------------------------------
  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api (API routes - handled separately)
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico (favicon)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
}
