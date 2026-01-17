import Script from 'next/script'

/**
 * Umami Analytics component (Server Component)
 *
 * Configured via UMAMI_URL environment variable (without NEXT_PUBLIC_ prefix)
 * Format: https://your-umami-host.com/script.js#website-id
 *
 * Example: UMAMI_URL=https://analytics.example.com/script.js#abc123def
 *
 * If the variable is not set, no script is injected.
 * This runs at runtime on the server, not at build time.
 */
export function UmamiAnalytics() {
  const umamiUrl = process.env.UMAMI_URL

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
        '[Umami] Missing website ID in UMAMI_URL. Format: https://host/script.js#website-id'
      )
      return null
    }
  } catch {
    console.warn('[Umami] Invalid UMAMI_URL:', umamiUrl)
    return null
  }

  return (
    <Script
      defer
      src={src}
      data-website-id={websiteId}
      strategy="afterInteractive"
    />
  )
}
