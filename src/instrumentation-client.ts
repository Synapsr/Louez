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
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com',
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
    // Capture pageviews automatically
    capture_pageview: true,
    // Capture pageleaves for session duration
    capture_pageleave: true,
  })
}

export default posthog
