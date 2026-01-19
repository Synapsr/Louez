import Script from 'next/script'

/**
 * Umami Analytics component
 *
 * Configure with environment variables:
 * - NEXT_PUBLIC_UMAMI_HOST: The Umami server URL (e.g., https://cloud.umami.is or https://analytics.example.com)
 * - NEXT_PUBLIC_UMAMI_WEBSITE_ID: Your website ID from Umami dashboard
 * - NEXT_PUBLIC_UMAMI_SCRIPT_NAME: (Optional) Script filename, defaults to "script.js"
 *
 * If host or websiteId is missing, no script is injected.
 */
export function UmamiAnalytics() {
  const host = process.env.NEXT_PUBLIC_UMAMI_HOST
  const websiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID
  const scriptName = process.env.NEXT_PUBLIC_UMAMI_SCRIPT_NAME || 'script.js'

  if (!host || !websiteId) {
    return null
  }

  // Ensure host doesn't have trailing slash
  const baseUrl = host.endsWith('/') ? host.slice(0, -1) : host
  const scriptUrl = `${baseUrl}/${scriptName}`

  return (
    <Script
      src={scriptUrl}
      data-website-id={websiteId}
      strategy="afterInteractive"
      data-auto-track="true"
    />
  )
}
