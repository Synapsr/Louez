import 'server-only';

import { getPostHogServer, shutdownPostHogServer } from '@/lib/posthog';
import {
  type ReferralAnalyticsEvent,
  referralAnalyticsBaseProperties,
} from '@/lib/referral/analytics-events';

export async function captureReferralServerEvent({
  distinctId,
  event,
  properties,
}: {
  distinctId: string | null | undefined;
  event: ReferralAnalyticsEvent;
  properties?: Record<string, unknown>;
}) {
  if (!distinctId) return;

  try {
    const posthog = getPostHogServer();
    posthog.capture({
      distinctId,
      event,
      properties: {
        ...referralAnalyticsBaseProperties,
        ...properties,
      },
    });
    await shutdownPostHogServer();
  } catch {
    // Product analytics must never block onboarding, payment confirmation, or refunds.
  }
}
