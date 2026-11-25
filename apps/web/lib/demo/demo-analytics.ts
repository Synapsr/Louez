import "server-only";

import {
  firstTouchEventProperties,
  readCookie,
  readFirstTouch,
} from "@/lib/acquisition/first-touch";
import { captureServerEvent } from "@/lib/posthog";

import { env } from "@/env";

import type { DemoVerticalKey } from "./verticals/types";

/**
 * The demo's own funnel in PostHog: `demo_started`, `demo_step` and
 * `demo_signup_clicked`, each with the trade (`vertical`). They are the only
 * events a demo store sends: its business events (bookings, payments…) are
 * left out by the product analytics (lib/product-analytics/analytics.ts).
 *
 * The events are counted on the visitor's PostHog id when the louez.io site
 * left one in its cookie, so the funnel continues the website's; otherwise on
 * the demo's visitor id. No person profile is written.
 */
export const demoAnalyticsEvents = {
  started: "demo_started",
  step: "demo_step",
  signupClicked: "demo_signup_clicked",
} as const;

/** The distinct id PostHog's browser library keeps in its cookie, when it is there. */
export function readPostHogDistinctId(headers: Headers): string | null {
  const key = env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return null;
  const raw = readCookie(headers.get("cookie"), `ph_${key}_posthog`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as { distinct_id?: unknown };
    return typeof parsed.distinct_id === "string" && parsed.distinct_id.length <= 200
      ? parsed.distinct_id
      : null;
  } catch {
    return null;
  }
}

export async function captureDemoEvent(input: {
  event: (typeof demoAnalyticsEvents)[keyof typeof demoAnalyticsEvents];
  vertical: DemoVerticalKey;
  visitorId: string;
  headers: Headers;
  properties?: Record<string, string | number | boolean | null>;
}): Promise<void> {
  const distinctId = readPostHogDistinctId(input.headers) ?? `demo:${input.visitorId}`;
  const { $set_once: _ignored, ...attribution } = firstTouchEventProperties(
    readFirstTouch(input.headers),
  );
  try {
    await captureServerEvent(distinctId, input.event, {
      ...attribution,
      ...input.properties,
      vertical: input.vertical,
      demo_visitor_id: input.visitorId,
      $process_person_profile: false,
    });
  } catch {
    // Analytics never break the demo.
  }
}
