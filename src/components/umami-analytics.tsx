import Script from 'next/script'

/**
 * Umami Analytics component
 *
 * Configure with environment variables:
 * - NEXT_PUBLIC_UMAMI_HOST: Umami server URL (e.g., https://cloud.umami.is)
 * - NEXT_PUBLIC_UMAMI_WEBSITE_ID: Website ID from Umami dashboard
 *
 * If either is missing, no script is injected.
 */
export function UmamiAnalytics() {
  const host = process.env.NEXT_PUBLIC_UMAMI_HOST
  const websiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID

  if (!host || !websiteId) {
    return null
  }

  const baseUrl = host.endsWith('/') ? host.slice(0, -1) : host

  return (
    <Script
      src={`${baseUrl}/script.js`}
      data-website-id={websiteId}
      strategy="beforeInteractive"
    />
  )
}
