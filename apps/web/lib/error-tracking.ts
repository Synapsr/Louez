/**
 * Server errors to PostHog error tracking: unhandled exceptions and 5xx only,
 * filtered, sanitized and capped by packages/api platform/error-reporting.ts
 * (docs/architecture/error-tracking.md). Off unless
 * POSTHOG_ERROR_TRACKING_ENABLED is "true" and NEXT_PUBLIC_POSTHOG_KEY is
 * set: development and tests send nothing.
 *
 * Its own client, not the analytics one (lib/posthog.ts), which callers shut
 * down after each event.
 */
import { PostHog } from "posthog-node";

import {
  createErrorThrottle,
  createServerErrorReporter,
  type ReportServerError,
} from "@louez/api/platform/error-reporting";
import { redactHandoffSecrets } from "@louez/api/platform/redact";

import { env } from "@/env";
import { log } from "@/lib/evlog";

/** Sending never holds a request up: one try, 3 seconds at most. */
const REQUEST_TIMEOUT_MS = 3_000;
/** When the process ends, the errors still queued get 2 seconds to leave. */
const SHUTDOWN_TIMEOUT_MS = 2_000;

export interface ErrorTrackingConfig {
  key: string;
  host: string;
  sampleRate: number;
  release: string | undefined;
}

/** The configuration that turns error tracking on, or null when it stays off. */
export function errorTrackingConfig(source: {
  POSTHOG_ERROR_TRACKING_ENABLED: boolean;
  POSTHOG_ERROR_TRACKING_SAMPLE_RATE: number;
  NEXT_PUBLIC_POSTHOG_KEY?: string;
  NEXT_PUBLIC_POSTHOG_HOST?: string;
  NEXT_PUBLIC_APP_VERSION?: string;
  NEXT_PHASE?: string;
}): ErrorTrackingConfig | null {
  if (!source.POSTHOG_ERROR_TRACKING_ENABLED || !source.NEXT_PUBLIC_POSTHOG_KEY) return null;
  // `next build` prerenders pages: its errors are the build's, not production's.
  if (source.NEXT_PHASE === "phase-production-build") return null;
  return {
    key: source.NEXT_PUBLIC_POSTHOG_KEY,
    host: source.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com",
    sampleRate: source.POSTHOG_ERROR_TRACKING_SAMPLE_RATE,
    release: source.NEXT_PUBLIC_APP_VERSION || undefined,
  };
}

function createReporter(): ReportServerError {
  const config = errorTrackingConfig({
    POSTHOG_ERROR_TRACKING_ENABLED: env.POSTHOG_ERROR_TRACKING_ENABLED,
    POSTHOG_ERROR_TRACKING_SAMPLE_RATE: env.POSTHOG_ERROR_TRACKING_SAMPLE_RATE,
    NEXT_PUBLIC_POSTHOG_KEY: env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: env.NEXT_PUBLIC_POSTHOG_HOST,
    NEXT_PUBLIC_APP_VERSION: env.NEXT_PUBLIC_APP_VERSION,
    NEXT_PHASE: process.env.NEXT_PHASE,
  });
  if (!config) return () => {};

  const client = new PostHog(config.key, {
    host: config.host,
    // Each error leaves at once, in the background: nothing waits for a batch.
    flushAt: 1,
    flushInterval: 0,
    requestTimeout: REQUEST_TIMEOUT_MS,
    fetchRetryCount: 0,
    disableGeoip: true,
    // Uncaught errors go through the reporter too (instrumentation.ts), capped.
    enableExceptionAutocapture: false,
  });
  process.once("beforeExit", () => {
    void client.shutdown(SHUTDOWN_TIMEOUT_MS).catch(() => undefined);
  });

  return createServerErrorReporter({
    // The shared redactor of the logs. To become the generic error sanitizer
    // (e-mails, tokens, keys, query strings) of packages/api once it lands:
    // keep POSTHOG_ERROR_TRACKING_ENABLED off until then.
    sanitize: redactHandoffSecrets,
    throttle: createErrorThrottle({ sampleRate: config.sampleRate }),
    send: (error, properties) => {
      // No distinct id: an anonymous event, which creates no person profile.
      client.captureException(error, undefined, {
        ...properties,
        service: "louez-web",
        ...(config.release ? { $app_version: config.release } : {}),
      });
    },
    onCapReached: () => {
      log.warn({ errorTracking: { event: "hourly_cap_reached" } });
    },
  });
}

let reporter: ReportServerError | undefined;

/**
 * Sends an unexpected server error to PostHog; ignores an expected one
 * (4xx). Never throws, never waits.
 */
export const reportServerError: ReportServerError = (error, context) => {
  try {
    reporter ??= createReporter();
    reporter(error, context);
  } catch {
    // Error tracking never adds a failure of its own.
  }
};
