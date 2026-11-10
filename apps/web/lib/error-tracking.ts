/**
 * Server errors to PostHog error tracking: unhandled exceptions and 5xx only,
 * filtered, sanitized and capped by packages/api platform/error-reporting.ts
 * (docs/architecture/error-tracking.md). Off unless
 * POSTHOG_ERROR_TRACKING_ENABLED is "true" (or "1") and NEXT_PUBLIC_POSTHOG_KEY
 * is set: development and tests send nothing.
 *
 * Its own client, not the analytics one (lib/posthog.ts), which callers shut
 * down after each event.
 */
import { PostHog, type EventMessage, type PostHogOptions } from "posthog-node";

import {
  createErrorThrottle,
  createServerErrorReporter,
  safeErrorCode,
  type ReportServerError,
} from "@louez/api/platform/error-reporting";
import { sanitizeText } from "@louez/api/platform/sanitize-error";
import { relativeSourcePath } from "@louez/api/platform/source-paths";

import { env } from "@/env";
import { log } from "@/lib/evlog";

/** Sending never holds a request up: one try, 3 seconds at most. */
const REQUEST_TIMEOUT_MS = 3_000;

export interface ErrorTrackingConfig {
  key: string;
  host: string;
  sampleRate: number;
  release: string | undefined;
}

/**
 * Whether a flag is on: only an explicit "true" or "1". The value is parsed
 * here because, with SKIP_ENV_VALIDATION, `env` hands over the raw string
 * ("false" included) instead of the schema's boolean.
 */
export function isFlagOn(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  const flag = value.trim().toLowerCase();
  return flag === "true" || flag === "1";
}

/** A share from 0 to 1, raw or parsed; anything else counts as 1 (all sent). */
export function parseSampleRate(value: unknown): number {
  const rate = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof rate === "number" && Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 1;
}

/** The configuration that turns error tracking on, or null when it stays off. */
export function errorTrackingConfig(source: {
  POSTHOG_ERROR_TRACKING_ENABLED?: unknown;
  POSTHOG_ERROR_TRACKING_SAMPLE_RATE?: unknown;
  NEXT_PUBLIC_POSTHOG_KEY?: string;
  NEXT_PUBLIC_POSTHOG_HOST?: string;
  NEXT_PUBLIC_APP_VERSION?: string;
  NEXT_PHASE?: string;
}): ErrorTrackingConfig | null {
  if (!isFlagOn(source.POSTHOG_ERROR_TRACKING_ENABLED) || !source.NEXT_PUBLIC_POSTHOG_KEY) {
    return null;
  }
  // `next build` prerenders pages: its errors are the build's, not production's.
  if (source.NEXT_PHASE === "phase-production-build") return null;
  return {
    key: source.NEXT_PUBLIC_POSTHOG_KEY,
    host: source.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com",
    sampleRate: parseSampleRate(source.POSTHOG_ERROR_TRACKING_SAMPLE_RATE),
    release: source.NEXT_PUBLIC_APP_VERSION || undefined,
  };
}

/** Source lines posthog-node reads from disk next to each frame: never sent. */
const SOURCE_CONTEXT = ["pre_context", "context_line", "post_context"] as const;

function sanitizeFrame(frame: unknown): void {
  if (typeof frame !== "object" || frame === null) return;
  for (const key of SOURCE_CONTEXT) Reflect.deleteProperty(frame, key);
  for (const key of ["filename", "abs_path"]) {
    const path = Reflect.get(frame, key);
    if (typeof path === "string") Reflect.set(frame, key, relativeSourcePath(path));
  }
  for (const key of ["function", "module"]) {
    const text = Reflect.get(frame, key);
    if (typeof text === "string") Reflect.set(frame, key, sanitizeText(text));
  }
}

function sanitizeExceptionList(exceptions: unknown): void {
  if (!Array.isArray(exceptions)) return;
  for (const exception of exceptions) {
    if (typeof exception !== "object" || exception === null) continue;
    for (const key of ["type", "value"]) {
      const text = Reflect.get(exception, key);
      if (typeof text === "string") Reflect.set(exception, key, sanitizeText(text));
    }
    const stacktrace: unknown = Reflect.get(exception, "stacktrace");
    const frames =
      typeof stacktrace === "object" && stacktrace ? Reflect.get(stacktrace, "frames") : [];
    if (Array.isArray(frames)) frames.forEach(sanitizeFrame);
  }
}

/** The reporter's fingerprint (`prepareServerError`): 32 hex characters, nothing else. */
const FINGERPRINT = /^[0-9a-f]{32}$/;

/**
 * A property as it may leave: a number or a boolean as it is, the
 * fingerprint and the code only in their own format, any other string
 * sanitized. Anything else is dropped.
 */
function safeProperty(key: string, value: unknown): unknown {
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  if (key === "$exception_fingerprint") return FINGERPRINT.test(value) ? value : undefined;
  if (key === "error_code") return safeErrorCode(value);
  return sanitizeText(value);
}

/**
 * The last gate, on the event as posthog-node sends it (`before_send`): the
 * reporter's copy is already sanitized, but the SDK adds the source lines
 * around each frame, read from the files after that. They are dropped,
 * paths made relative, and every string the event keeps sanitized again
 * (`safeProperty`). Any event but an exception is refused: this client
 * sends nothing else.
 */
export function sanitizeExceptionEvent(event: EventMessage | null): EventMessage | null {
  if (!event || event.event !== "$exception") return null;
  const properties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event.properties ?? {})) {
    if (key === "$exception_list") {
      sanitizeExceptionList(value);
      properties[key] = value;
      continue;
    }
    const safe = safeProperty(key, value);
    if (safe !== undefined) properties[key] = safe;
  }
  return { ...event, properties };
}

/** The PostHog client of error tracking. `overrides` are for tests (a fake `fetch`). */
export function createErrorTrackingClient(
  config: ErrorTrackingConfig,
  overrides: Partial<PostHogOptions> = {},
): PostHog {
  return new PostHog(config.key, {
    host: config.host,
    // Each error leaves at once, in the background: nothing waits in a buffer
    // for a batch or for the process to stop.
    flushAt: 1,
    flushInterval: 0,
    requestTimeout: REQUEST_TIMEOUT_MS,
    fetchRetryCount: 0,
    disableGeoip: true,
    // Uncaught errors go through the reporter too (instrumentation.ts), capped.
    enableExceptionAutocapture: false,
    before_send: sanitizeExceptionEvent,
    ...overrides,
  });
}

/**
 * A reporter that sends through a client of `config`. Events leave as they
 * are captured; nothing listens for the process to stop (SIGTERM, SIGINT,
 * `beforeExit`): Next's server handles those signals. An event still in
 * flight when the process exits is lost.
 */
export function createPostHogErrorReporter(
  config: ErrorTrackingConfig,
  overrides: Partial<PostHogOptions> = {},
): ReportServerError {
  const client = createErrorTrackingClient(config, overrides);
  return createServerErrorReporter({
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

function createReporter(): ReportServerError {
  const config = errorTrackingConfig({
    POSTHOG_ERROR_TRACKING_ENABLED: env.POSTHOG_ERROR_TRACKING_ENABLED,
    POSTHOG_ERROR_TRACKING_SAMPLE_RATE: env.POSTHOG_ERROR_TRACKING_SAMPLE_RATE,
    NEXT_PUBLIC_POSTHOG_KEY: env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: env.NEXT_PUBLIC_POSTHOG_HOST,
    NEXT_PUBLIC_APP_VERSION: env.NEXT_PUBLIC_APP_VERSION,
    NEXT_PHASE: process.env.NEXT_PHASE,
  });
  return config ? createPostHogErrorReporter(config) : () => {};
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
