import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

// ===== SECURITY HEADERS & CSP =====
// Comprehensive Content Security Policy to prevent XSS and other injection attacks
// Designed for production use with Next.js, Stripe, and various S3 providers
// Note: Next.js requires 'unsafe-eval' in development mode for hot reload

const isDev = process.env.NODE_ENV === 'development'

// CSP Directives
const cspDirectives = {
  // Default: only allow from same origin
  'default-src': ["'self'"],

  // Scripts: self + Stripe + Google + PostHog + Leaflet + Gleap + development requirements
  'script-src': [
    "'self'",
    // Stripe.js for payments
    'https://js.stripe.com',
    'https://maps.googleapis.com',
    // Google Maps
    'https://maps.gstatic.com',
    // PostHog analytics
    'https://eu-assets.i.posthog.com',
    // Gleap feedback widget
    'https://gleapjs.com',
    'https://api.gleap.io',
    // Leaflet maps
    'https://unpkg.com',
    // Development: Next.js hot reload requires eval
    ...(isDev ? ["'unsafe-eval'", "'unsafe-inline'"] : []),
    // Production: unsafe-inline needed for Next.js inline scripts (nonce-based CSP is the next step)
    // unsafe-eval required by PostHog JS SDK (eval/new Function for feature flags & config)
    ...(!isDev ? ["'unsafe-inline'", "'unsafe-eval'"] : []),
  ],

  // Styles: self + inline (required for Tailwind and component libraries)
  'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://api.fontshare.com', 'https://unpkg.com', 'https://gleapjs.com'],

  // Images: self + data URIs + blob + all allowed image providers
  'img-src': [
    "'self'",
    'data:',
    'blob:',
    // Google profile pictures
    'https://lh3.googleusercontent.com',
    // Google Maps
    'https://maps.googleapis.com',
    'https://maps.gstatic.com',
    // Leaflet map tiles (CartoDB)
    'https://*.basemaps.cartocdn.com',
    // OpenStreetMap tiles (fallback)
    'https://*.tile.openstreetmap.org',
    // Gleap
    'https://gleapjs.com',
    'https://api.gleap.io',
    'https://staticfiles.gleap.io',
    // YouTube thumbnails
    'https://img.youtube.com',
    'https://i.ytimg.com',
    // AWS S3
    'https://*.s3.amazonaws.com',
    'https://*.s3.*.amazonaws.com',
    'https://s3.*.amazonaws.com',
    // Scaleway
    'https://*.scw.cloud',
    // OVH
    'https://*.cloud.ovh.net',
    'https://*.s3.*.cloud.ovh.net',
    // DigitalOcean
    'https://*.digitaloceanspaces.com',
    // Cloudflare R2
    'https://*.r2.cloudflarestorage.com',
    // Backblaze
    'https://*.backblazeb2.com',
    // Wasabi
    'https://*.wasabisys.com',
    // Linode
    'https://*.linodeobjects.com',
  ],

  // Fonts: self + Google Fonts + Fontshare
  'font-src': ["'self'", 'https://fonts.gstatic.com', 'https://cdn.fontshare.com', 'data:'],

  // Connect: API calls and WebSocket
  'connect-src': [
    "'self'",
    // Stripe
    'https://api.stripe.com',
    'https://maps.googleapis.com',
    // Google Places API
    'https://places.googleapis.com',
    // PostHog analytics
    'https://eu.i.posthog.com',
    'https://eu-assets.i.posthog.com',
    // Gleap feedback
    'https://api.gleap.io',
    'wss://ws.gleap.io',
    // Leaflet resources
    'https://unpkg.com',
    // Map tiles
    'https://*.basemaps.cartocdn.com',
    'https://*.tile.openstreetmap.org',
    // Fontshare fonts
    'https://api.fontshare.com',
    'https://cdn.fontshare.com',
    // Development: Next.js WebSocket for hot reload
    ...(isDev ? ['ws://localhost:*', 'ws://127.0.0.1:*'] : []),
  ],

  // Frames: Stripe for 3D Secure + Gleap
  'frame-src': ["'self'", 'https://js.stripe.com', 'https://hooks.stripe.com', 'https://gleapjs.com', 'https://messenger-app.gleap.io'],

  // Workers: only from self
  'worker-src': ["'self'", 'blob:'],

  // Media: self + YouTube embeds
  'media-src': ["'self'", 'https://www.youtube.com', 'https://youtube.com'],

  // Object: none (no plugins)
  'object-src': ["'none'"],

  // Base URI: restrict to self (prevents base tag hijacking)
  'base-uri': ["'self'"],

  // Form action: restrict to self
  'form-action': ["'self'"],

  // Frame ancestors: prevent clickjacking (replaces X-Frame-Options)
  'frame-ancestors': ["'self'"],

  // Upgrade insecure requests in production
  ...(!isDev ? { 'upgrade-insecure-requests': [] } : {}),
}

// Build CSP string
const cspString = Object.entries(cspDirectives)
  .map(([directive, sources]) => {
    if (sources.length === 0) return directive
    return `${directive} ${sources.join(' ')}`
  })
  .join('; ')

const securityHeaders = [
  {
    // Content Security Policy - Main XSS protection
    key: 'Content-Security-Policy',
    value: cspString,
  },
  {
    // Prevent clickjacking attacks (legacy, superseded by CSP frame-ancestors)
    key: 'X-Frame-Options',
    value: 'SAMEORIGIN',
  },
  {
    // Prevent MIME type sniffing
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    // Enable XSS filter in older browsers
    key: 'X-XSS-Protection',
    value: '1; mode=block',
  },
  {
    // Control referrer information
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    // Restrict browser features
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(self), interest-cohort=()',
  },
  {
    // Enforce HTTPS (enable in production with proper SSL)
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains',
  },
]

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  output: 'standalone',
  // Increase body size limit for server actions (image uploads)
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  // Security headers for all routes
  async headers() {
    return [
      {
        // Apply to all routes
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },
  // PostHog reverse proxy: route analytics through our domain to avoid CORS
  // issues and ad blockers. See https://posthog.com/docs/advanced/proxy/nextjs
  async rewrites() {
    return [
      {
        source: '/ingest/static/:path*',
        destination: 'https://eu-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://eu.i.posthog.com/:path*',
      },
    ]
  },
  // Required for PostHog proxy to work with middleware
  skipTrailingSlashRedirect: true,
  images: {
    remotePatterns: [
      // Google (OAuth profile pictures)
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
      // Google Maps Places API (photos)
      {
        protocol: 'https',
        hostname: 'maps.googleapis.com',
      },
      // YouTube thumbnails
      {
        protocol: 'https',
        hostname: 'img.youtube.com',
      },
      // AWS S3
      {
        protocol: 'https',
        hostname: '*.s3.amazonaws.com',
      },
      {
        protocol: 'https',
        hostname: '*.s3.*.amazonaws.com',
      },
      {
        protocol: 'https',
        hostname: 's3.*.amazonaws.com',
      },
      // Scaleway Object Storage
      {
        protocol: 'https',
        hostname: '*.scw.cloud',
      },
      // OVH Object Storage
      {
        protocol: 'https',
        hostname: '*.cloud.ovh.net',
      },
      {
        protocol: 'https',
        hostname: '*.s3.*.cloud.ovh.net',
      },
      // DigitalOcean Spaces
      {
        protocol: 'https',
        hostname: '*.digitaloceanspaces.com',
      },
      // Cloudflare R2
      {
        protocol: 'https',
        hostname: '*.r2.cloudflarestorage.com',
      },
      // Backblaze B2
      {
        protocol: 'https',
        hostname: '*.backblazeb2.com',
      },
      // Wasabi
      {
        protocol: 'https',
        hostname: '*.wasabisys.com',
      },
      // Linode Object Storage
      {
        protocol: 'https',
        hostname: '*.linodeobjects.com',
      },
      // MinIO (self-hosted) - Allow any hostname for flexibility
      // Users can add their own custom domains if needed
    ],
  },
}

export default withNextIntl(nextConfig)
