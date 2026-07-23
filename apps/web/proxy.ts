import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { isStandaloneMode } from '@/lib/deployment';
import { isValidReferralCode } from '@/lib/utils/referral';

import { env } from '@/env';

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

const APP_DOMAIN = env.NEXT_PUBLIC_APP_DOMAIN;
const DASHBOARD_SUBDOMAIN = env.NEXT_PUBLIC_DASHBOARD_SUBDOMAIN;
const PREVIEW_STORE_SLUG = env.PREVIEW_STORE_SLUG;

// Routes that should never be rewritten to storefront (dashboard/auth routes)
const DASHBOARD_ROUTES = [
  '/login',
  '/register',
  '/dashboard',
  '/onboarding',
  '/invitation',
  '/multi-store',
  '/admin', // platform-admin area (gated in its layout)
];

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
  const hostname = host.split(':')[0];

  // Localhost and 127.0.0.1 don't support subdomains
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return null;
  }

  // Extract subdomain by comparing with base domain
  const hostParts = hostname.split('.');
  const baseDomain = APP_DOMAIN.split(':')[0];
  const baseParts = baseDomain.split('.');

  // If hostname has more parts than base domain, extract subdomain(s)
  if (hostParts.length > baseParts.length) {
    return hostParts.slice(0, hostParts.length - baseParts.length).join('.');
  }

  return null;
}

/**
 * Check if the pathname is a dashboard/auth route that should not be rewritten.
 */
function isDashboardRoute(pathname: string): boolean {
  return DASHBOARD_ROUTES.some((route) => pathname.startsWith(route));
}

/**
 * Check if the request is for static assets or Next.js internals.
 */
function isStaticAsset(pathname: string): boolean {
  return (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  );
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

function createInternalRewriteUrl(request: NextRequest, pathname: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;

  if (isLoopbackHost(url.hostname)) {
    url.protocol = 'http:';
  }

  return url;
}

// =============================================================================
// STANDALONE STORE RESOLUTION
// =============================================================================

// The middleware cannot query the database, so standalone mode resolves the
// instance's storefront slug through an internal API route over loopback.
// A found slug is cached briefly (the TTL also bounds how long a renamed
// slug serves 404s); a missing store is never cached, so the root flips to
// the storefront on the first request after onboarding.
const STANDALONE_SLUG_TTL_MS = 15_000;
let standaloneSlugCache: { slug: string; expiresAt: number } | null = null;

async function getStandaloneStoreSlug(): Promise<string | null> {
  if (standaloneSlugCache && Date.now() < standaloneSlugCache.expiresAt) {
    return standaloneSlugCache.slug;
  }

  try {
    const port = process.env.PORT ?? '3000';
    const response = await fetch(
      `http://127.0.0.1:${port}/api/standalone/store`,
      { cache: 'no-store' },
    );
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { slug?: string };
    if (!data.slug) {
      return null;
    }

    standaloneSlugCache = {
      slug: data.slug,
      expiresAt: Date.now() + STANDALONE_SLUG_TTL_MS,
    };
    return data.slug;
  } catch {
    // On any failure the dashboard stays reachable and the storefront
    // recovers on a later request — never take the instance down from here.
    return null;
  }
}

// =============================================================================
// REFERRAL ATTRIBUTION
// =============================================================================

const REFERRAL_COOKIE = 'louez_referral';
const REFERRAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30-day attribution window

/**
 * Cross-subdomain cookie domain so a referral captured on the marketing site (the apex,
 * e.g. louez.io) or any *.louez.io surface survives the hop to the dashboard
 * (app.louez.io). Omitted on localhost — browsers reject domain=localhost.
 */
function referralCookieDomain(host: string): string | undefined {
  const hostname = host.split(':')[0].toLowerCase();
  const baseDomain = APP_DOMAIN.split(':')[0].toLowerCase();
  if (isLoopbackHost(hostname) || isLoopbackHost(baseDomain)) return undefined;
  if (hostname === baseDomain || hostname.endsWith(`.${baseDomain}`)) {
    return `.${baseDomain}`;
  }
  return undefined;
}

/**
 * Capture a `?ref=` referral code server-side (last-click) onto the shared louez_referral
 * cookie, so attribution survives any entry URL and the OAuth round-trip. No-op when there
 * is no valid code. Edge-safe (pure regex validation). The cookie is consumed and deleted
 * at onboarding, where the self-referral guard and DB lookup live.
 */
function captureReferral(
  request: NextRequest,
  response: NextResponse,
  host: string,
): NextResponse {
  const ref = request.nextUrl.searchParams.get('ref');
  if (ref && isValidReferralCode(ref)) {
    response.cookies.set(REFERRAL_COOKIE, ref, {
      maxAge: REFERRAL_COOKIE_MAX_AGE,
      path: '/',
      sameSite: 'lax',
      httpOnly: true,
      secure: !isLoopbackHost(host.split(':')[0]),
      domain: referralCookieDomain(host),
    });
  }
  return response;
}

export async function proxy(request: NextRequest) {
  const host = request.headers.get('host') || '';
  const subdomain = getSubdomain(host);
  const { pathname } = request.nextUrl;

  // -----------------------------------------------------------------------------
  // 1. PASS THROUGH: API routes, PostHog ingest proxy, and static assets
  // -----------------------------------------------------------------------------
  // /ingest must reach the next.config.ts rewrites untouched: rewriting it to
  // /{slug}/ingest on storefront subdomains 404s every PostHog capture call.
  if (
    pathname.startsWith('/api') ||
    pathname.startsWith('/ingest') ||
    isStaticAsset(pathname)
  ) {
    return NextResponse.next();
  }

  // -----------------------------------------------------------------------------
  // 2. STANDALONE: single store on a single origin (the default mode)
  // -----------------------------------------------------------------------------
  // The instance's storefront is served at the root of whatever host it runs
  // on; dashboard/auth routes stay reachable by path. Platform deployments
  // (LOUEZ_MODE=platform) skip this branch entirely, and referral capture is
  // deliberately absent here — the referral program is platform machinery.
  if (isStandaloneMode()) {
    if (isDashboardRoute(pathname)) {
      return NextResponse.next();
    }

    const slug = await getStandaloneStoreSlug();
    if (!slug) {
      // Fresh install: no onboarded store yet. Fall through to the dashboard
      // root, which walks the visitor to /login and /onboarding.
      return NextResponse.next();
    }

    const url = createInternalRewriteUrl(request, `/${slug}${pathname}`);
    const response = NextResponse.rewrite(url);

    // Set embed mode header for embed routes (used by layout to skip chrome)
    if (pathname === '/embed' || pathname.startsWith('/embed/')) {
      response.headers.set('x-embed-mode', '1');
    }

    return response;
  }

  // -----------------------------------------------------------------------------
  // 3. LOCAL DEVELOPMENT: Preview a storefront without subdomains
  // -----------------------------------------------------------------------------
  // When running locally with PREVIEW_STORE_SLUG set, rewrite to that store's
  // storefront (except for dashboard routes which should remain accessible).
  const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1');

  if (
    isLocalhost &&
    !subdomain &&
    PREVIEW_STORE_SLUG &&
    !isDashboardRoute(pathname)
  ) {
    const url = createInternalRewriteUrl(
      request,
      `/${PREVIEW_STORE_SLUG}${pathname}`,
    );
    const response = NextResponse.rewrite(url);

    // Set embed mode header for embed routes
    if (pathname === '/embed' || pathname.startsWith('/embed/')) {
      response.headers.set('x-embed-mode', '1');
    }

    return captureReferral(request, response, host);
  }

  // -----------------------------------------------------------------------------
  // 4. DASHBOARD: Configured subdomain or localhost without preview mode
  // -----------------------------------------------------------------------------
  // Dashboard is served from:
  //   - {DASHBOARD_SUBDOMAIN}.{APP_DOMAIN} (e.g., app.example.com)
  //   - localhost (when PREVIEW_STORE_SLUG is not set)
  if (subdomain === DASHBOARD_SUBDOMAIN || (isLocalhost && !subdomain)) {
    return captureReferral(request, NextResponse.next(), host);
  }

  // -----------------------------------------------------------------------------
  // 5. STOREFRONT: Any other subdomain becomes a store slug
  // -----------------------------------------------------------------------------
  // {slug}.{APP_DOMAIN} → rewrite to /{slug}/* routes
  // Excludes "www" which should show the landing page
  if (subdomain && subdomain !== 'www') {
    const url = createInternalRewriteUrl(request, `/${subdomain}${pathname}`);
    const response = NextResponse.rewrite(url);

    // Set embed mode header for embed routes (used by layout to skip chrome)
    if (pathname === '/embed' || pathname.startsWith('/embed/')) {
      response.headers.set('x-embed-mode', '1');
    }

    return captureReferral(request, response, host);
  }

  // -----------------------------------------------------------------------------
  // 6. DEFAULT: Pass through (landing page, www, etc.)
  // -----------------------------------------------------------------------------
  return captureReferral(request, NextResponse.next(), host);
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
};
