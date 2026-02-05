/**
 * PostHog Server-Side Client
 *
 * Use this for capturing events in API routes and server actions.
 * Always call await posthog.shutdown() when done to flush events.
 *
 * @example
 * ```ts
 * import { getPostHogServer } from '@/lib/posthog'
 *
 * export async function myServerAction() {
 *   const posthog = getPostHogServer()
 *   posthog.capture({
 *     distinctId: userId,
 *     event: 'action_completed'
 *   })
 *   await posthog.shutdown()
 * }
 * ```
 */

import { PostHog } from 'posthog-node'
import { env } from '@/env'

let posthogServerInstance: PostHog | null = null

/**
 * Get a PostHog server-side client instance.
 * Creates a singleton instance for reuse across requests.
 */
export function getPostHogServer(): PostHog {
  if (!env.NEXT_PUBLIC_POSTHOG_KEY) {
    // Return a no-op client if PostHog is not configured
    return {
      capture: () => {},
      identify: () => {},
      shutdown: async () => {},
    } as unknown as PostHog
  }

  if (!posthogServerInstance) {
    posthogServerInstance = new PostHog(env.NEXT_PUBLIC_POSTHOG_KEY, {
      host: env.NEXT_PUBLIC_POSTHOG_HOST,
      // Flush events every 30 seconds or when 20 events are queued
      flushAt: 20,
      flushInterval: 30000,
    })
  }

  return posthogServerInstance
}

/**
 * Capture a server-side event with automatic shutdown.
 * Use this for one-off events in API routes.
 */
export async function captureServerEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>
) {
  const posthog = getPostHogServer()
  posthog.capture({
    distinctId,
    event,
    properties,
  })
  await posthog.shutdown()
}
