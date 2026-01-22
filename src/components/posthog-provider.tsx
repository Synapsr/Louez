'use client'

import posthog from 'posthog-js'
import { PostHogProvider as PHProvider, usePostHog } from 'posthog-js/react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, Suspense } from 'react'

/**
 * Tracks page views on route changes in Next.js App Router.
 * Must be used inside PostHogProvider and Suspense boundary.
 */
function PostHogPageView() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const posthogClient = usePostHog()

  useEffect(() => {
    if (pathname && posthogClient) {
      let url = window.origin + pathname
      const search = searchParams?.toString()
      if (search) {
        url = url + '?' + search
      }
      posthogClient.capture('$pageview', { $current_url: url })
    }
  }, [pathname, searchParams, posthogClient])

  return null
}

interface PostHogProviderProps {
  children: React.ReactNode
}

/**
 * PostHog analytics provider for client-side tracking.
 *
 * Wraps the application to enable:
 * - Automatic page view tracking on route changes
 * - Access to PostHog hooks (usePostHog, useFeatureFlag, etc.)
 * - Session recording and analytics
 *
 * PostHog is initialized in instrumentation-client.ts, this provider
 * adds React context integration for the initialized instance.
 */
export function PostHogProvider({ children }: PostHogProviderProps) {
  // Skip rendering if PostHog is not configured
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) {
    return <>{children}</>
  }

  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      {children}
    </PHProvider>
  )
}
