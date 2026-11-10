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
  reportableCode,
  type ReportServerError,
} from "@louez/api/platform/error-reporting";

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

/** A source file of the repository, as `sanitizeError` writes a frame's location. */
const REPO_FILE = /^(?:apps|packages)\/[\w.@()[\]/-]{1,300}\.(?:[cm]?[jt]sx?)$/;

/**
 * A frame as it may leave: a file of the repository, its position, and the
 * SDK's flags. No function name, no module, and none of the source lines
 * posthog-node reads from disk around it (`pre_context`, `context_line`,
 * `post_context`). Any other frame (Node's own, an absolute path) is null.
 */
function safeFrame(frame: unknown): Record<string, unknown> | null {
  if (typeof frame !== "object" || frame === null) return null;
  const filename = Reflect.get(frame, "filename");
  if (typeof filename !== "string" || !REPO_FILE.test(filename)) return null;
  const kept: Record<string, unknown> = { filename, function: "?" };
  for (const key of ["lineno", "colno"]) {
    const value = Reflect.get(frame, key);
    if (typeof value === "number" && Number.isSafeInteger(value)) kept[key] = value;
  }
  const inApp = Reflect.get(frame, "in_app");
  if (typeof inApp === "boolean") kept.in_app = inApp;
  if (Reflect.get(frame, "platform") === "node:javascript") kept.platform = "node:javascript";
  return kept;
}

/** An exception's class, as `sanitizeError` writes it. */
const EXCEPTION_TYPE = /^(?:[A-Za-z]{1,60}|\[name\])$/;
/** The only texts the reporter's copy writes: none, a withheld message, a validation error's issues. */
const EXCEPTION_VALUE =
  /^(?:|\[message withheld\]|a thrown [a-z]{1,20}|\[unreadable error\]|\[cause cycle\]|\d{1,3} issue\(s\): [\w[\]. ;]{0,2000})$/;

function safeException(exception: unknown): Record<string, unknown> | null {
  if (typeof exception !== "object" || exception === null) return null;
  const type = Reflect.get(exception, "type");
  const value = Reflect.get(exception, "value");
  const stacktrace: unknown = Reflect.get(exception, "stacktrace");
  const frames = typeof stacktrace === "object" && stacktrace ? Reflect.get(stacktrace, "frames") : [];
  const mechanism: unknown = Reflect.get(exception, "mechanism");
  const handled = typeof mechanism === "object" && mechanism ? Reflect.get(mechanism, "handled") : undefined;
  return {
    type: typeof type === "string" && EXCEPTION_TYPE.test(type) ? type : "[name]",
    value: typeof value === "string" && EXCEPTION_VALUE.test(value) ? value : "[message withheld]",
    mechanism: { type: "generic", handled: handled !== false, synthetic: false },
    stacktrace: {
      type: "raw",
      frames: Array.isArray(frames) ? frames.map(safeFrame).filter((frame) => frame !== null) : [],
    },
  };
}

/** The reporter's fingerprint (`prepareServerError`): 32 hex characters, nothing else. */
const FINGERPRINT = /^[0-9a-f]{32}$/;
/** Names, ids, paths and versions the reporter sets: no space, nothing a caller wrote. */
const TOKEN = /^[\w.\-/[\]@:+]{1,200}$/;

/** The properties an event may carry, each with the only form it may take. */
const PROPERTIES: Readonly<Record<string, (value: unknown) => unknown>> = {
  $exception_fingerprint: (value) =>
    typeof value === "string" && FINGERPRINT.test(value) ? value : undefined,
  $exception_level: (value) => (value === "error" ? value : undefined),
  $process_person_profile: (value) => (value === false ? value : undefined),
  error_code: (value) => reportableCode(value),
  http_status: (value) => (typeof value === "number" && Number.isSafeInteger(value) ? value : undefined),
  repeats_suppressed: (value) =>
    typeof value === "number" && Number.isSafeInteger(value) ? value : undefined,
  ...Object.fromEntries(
    [
      "source",
      "transport",
      "procedure",
      "mcp_tool",
      "route",
      "route_type",
      "cron_task",
      "job_operation",
      "effect_type",
      "client_kind",
      "client_directory",
      "service",
      "$app_version",
    ].map((key) => [
      key,
      (value: unknown) => (typeof value === "string" && TOKEN.test(value) ? value : undefined),
    ]),
  ),
};

/**
 * The last gate, on the event as posthog-node sends it (`before_send`): the
 * reporter's copy holds no text, but the SDK adds to it, such as the source
 * lines around each frame, read from the files. What leaves is rebuilt from
 * allowlists: the exceptions' classes and the reporter's own texts, frames
 * in the repository's files, and the reporter's properties in their own
 * forms. Anything else is dropped; any event but an exception is refused.
 */
export function sanitizeExceptionEvent(event: EventMessage | null): EventMessage | null {
  if (!event || event.event !== "$exception") return null;
  const properties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event.properties ?? {})) {
    if (key === "$exception_list") {
      properties[key] = Array.isArray(value)
        ? value.map(safeException).filter((exception) => exception !== null)
        : [];
      continue;
    }
    const safe = Object.hasOwn(PROPERTIES, key) ? PROPERTIES[key]?.(value) : undefined;
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
