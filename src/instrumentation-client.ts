/**
 * PostHog Client-Side Instrumentation
 *
 * This file is executed once on the client when the app loads.
 * It initializes PostHog for analytics and feature flags.
 *
 * @see https://posthog.com/docs/libraries/next-js
 */

import posthog from 'posthog-js'

if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_POSTHOG_KEY) {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    // Route analytics through our reverse proxy to avoid CORS and ad blockers
    // The proxy is configured in next.config.ts rewrites
    api_host: '/ingest',
    ui_host: 'https://eu.posthog.com',
    // Use recommended defaults for new projects (2025-11-30)
    defaults: '2025-11-30',
    // Only load in production to avoid polluting analytics with dev data
    loaded: (posthog) => {
      if (process.env.NODE_ENV === 'development') {
        // Disable in development - uncomment next line to debug locally
        // posthog.debug()
        posthog.opt_out_capturing()
      }
    },
    // Respect user privacy settings
    respect_dnt: true,
    // Disable automatic pageview capture - handled by PostHogProvider
    // for proper SPA navigation tracking in Next.js App Router
    capture_pageview: false,
    // Capture pageleaves for session duration
    capture_pageleave: true,
  })
}

export default posthog
