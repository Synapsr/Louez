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

    // On localhost, we're never on a true subdomain
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      setIsSubdomain(false)
      return
    }

    // Simple and reliable detection: if the hostname starts with the store slug,
    // we're on the store's subdomain (e.g., 'ddm.louez.io' starts with 'ddm')
    const hostnamePrefix = hostname.split('.')[0]

    // We're on a subdomain if the first part of hostname matches the store slug
    // and is not 'www', 'app', or 'app-dev' (dashboard subdomains)
    const dashboardPrefixes = ['www', 'app', 'app-dev', 'localhost']
    const isStoreSubdomain =
      hostnamePrefix === storeSlug &&
      !dashboardPrefixes.includes(hostnamePrefix)

    setIsSubdomain(isStoreSubdomain)
  }, [storeSlug])

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
