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
  type ReportServerError,
} from "@louez/api/platform/error-reporting";
import { sanitizeText } from "@louez/api/platform/sanitize-error";
import { relativeSourcePath } from "@louez/api/platform/source-paths";

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
  const name = Reflect.get(frame, "function");
  if (typeof name === "string") Reflect.set(frame, "function", sanitizeText(name));
}

/**
 * The last gate, on the event as posthog-node sends it (`before_send`): the
 * reporter's copy is already sanitized, but the SDK adds the source lines
 * around each frame, read from the files after that. They are dropped,
 * paths made relative, messages sanitized again. Any event but an exception
 * is refused: this client sends nothing else.
 */
export function sanitizeExceptionEvent(event: EventMessage | null): EventMessage | null {
  if (!event || event.event !== "$exception") return null;
  const exceptions: unknown = event.properties?.$exception_list;
  if (Array.isArray(exceptions)) {
    for (const exception of exceptions) {
      if (typeof exception !== "object" || exception === null) continue;
      const value = Reflect.get(exception, "value");
      if (typeof value === "string") Reflect.set(exception, "value", sanitizeText(value));
      const stacktrace: unknown = Reflect.get(exception, "stacktrace");
      const frames =
        typeof stacktrace === "object" && stacktrace ? Reflect.get(stacktrace, "frames") : [];
      if (Array.isArray(frames)) frames.forEach(sanitizeFrame);
    }
  }
  return event;
}

/** The PostHog client of error tracking. `overrides` are for tests (a fake `fetch`). */
export function createErrorTrackingClient(
  config: ErrorTrackingConfig,
  overrides: Partial<PostHogOptions> = {},
): PostHog {
  return new PostHog(config.key, {
    host: config.host,
    // Each error leaves at once, in the background: nothing waits for a batch.
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

/** What `flushOnSignals` needs of the process. */
export interface SignalTarget {
  pid: number;
  on(signal: NodeJS.Signals, listener: () => void): unknown;
  off(signal: NodeJS.Signals, listener: () => void): unknown;
  listenerCount(signal: NodeJS.Signals): number;
  kill(pid: number, signal: NodeJS.Signals): unknown;
}

const STOP_SIGNALS: readonly NodeJS.Signals[] = ["SIGTERM", "SIGINT"];

/**
 * Starts `flush` when the process is told to stop. Next's server handles
 * SIGTERM and SIGINT itself (it drains the requests, then exits): this only
 * adds to it, never holds it. Without any other listener
 * (NEXT_MANUAL_SIG_HANDLE), the signal is raised again once flushed, so it
 * still stops the process.
 */
export function flushOnSignals(flush: () => Promise<unknown>, target: SignalTarget = process) {
  const onSignal = (signal: NodeJS.Signals) => {
    for (const other of STOP_SIGNALS) target.off(other, listeners[other]);
    const alone = target.listenerCount(signal) === 0;
    void flush()
      .catch(() => undefined)
      .finally(() => {
        if (alone) target.kill(target.pid, signal);
      });
  };
  const listeners = Object.fromEntries(
    STOP_SIGNALS.map((signal) => [signal, () => onSignal(signal)]),
  ) as Record<NodeJS.Signals, () => void>;
  for (const signal of STOP_SIGNALS) target.on(signal, listeners[signal]);
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

  const client = createErrorTrackingClient(config);
  const shutdown = () => client.shutdown(SHUTDOWN_TIMEOUT_MS);
  process.once("beforeExit", () => void shutdown().catch(() => undefined));
  flushOnSignals(shutdown);

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
