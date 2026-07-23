'use client'

import { useEffect, useState, useCallback } from 'react'

import { useInstanceConfig } from '@/components/instance-provider'

import { env } from '@/env'

/**
 * Hook to generate correct storefront URLs based on the routing context.
 *
 * In standalone mode the storefront is served at the root of the origin and
 * the proxy injects the slug internally, so generated URLs never carry it.
 *
 * In platform mode, when on a subdomain (e.g., store.example.com) the proxy
 * already adds the slug to the path, so we should NOT include it; on
 * localhost with PREVIEW_MODE or on the dashboard, we need to include it.
 */
export function useStorefrontUrl(storeSlug: string) {
  const { standalone } = useInstanceConfig()
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

      if (standalone || isSubdomain) {
        // The proxy injects the slug (root rewrite in standalone, subdomain
        // rewrite in platform), so generated URLs must not repeat it.
        return normalizedPath
      }

      // On localhost or dashboard, include slug
      return `/${storeSlug}${normalizedPath}`
    },
    [storeSlug, isSubdomain, standalone]
  )

  /**
   * Absolute storefront URL for sharing/preview surfaces (copy buttons,
   * target=_blank links). Standalone: the current origin, no slug. Platform:
   * the store subdomain — or a path on the current origin during
   * localhost development, where subdomains do not resolve.
   */
  const getAbsoluteUrl = useCallback(
    (path: string = '/') => {
      const normalizedPath = path.startsWith('/') ? path : `/${path}`
      const suffix = normalizedPath === '/' ? '' : normalizedPath
      const origin = typeof window === 'undefined' ? '' : window.location.origin

      if (standalone) {
        return `${origin}${suffix}` || '/'
      }

      const domain = env.NEXT_PUBLIC_APP_DOMAIN
      if (!domain || domain.includes('localhost') || domain.includes('127.0.0.1')) {
        return `${origin}/${storeSlug}${suffix}`
      }

      return `https://${storeSlug}.${domain}${suffix}`
    },
    [storeSlug, standalone]
  )

  return { getUrl, getAbsoluteUrl, isSubdomain }
}
