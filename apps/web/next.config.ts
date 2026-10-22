import { config } from "dotenv";
import { resolve } from "path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import { storageImageRemotePattern } from "./lib/storage/image-optimizer";
import { buildSecurityHeaders } from "./lib/util.security-headers";

// Monorepo: .env files live at the repository root (../../ relative to apps/web/).
// Next.js only loads .env from its own directory, so we bridge the gap with dotenv.
// .env.local is loaded first so its values take priority over .env.
// Neither overrides env vars already set in the system (safe for production).
const rootDir = resolve(process.cwd(), "../..");
config({ path: resolve(rootDir, ".env.local") });
config({ path: resolve(rootDir, ".env") });

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const isDev = process.env.NODE_ENV === "development";

const storageImagePattern = storageImageRemotePattern(process.env.S3_PUBLIC_URL);

const nextConfig: NextConfig = {
  cacheComponents: true,
  // PostHog error tracking resolves browser stack frames by fetching the map
  // next to each production chunk. Keep these in the standalone image so
  // hydration failures point back to application components instead of only
  // the minified React runtime.
  productionBrowserSourceMaps: true,
  // Enable standalone output for Docker deployment
  output: "standalone",
  // The changelog reads its write-ups from content/whats-new/**/*.md at runtime.
  // Tracing only follows imports, so the files must be listed explicitly or the
  // standalone build ships without them.
  outputFileTracingIncludes: {
    "/*": ["./public/fonts/pdf/*.woff", "./public/fonts/pdf/*.ttf"],
    "/dashboard/whats-new/[slug]": ["./content/whats-new/**/*.md"],
  },
  // TypeScript 7 ships the native compiler without the legacy JS API surface
  // Next currently expects during next build. Keep TS validation as a separate
  // workspace gate through `pnpm type-check`.
  typescript: {
    ignoreBuildErrors: true,
  },
  // Make SKIP_ENV_VALIDATION visible to Turbopack-compiled code (packages/db, packages/validations).
  // Without this, Turbopack inlines process.env.SKIP_ENV_VALIDATION as undefined during compilation.
  // At runtime, t3-env's proxy falls back to real process.env for actual values like DATABASE_URL.
  env: {
    SKIP_ENV_VALIDATION: process.env.SKIP_ENV_VALIDATION ?? "",
    // Bucket accepted by remotePatterns, so next/image skips the optimizer
    // for other sources instead of failing (lib/storage/image-optimizer.ts).
    LOUEZ_OPTIMIZED_STORAGE_URL: storageImagePattern ? (process.env.S3_PUBLIC_URL ?? "") : "",
  },
  // Security headers for all routes
  async headers() {
    // CSP and frame policy must reflect container runtime values, so proxy.ts
    // sets them on document responses. These invariant headers also cover
    // static assets and API routes without overriding the proxy response.
    const invariantSecurityHeaders = buildSecurityHeaders({
      isDevelopment: isDev,
    }).filter(
      (header) => header.key !== "Content-Security-Policy" && header.key !== "X-Frame-Options",
    );

    return [
      {
        source: "/:path*",
        headers: invariantSecurityHeaders,
      },
      {
        // Service worker (web push): never cache so updates propagate at once,
        // and allow it to control the whole origin.
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/dashboard/referrals",
        destination: "/dashboard/settings/referrals",
        permanent: false,
      },
      {
        source: "/dashboard/subscription",
        destination: "/dashboard/settings/subscription",
        permanent: false,
      },
    ];
  },
  // PostHog reverse proxy: route analytics through our domain to avoid CORS
  // issues and ad blockers. See https://posthog.com/docs/advanced/proxy/nextjs
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://eu-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://eu.i.posthog.com/:path*",
      },
    ];
  },
  // Required for PostHog proxy to work with middleware
  skipTrailingSlashRedirect: true,
  images: {
    // Only this instance's bucket. See lib/storage/image-optimizer.ts.
    remotePatterns: storageImagePattern ? [storageImagePattern] : [],
  },
  // Storefront tenant subdomains are <store-slug>.<env>.louez.localify (three
  // levels). Next's wildcard only matches one label, so *.louez.localify does
  // NOT cover them — add the per-env tenant wildcard or the dev server 403s the
  // client bundle and the page never hydrates.
  allowedDevOrigins: [
    "louez.localify",
    "*.louez.localify",
    "feat-inventory.louez.localify",
    "*.feat-inventory.louez.localify",
    "worktree-onboarding-redesign.louez.localify",
    "*.worktree-onboarding-redesign.louez.localify",
    "agent-redesign-product-creation-flow.louez.localify",
    "*.agent-redesign-product-creation-flow.louez.localify",
    "feat-marketplace-channel.louez.localify",
    "*.feat-marketplace-channel.louez.localify",
    "feat-storefront-redesign.louez.localify",
    "*.feat-storefront-redesign.louez.localify",
    "louez-storefront-redesign.localify",
    "*.louez-storefront-redesign.localify",
    "landing-demos.louez.localify",
  ],
};

export default withNextIntl(nextConfig);
