"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider, usePostHog } from "posthog-js/react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, Suspense } from "react";
import { usePublicEnv } from "@/components/shared/public-env-provider";

type SalesChannel = "marketplace";

/**
 * Tracks page views on route changes in Next.js App Router.
 * Must be used inside PostHogProvider and Suspense boundary.
 */
function PostHogPageView({ channel }: { channel?: SalesChannel }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const posthogClient = usePostHog();

  useEffect(() => {
    if (pathname && posthogClient) {
      let url = window.origin + pathname;
      const search = searchParams?.toString();
      if (search) {
        url = url + "?" + search;
      }
      posthogClient.capture("$pageview", {
        $current_url: url,
        ...(channel && { channel }),
      });
    }
  }, [channel, pathname, searchParams, posthogClient]);

  return null;
}

/**
 * Identifies user in PostHog for session replay attribution.
 * Must be used inside PostHogProvider.
 */
function PostHogIdentify({ user }: { user: PostHogProviderProps["user"] }) {
  const posthogClient = usePostHog();

  useEffect(() => {
    if (posthogClient && user) {
      posthogClient.identify(user.id, {
        email: user.email,
        name: user.name || undefined,
      });
    }
  }, [posthogClient, user]);

  return null;
}

interface PostHogProviderProps {
  children: React.ReactNode;
  channel?: SalesChannel;
  user?: {
    id: string;
    email: string;
    name?: string | null;
  };
}

/**
 * PostHog analytics provider for client-side tracking.
 *
 * Wraps the application to enable:
 * - Automatic page view tracking on route changes
 * - Access to PostHog hooks (usePostHog, useFeatureFlag, etc.)
 * - Session recording and analytics
 *
 * The root PostHogBootstrap initializes the SDK from validated runtime
 * configuration before route-level analytics effects run. This provider adds
 * the React context and user-aware tracking for configured deployments.
 */
export function PostHogProvider({ children, channel, user }: PostHogProviderProps) {
  const { NEXT_PUBLIC_POSTHOG_KEY: posthogKey } = usePublicEnv();

  useEffect(() => {
    if (!posthogKey) {
      return;
    }

    if (channel) {
      posthog.register_for_session({ channel });
    } else {
      posthog.unregister_for_session("channel");
    }
  }, [channel, posthogKey]);

  // Skip rendering if PostHog is not configured
  if (!posthogKey) {
    return <>{children}</>;
  }

  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageView channel={channel} />
      </Suspense>
      {user && <PostHogIdentify user={user} />}
      {children}
    </PHProvider>
  );
}
