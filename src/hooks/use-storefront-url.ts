'use client'

import { useEffect, useState, useCallback } from 'react'

/**
 * Hook to generate correct storefront URLs based on the routing context.
 *
 * When on a subdomain (e.g., store.example.com), the proxy already adds
 * the slug to the path, so we should NOT include it in generated URLs.
 *
 * When on localhost with PREVIEW_MODE or on dashboard, we need to include
 * the slug in the URL.
 */
export function useStorefrontUrl(storeSlug: string) {
  const [isSubdomain, setIsSubdomain] = useState(false)

  useEffect(() => {
    const hostname = window.location.hostname
    const baseDomain = process.env.NEXT_PUBLIC_APP_DOMAIN?.split(':')[0] || 'localhost'

    // On localhost, we're never on a true subdomain
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      setIsSubdomain(false)
      return
    }

    // Check if hostname has more parts than base domain (indicating subdomain)
    const hostParts = hostname.split('.')
    const baseParts = baseDomain.split('.')

    // Extract potential subdomain
    const subdomain =
      hostParts.length > baseParts.length
        ? hostParts.slice(0, hostParts.length - baseParts.length).join('.')
        : null

    // We're on a subdomain if there's one and it's not 'www' or the dashboard subdomain
    const dashboardSubdomain = process.env.NEXT_PUBLIC_DASHBOARD_SUBDOMAIN || 'app'
    setIsSubdomain(
      subdomain !== null && subdomain !== 'www' && subdomain !== dashboardSubdomain
    )
  }, [])

  /**
   * Generate a storefront URL path.
   * Returns path without slug on subdomains, with slug otherwise.
   */
  const getUrl = useCallback(
    (path: string) => {
      // Ensure path starts with /
      const normalizedPath = path.startsWith('/') ? path : `/${path}`

      if (isSubdomain) {
        // On subdomain, don't include slug (proxy adds it)
        return normalizedPath
      }

      // On localhost or dashboard, include slug
      return `/${storeSlug}${normalizedPath}`
    },
    [storeSlug, isSubdomain]
  )

  return { getUrl, isSubdomain }
}
