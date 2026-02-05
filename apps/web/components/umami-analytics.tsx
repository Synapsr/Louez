/* eslint-disable @next/next/no-before-interactive-script-outside-document */
'use client'

/**
 * Umami Analytics component
 *
 * Configure with environment variables:
 * - NEXT_PUBLIC_UMAMI_SCRIPT_URL: Full URL to Umami script (e.g., https://cloud.umami.is/script.js)
 * - NEXT_PUBLIC_UMAMI_WEBSITE_ID: Website ID from Umami dashboard
 *
 * If either is missing, no script is injected.
 */
export function UmamiAnalytics() {
  const scriptUrl = process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL
  const websiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID

  if (!scriptUrl || !websiteId) {
    return null
  }

  // Using native script tag due to Next.js 16 canary Script component type issues
  return (
    <script
      async
      src={scriptUrl}
      data-website-id={websiteId}
    />
  )
}
