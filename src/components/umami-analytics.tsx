import Script from 'next/script'

/**
 * Umami Analytics component
 *
 * Configure with two environment variables:
 * - NEXT_PUBLIC_UMAMI_HOST: The Umami server URL (e.g., https://analytics.example.com)
 * - NEXT_PUBLIC_UMAMI_WEBSITE_ID: Your website ID from Umami dashboard
 *
 * If either variable is missing, no script is injected.
 */
export function UmamiAnalytics() {
  const host = process.env.NEXT_PUBLIC_UMAMI_HOST
  const websiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID

  if (!host || !websiteId) {
    return null
  }

  // Ensure host doesn't have trailing slash
  const baseUrl = host.endsWith('/') ? host.slice(0, -1) : host

  return (
    <Script
      src={`${baseUrl}/script.js`}
      data-website-id={websiteId}
      strategy="afterInteractive"
    />
  )
}
