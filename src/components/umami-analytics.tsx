'use client'

import Script from 'next/script'

/**
 * Umami Analytics component
 *
 * Configured via NEXT_PUBLIC_UMAMI environment variable
 * Format: https://your-umami-host.com/script.js#website-id
 *
 * Example: NEXT_PUBLIC_UMAMI=https://analytics.example.com/script.js#abc123def
 *
 * If the variable is not set, no script is injected.
 */
export function UmamiAnalytics() {
  const umamiUrl = process.env.NEXT_PUBLIC_UMAMI

  if (!umamiUrl) {
    return null
  }

  // Parse URL to extract script src and website ID from hash
  let src: string
  let websiteId: string

  try {
    const url = new URL(umamiUrl)
    websiteId = url.hash.slice(1) // Remove the # prefix
    url.hash = '' // Remove hash from URL
    src = url.toString()

    if (!websiteId) {
      console.warn(
        '[Umami] Missing website ID in NEXT_PUBLIC_UMAMI. Format: https://host/script.js#website-id'
      )
      return null
    }
  } catch {
    console.warn('[Umami] Invalid NEXT_PUBLIC_UMAMI URL:', umamiUrl)
    return null
  }

  return (
    <Script
      src={src}
      data-website-id={websiteId}
      strategy="afterInteractive"
    />
  )
}
