import { redirect } from "next/navigation";

import { isStandaloneMode } from "@/lib/deployment";
import { buildStorefrontUrl } from "@/lib/util.storefront-url";

import { env } from "@/env";

const APP_DOMAIN = env.NEXT_PUBLIC_APP_DOMAIN;

const getStorefrontProtocol = (): "http" | "https" => {
  if (env.NEXT_PUBLIC_APP_URL?.startsWith("https://")) {
    return "https";
  }

  if (env.NEXT_PUBLIC_APP_URL?.startsWith("http://")) {
    return "http";
  }

  return process.env.NODE_ENV === "production" ? "https" : "http";
};

/**
 * Build an absolute storefront URL for server-side redirects, emails, SMS,
 * Stripe return URLs and webhooks.
 *
 * Server-side twin of the `useStorefrontUrl().getAbsoluteUrl` client hook;
 * both delegate to `buildStorefrontUrl` so they can never drift apart.
 *
 * Production (subdomain routing):
 *   getStorefrontUrl('ddm', '/account') → 'https://ddm.louez.io/account'
 *
 * Localhost (path-based routing):
 *   getStorefrontUrl('ddm', '/account') → 'http://localhost:3000/ddm/account'
 *
 * Standalone (single store on the app URL):
 *   getStorefrontUrl('ddm', '/account') → 'https://location.example.com/account'
 *
 * Absolute URLs remove any ambiguity with the proxy rewrite, which turns
 * subdomain requests into `/{slug}` routes internally: a relative path in
 * `redirect()` can double the slug on a subdomain or miss it on localhost.
 *
 * @see hooks/use-storefront-url.ts for the client-side equivalent
 * @see proxy.ts for the subdomain → path rewrite logic
 */
export const getStorefrontUrl = (slug: string, path: string = "/"): string => {
  const protocol = getStorefrontProtocol();
  const standalone = isStandaloneMode();

  return buildStorefrontUrl({
    slug,
    path,
    standalone,
    appDomain: APP_DOMAIN,
    // Standalone reads NEXT_PUBLIC_APP_URL at runtime so the prebuilt Docker
    // image stays correct on any domain; local platform routing builds on the
    // app domain itself.
    origin: standalone
      ? (env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "")
      : `${protocol}://${APP_DOMAIN}`,
    protocol,
  });
};

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
// A function declaration on purpose: TypeScript only narrows the callers'
// control flow after a `never`-returning call when the callee is declared
// with an explicit type, which an arrow bound to a const is not.
export function storefrontRedirect(slug: string, path: string = "/"): never {
  redirect(getStorefrontUrl(slug, path));
}
