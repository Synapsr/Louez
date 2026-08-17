'use client'

import posthog from 'posthog-js'
import { PostHogProvider as PHProvider, usePostHog } from 'posthog-js/react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, Suspense } from 'react'
import { env } from '@/env'

type SalesChannel = 'marketplace'

/**
 * Tracks page views on route changes in Next.js App Router.
 * Must be used inside PostHogProvider and Suspense boundary.
 */
function PostHogPageView({ channel }: { channel?: SalesChannel }) {
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
      posthogClient.capture('$pageview', {
        $current_url: url,
        ...(channel && { channel }),
      })
    }
  }, [channel, pathname, searchParams, posthogClient])

  return null
}

/**
 * Identifies user in PostHog for session replay attribution.
 * Must be used inside PostHogProvider.
 */
function PostHogIdentify({ user }: { user: PostHogProviderProps['user'] }) {
  const posthogClient = usePostHog()

  useEffect(() => {
    if (posthogClient && user) {
      posthogClient.identify(user.id, {
        email: user.email,
        name: user.name || undefined,
      })
    }
  }, [posthogClient, user])

  return null
}

interface PostHogProviderProps {
  children: React.ReactNode
  channel?: SalesChannel
  user?: {
    id: string
    email: string
    name?: string | null
  }
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
export function PostHogProvider({
  children,
  channel,
  user,
}: PostHogProviderProps) {
  useEffect(() => {
    if (!env.NEXT_PUBLIC_POSTHOG_KEY) {
      return
    }

    if (channel) {
      posthog.register_for_session({ channel })
    } else {
      posthog.unregister_for_session('channel')
    }
  }, [channel])

  // Skip rendering if PostHog is not configured
  if (!env.NEXT_PUBLIC_POSTHOG_KEY) {
    return <>{children}</>
  }

  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageView channel={channel} />
      </Suspense>
      {user && <PostHogIdentify user={user} />}
      {children}
    </PHProvider>
  )
}
