import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { isStandaloneMode } from "@/lib/deployment";
import { buildEmbedSecurityHeaders, buildSecurityHeaders } from "@/lib/util.security-headers";
import { isValidReferralCode } from "@/lib/utils/referral";
import {
  isKnownSignupOrigin,
  SIGNUP_ORIGIN_COOKIE,
  SIGNUP_ORIGIN_COOKIE_MAX_AGE,
} from "@/lib/utils/signup-origin";
import { LOGIN_CALLBACK_PATH_HEADER } from "@/lib/utils/util.url";
import { readPublicEnvRuntime, type PublicEnv } from "@/lib/validators/validator.public-env";

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

// A published Docker image must pick these up from the container, not the
// builder. Keep the lookup dynamic: Next inlines static NEXT_PUBLIC_* reads at
// build time, and importing the full app env here would validate those frozen
// values as soon as the proxy bundle loads.
const readRuntimeEnv = (name: string): string | undefined => process.env[name];
let runtimePublicEnv: PublicEnv | null = null;

const getRuntimePublicEnv = (): PublicEnv => {
  runtimePublicEnv ??= readPublicEnvRuntime({ readEnv: readRuntimeEnv });
  return runtimePublicEnv;
};

function isEmbedPath(pathname: string): boolean {
  return (
    pathname === "/embed" ||
    pathname.startsWith("/embed/") ||
    /^\/[^/]+\/embed(?:\/|$)/.test(pathname)
  );
}

function withRuntimeSecurityHeaders(
  response: NextResponse,
  pathname: string,
  publicEnv: PublicEnv,
) {
  const options = {
    appDomain: publicEnv.NEXT_PUBLIC_APP_DOMAIN,
    fromHelloApiUrl: publicEnv.NEXT_PUBLIC_FROMHELLO_API_URL,
    isDevelopment: process.env.NODE_ENV === "development",
    openReplayIngestPoint: publicEnv.NEXT_PUBLIC_OPENREPLAY_INGEST_POINT,
  };
  const securityHeaders = isEmbedPath(pathname)
    ? buildEmbedSecurityHeaders(options)
    : buildSecurityHeaders(options);

  for (const { key, value } of securityHeaders) {
    response.headers.set(key, value);
  }

  return response;
}

const SALES_CHANNEL_COOKIE = "louez_channel";
const MARKETPLACE_CHANNEL = "marketplace";

// Routes that should never be rewritten to storefront (dashboard/auth routes)
const DASHBOARD_ROUTES = [
  "/login",
  "/register",
  "/dashboard",
  "/onboarding",
  "/invitation",
  "/multi-store",
  "/admin", // platform-admin area (gated in its layout)
];

/**
 * Extract the subdomain from the host header relative to APP_DOMAIN.
 */
function getSubdomain(host: string, appDomain: string): string | null {
  const hostname = host.split(":")[0];

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return null;
  }

  const hostParts = hostname.split(".");
  const baseDomain = appDomain.split(":")[0];
  const baseParts = baseDomain.split(".");

  if (hostParts.length > baseParts.length) {
    return hostParts.slice(0, hostParts.length - baseParts.length).join(".");
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
  return pathname.startsWith("/_next") || pathname.startsWith("/favicon") || pathname.includes(".");
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function createInternalRewriteUrl(request: NextRequest, pathname: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;

  if (isLoopbackHost(url.hostname)) {
    url.protocol = "http:";
  }

  return url;
}

function createDashboardResponse(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(
    LOGIN_CALLBACK_PATH_HEADER,
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

/** Rewrite a storefront path onto its internal `/{slug}/...` route. */
function createStorefrontRewrite(request: NextRequest, slug: string) {
  const { pathname } = request.nextUrl;
  const url = createInternalRewriteUrl(request, `/${slug}${pathname}`);
  const requestedChannel = request.nextUrl.searchParams.get("channel");
  const hasMarketplaceCookie =
    request.cookies.get(SALES_CHANNEL_COOKIE)?.value === MARKETPLACE_CHANNEL;
  const isMarketplaceChannel =
    requestedChannel === MARKETPLACE_CHANNEL ||
    (requestedChannel !== "direct" && hasMarketplaceCookie);
  const requestHeaders = new Headers(request.headers);

  // Never trust caller-provided mode headers. The proxy derives them from the
  // route, query, and cookie before forwarding the rewritten request upstream.
  requestHeaders.delete("x-embed-mode");
  requestHeaders.delete("x-sales-channel");

  if (isMarketplaceChannel) {
    requestHeaders.set("x-sales-channel", MARKETPLACE_CHANNEL);
  }

  // Embed routes drop the app chrome (used by the layout).
  if (pathname === "/embed" || pathname.startsWith("/embed/")) {
    requestHeaders.set("x-embed-mode", "1");
  }

  const response = NextResponse.rewrite(url, {
    request: {
      headers: requestHeaders,
    },
  });

  if (requestedChannel === MARKETPLACE_CHANNEL) {
    response.cookies.set(SALES_CHANNEL_COOKIE, MARKETPLACE_CHANNEL, {
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      secure: !isLoopbackHost(request.nextUrl.hostname),
    });
  } else if (requestedChannel === "direct" && hasMarketplaceCookie) {
    response.cookies.delete(SALES_CHANNEL_COOKIE);
  }

  return response;
}

// =============================================================================
// STANDALONE STORE RESOLUTION
// =============================================================================

// The middleware cannot query the database, so standalone mode resolves the
// instance's storefront slug through an internal API route over loopback.
// A found slug is cached (the TTL also bounds how long a renamed slug serves
// 404s). A "no store yet" result is NOT cached, so the root flips to the
// storefront on the first request after onboarding; a transient failure gets
// a short negative TTL so a burst can't hammer the loopback route. Concurrent
// resolutions share one in-flight promise to avoid a thundering herd.
const STANDALONE_SLUG_TTL_MS = 15_000;
const STANDALONE_SLUG_NEGATIVE_TTL_MS = 2_000;
let standaloneSlugCache: { slug: string; expiresAt: number } | null = null;
let standaloneSlugMiss = 0;
let standaloneSlugInFlight: Promise<string | null> | null = null;

async function getStandaloneStoreSlug(): Promise<string | null> {
  const now = Date.now();
  if (standaloneSlugCache && now < standaloneSlugCache.expiresAt) {
    return standaloneSlugCache.slug;
  }
  if (now < standaloneSlugMiss) {
    // A recent transient failure — hold off instead of re-hammering loopback.
    return null;
  }
  if (standaloneSlugInFlight) {
    return standaloneSlugInFlight;
  }

  standaloneSlugInFlight = (async () => {
    try {
      const port = process.env.PORT ?? "3000";
      const response = await fetch(`http://127.0.0.1:${port}/api/standalone/store`, {
        cache: "no-store",
      });
      if (!response.ok) {
        // 404 = no onboarded store yet: do not cache, so onboarding flips the
        // root immediately. Other codes are transient: back off briefly.
        if (response.status !== 404) {
          standaloneSlugMiss = Date.now() + STANDALONE_SLUG_NEGATIVE_TTL_MS;
        }
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
      standaloneSlugMiss = Date.now() + STANDALONE_SLUG_NEGATIVE_TTL_MS;
      return null;
    } finally {
      standaloneSlugInFlight = null;
    }
  })();

  return standaloneSlugInFlight;
}

// =============================================================================
// ACQUISITION ATTRIBUTION
// =============================================================================

const REFERRAL_COOKIE = "louez_referral";
const REFERRAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30-day attribution window

/**
 * Cross-subdomain cookie domain so a referral captured on the marketing site (the apex,
 * e.g. louez.io) or any *.louez.io surface survives the hop to the dashboard
 * (app.louez.io). Omitted on localhost — browsers reject domain=localhost.
 */
function referralCookieDomain(host: string, appDomain: string): string | undefined {
  const hostname = host.split(":")[0].toLowerCase();
  const baseDomain = appDomain.split(":")[0].toLowerCase();
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
  appDomain: string,
): NextResponse {
  const ref = request.nextUrl.searchParams.get("ref");
  if (ref && isValidReferralCode(ref)) {
    response.cookies.set(REFERRAL_COOKIE, ref, {
      maxAge: REFERRAL_COOKIE_MAX_AGE,
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      secure: !isLoopbackHost(host.split(":")[0]),
      domain: referralCookieDomain(host, appDomain),
    });
  }
  return response;
}

/**
 * Capture a `?from=` sign-up origin (e.g. `?from=reeent`) the same way `?ref=` is captured:
 * last-click, cross-subdomain, so it survives the entry URL and the OAuth round-trip and can
 * still be read once the user lands in onboarding. Only allow-listed values are stored — the
 * cookie decides which education step and which offer copy a new loueur is shown.
 */
function captureSignupOrigin(
  request: NextRequest,
  response: NextResponse,
  host: string,
  appDomain: string,
): NextResponse {
  const from = request.nextUrl.searchParams.get("from");
  if (isKnownSignupOrigin(from)) {
    response.cookies.set(SIGNUP_ORIGIN_COOKIE, from, {
      maxAge: SIGNUP_ORIGIN_COOKIE_MAX_AGE,
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      secure: !isLoopbackHost(host.split(":")[0]),
      domain: referralCookieDomain(host, appDomain),
    });
  }
  return response;
}

/** Both last-click acquisition captures, applied to the same outgoing response. */
function captureAcquisition(
  request: NextRequest,
  response: NextResponse,
  host: string,
  appDomain: string,
): NextResponse {
  return captureSignupOrigin(
    request,
    captureReferral(request, response, host, appDomain),
    host,
    appDomain,
  );
}

export async function proxy(request: NextRequest) {
  const host = request.headers.get("host") || "";
  const { pathname } = request.nextUrl;

  // -----------------------------------------------------------------------------
  // 1. PASS THROUGH: API routes, PostHog ingest proxy, and static assets
  // -----------------------------------------------------------------------------
  // /ingest must reach the next.config.ts rewrites untouched: rewriting it to
  // /{slug}/ingest on storefront subdomains 404s every PostHog capture call.
  if (pathname.startsWith("/api") || pathname.startsWith("/ingest") || isStaticAsset(pathname)) {
    return NextResponse.next();
  }

  const publicEnv = getRuntimePublicEnv();
  const appDomain = publicEnv.NEXT_PUBLIC_APP_DOMAIN;
  const dashboardSubdomain = publicEnv.NEXT_PUBLIC_DASHBOARD_SUBDOMAIN;
  const previewStoreSlug = readRuntimeEnv("PREVIEW_STORE_SLUG") || "";
  const subdomain = getSubdomain(host, appDomain);

  // -----------------------------------------------------------------------------
  // 2. STANDALONE: single store on a single origin (the default mode)
  // -----------------------------------------------------------------------------
  // The instance's storefront is served at the root of whatever host it runs
  // on; dashboard/auth routes stay reachable by path. Platform deployments
  // (LOUEZ_MODE=platform) skip this branch entirely, and referral capture is
  // deliberately absent here — the referral program is platform machinery.
  if (isStandaloneMode()) {
    if (isDashboardRoute(pathname)) {
      return withRuntimeSecurityHeaders(NextResponse.next(), pathname, publicEnv);
    }

    const slug = await getStandaloneStoreSlug();
    if (!slug) {
      // Fresh install: no onboarded store yet. Fall through to the dashboard
      // root, which walks the visitor to /login and /onboarding.
      return withRuntimeSecurityHeaders(NextResponse.next(), pathname, publicEnv);
    }

    return withRuntimeSecurityHeaders(createStorefrontRewrite(request, slug), pathname, publicEnv);
  }

  // -----------------------------------------------------------------------------
  // 3. LOCAL DEVELOPMENT: Preview a storefront without subdomains
  // -----------------------------------------------------------------------------
  // When running locally with PREVIEW_STORE_SLUG set, rewrite to that store's
  // storefront (except for dashboard routes which should remain accessible).
  const isLocalhost = host.includes("localhost") || host.includes("127.0.0.1");

  if (isLocalhost && !subdomain && previewStoreSlug && !isDashboardRoute(pathname)) {
    return withRuntimeSecurityHeaders(
      captureAcquisition(
        request,
        createStorefrontRewrite(request, previewStoreSlug),
        host,
        appDomain,
      ),
      pathname,
      publicEnv,
    );
  }

  // -----------------------------------------------------------------------------
  // 4. DASHBOARD: Configured subdomain or localhost without preview mode
  // -----------------------------------------------------------------------------
  // Dashboard is served from:
  //   - {DASHBOARD_SUBDOMAIN}.{APP_DOMAIN} (e.g., app.example.com)
  //   - localhost (when PREVIEW_STORE_SLUG is not set)
  if (subdomain === dashboardSubdomain || (isLocalhost && !subdomain)) {
    return withRuntimeSecurityHeaders(
      captureAcquisition(request, createDashboardResponse(request), host, appDomain),
      pathname,
      publicEnv,
    );
  }

  // -----------------------------------------------------------------------------
  // 5. STOREFRONT: Any other subdomain becomes a store slug
  // -----------------------------------------------------------------------------
  // {slug}.{APP_DOMAIN} → rewrite to /{slug}/* routes
  // Excludes "www" which should show the landing page
  if (subdomain && subdomain !== "www") {
    return withRuntimeSecurityHeaders(
      captureAcquisition(request, createStorefrontRewrite(request, subdomain), host, appDomain),
      pathname,
      publicEnv,
    );
  }

  // -----------------------------------------------------------------------------
  // 6. DEFAULT: Pass through (landing page, www, etc.)
  // -----------------------------------------------------------------------------
  return withRuntimeSecurityHeaders(
    captureAcquisition(request, NextResponse.next(), host, appDomain),
    pathname,
    publicEnv,
  );
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
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
