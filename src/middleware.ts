import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const APP_DOMAIN = process.env.NEXT_PUBLIC_APP_DOMAIN || 'localhost:3000'
// Preview mode: set to a store slug to preview storefront, leave empty for dashboard
const PREVIEW_MODE = process.env.PREVIEW_MODE || ''

function getSubdomain(host: string): string | null {
  // Remove port if present
  const hostname = host.split(':')[0]

  // Handle localhost
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return null
  }

  // Extract subdomain from production domain
  const parts = hostname.split('.')
  const baseDomain = APP_DOMAIN.split(':')[0]
  const baseParts = baseDomain.split('.')

  // If hostname has more parts than base domain, extract subdomain
  if (parts.length > baseParts.length) {
    const subdomain = parts.slice(0, parts.length - baseParts.length).join('.')
    return subdomain
  }

  return null
}

export function middleware(request: NextRequest) {
  const host = request.headers.get('host') || ''
  const subdomain = getSubdomain(host)
  const { pathname } = request.nextUrl

  // Handle API routes - pass through
  if (pathname.startsWith('/api')) {
    return NextResponse.next()
  }

  // Handle static files and Next.js internals
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  ) {
    return NextResponse.next()
  }

  // Dashboard/auth routes should always be accessible (not rewritten to storefront)
  const protectedRoutes = ['/login', '/verify-request', '/register', '/dashboard', '/onboarding', '/invitation']
  const isProtectedRoute = protectedRoutes.some((route) => pathname.startsWith(route))

  // Localhost with PREVIEW_MODE set to a store slug - show storefront
  // But exclude dashboard/auth routes
  if (!subdomain && host.includes('localhost') && PREVIEW_MODE && PREVIEW_MODE !== 'dashboard' && !isProtectedRoute) {
    const url = request.nextUrl.clone()
    url.pathname = `/${PREVIEW_MODE}${pathname}`
    return NextResponse.rewrite(url)
  }

  // Dashboard (app.louez.io or localhost without preview mode)
  // Auth check is done in the dashboard layout, not here
  if (subdomain === 'app' || (!subdomain && host.includes('localhost'))) {
    return NextResponse.next()
  }

  // Storefront ({slug}.louez.io)
  if (subdomain && subdomain !== 'www') {
    // Rewrite to storefront route group with slug
    const url = request.nextUrl.clone()
    url.pathname = `/${subdomain}${pathname}`
    return NextResponse.rewrite(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
}
