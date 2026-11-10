import { createHash } from "node:crypto";

import { ORPCError } from "@orpc/server";

import type { BaseContext } from "../context";
import type { CredentialKind, Transport } from "./actor";
import type { ClientDirectory } from "./agent-clients";

/**
 * Server errors sent to error tracking (the app sends them to PostHog,
 * apps/web lib/error-tracking.ts). Only what nobody expected: an exception, a
 * 5xx. A refusal (4xx: validation, not found, a confirmation to ask, a rate
 * limit…) is the API working, never sent. What is sent is a copy of the
 * error, its message and frames sanitized, with the safe context below:
 * never a body, a header, a token or a customer's data.
 */

/** Where the error was caught. */
export type ServerErrorSource =
  | "procedure"
  | "mcp_tool"
  | "request"
  | "cron"
  | "job"
  | "effects"
  | "process";

/** Who called, as far as the call got before it failed. */
export interface ErrorScope {
  storeId?: string;
  /** The credential's kind, or a storefront visitor. */
  client?: CredentialKind | "storefront";
  /** The OAuth client's directory (ChatGPT/Codex, Claude). */
  directory?: ClientDirectory;
}

/** What may go with an error: names and ids, nothing a caller sent. */
export interface ServerErrorContext extends ErrorScope {
  source: ServerErrorSource;
  transport?: Transport;
  /** The procedure's path, dotted (`inbox.list`). */
  procedure?: string;
  /** An MCP tool that is not a procedure. */
  tool?: string;
  /** A Next route as declared (`/api/v1/[[...path]]`), never the requested URL. */
  route?: string;
  /** Next's kind of route: `render`, `route`, `action`, `proxy`. */
  routeType?: string;
  /** A cron task's name. */
  task?: string;
}

/** Sends an unexpected error with its context; ignores any other. Never throws. */
export type ReportServerError = (error: unknown, context: ServerErrorContext) => void;

/**
 * Takes out of a message or a stack frame what must not leave the server:
 * e-mails, tokens, keys, a URL's query, a handoff's secrets. Given by the app.
 */
export type TextSanitizer = (text: string) => string;

// --- Which errors -------------------------------------------------------------

/** Error names that are a caller leaving, not a fault. */
const EXPECTED_NAMES = new Set(["AbortError", "ResponseAborted"]);

/**
 * Next's control flow, thrown on purpose (`redirect()`, `notFound()`, dynamic
 * rendering bailouts), recognized by its `digest`; and React's postpone.
 */
const NEXT_CONTROL_FLOW =
  /^(?:NEXT_REDIRECT|NEXT_HTTP_ERROR_FALLBACK|DYNAMIC_SERVER_USAGE|HANGING_PROMISE_REJECTION|NEXT_PRERENDER_INTERRUPTED|NEXT_STATIC_GEN_BAILOUT|BAILOUT_TO_CLIENT_SIDE_RENDERING)\b/;
const REACT_POSTPONE = Symbol.for("react.postpone");

function isControlFlow(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (Reflect.get(error, "$$typeof") === REACT_POSTPONE) return true;
  const digest = Reflect.get(error, "digest");
  return typeof digest === "string" && NEXT_CONTROL_FLOW.test(digest);
}

/** The HTTP status the caller gets for `error`: an oRPC error's own, else 500. */
export function serverErrorStatus(error: unknown): number {
  if (error instanceof ORPCError) return error.status;
  // A route's evlog error (`createError({ status })`) answers with its status.
  if (error instanceof Error && error.name === "EvlogError") {
    const status = Reflect.get(error, "status");
    if (typeof status === "number" && status >= 100 && status < 600) return status;
  }
  return 500;
}

/**
 * Whether `error` is a fault worth tracking: a 5xx or anything that is not
 * an HTTP error. A 503 our code marks retryable (a large body waiting for
 * its turn) is a planned refusal; a caller that went away is no fault.
 */
export function isUnexpectedServerError(error: unknown): boolean {
  if (error instanceof Error && EXPECTED_NAMES.has(error.name)) return false;
  if (isControlFlow(error)) return false;
  const status = serverErrorStatus(error);
  if (status < 500) return false;
  if (error instanceof ORPCError && status === 503) {
    return (error.data as { retryable?: unknown } | undefined)?.retryable !== true;
  }
  return true;
}

// --- The copy that is sent -----------------------------------------------------

/** Frames kept per error: the top ones say where it broke. */
const MAX_FRAMES = 30;
/** A message longer than this is cut: the start says what broke. */
const MAX_MESSAGE_LENGTH = 1_000;
/** Causes followed below the error (a database error under a service's). */
const MAX_CAUSE_DEPTH = 2;

const FRAME = /^\s+at /;

/** An error's code, when it has a short one (oRPC's, ours, a driver's SQLSTATE). */
export function errorCode(error: unknown): string | undefined {
  if (error instanceof ORPCError) {
    const ours = (error.data as { code?: unknown } | undefined)?.code;
    return typeof ours === "string" ? ours : error.code;
  }
  if (!(error instanceof Error)) return undefined;
  const code = Reflect.get(error, "code");
  return typeof code === "string" || typeof code === "number"
    ? String(code).slice(0, 64)
    : undefined;
}

/**
 * The message without what a driver appends: Drizzle's failed query ends with
 * `params: …`, the values of the query (a customer's e-mail, a name).
 */
function ownMessage(message: string): string {
  const params = message.indexOf("\nparams:");
  return params === -1 ? message : message.slice(0, params);
}

function safeCopy(error: unknown, sanitize: TextSanitizer, depth: number): Error {
  if (!(error instanceof Error)) {
    const copy = new Error(sanitize(String(error)).slice(0, MAX_MESSAGE_LENGTH));
    copy.name = "NonErrorThrown";
    copy.stack = `${copy.name}: ${copy.message}`;
    return copy;
  }
  const message = sanitize(ownMessage(error.message)).slice(0, MAX_MESSAGE_LENGTH);
  const copy = new Error(message);
  copy.name = error.name;
  const frames = (error.stack ?? "")
    .split("\n")
    .filter((line) => FRAME.test(line))
    .slice(0, MAX_FRAMES)
    .map(sanitize);
  copy.stack = [`${copy.name}: ${message}`, ...frames].join("\n");
  if (error.cause !== undefined && depth < MAX_CAUSE_DEPTH) {
    copy.cause = safeCopy(error.cause, sanitize, depth + 1);
  }
  return copy;
}

/**
 * The message with what varies between two hits of the same fault replaced:
 * ids, numbers, quoted values.
 */
export function messageTemplate(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/(["'`])[^"'`\n]{0,200}\1/g, "<value>")
    .replace(/\b[A-Za-z0-9_-]{12,}\b/g, (word) => (/\d/.test(word) ? "<id>" : word))
    .replace(/\d+(?:\.\d+)?/g, "<n>")
    .slice(0, 200);
}

/** The first frame in our code, without its line and column, which move with every release. */
function topFrame(stack: string | undefined): string {
  const frames = (stack ?? "").split("\n").filter((line) => FRAME.test(line));
  const ours = frames.find((line) => !line.includes("node_modules") && !line.includes("node:"));
  return (ours ?? frames[0] ?? "").trim().replace(/:\d+:\d+\)?$/, "");
}

export interface PreparedServerError {
  /** The copy to send: sanitized message and frames, causes included. */
  error: Error;
  /** Type, message template and top frame, hashed: one per fault. */
  fingerprint: string;
  code?: string;
}

export function prepareServerError(error: unknown, sanitize: TextSanitizer): PreparedServerError {
  const copy = safeCopy(error, sanitize, 0);
  const code = errorCode(error);
  const key = [
    copy.name,
    code ?? "",
    messageTemplate(copy.message),
    topFrame(error instanceof Error ? error.stack : undefined),
  ].join("|");
  const fingerprint = createHash("sha256").update(key).digest("hex").slice(0, 32);
  return { error: copy, fingerprint, ...(code ? { code } : {}) };
}

// --- How many ------------------------------------------------------------------

/**
 * One fault sent at most once per 10 minutes per process: an issue needs a
 * sample and a count, not every hit. The repeats in between are counted and
 * sent with the next one (`repeats_suppressed`).
 */
export const ERROR_REPEAT_WINDOW_MS = 10 * 60 * 1000;
/**
 * At most 20 errors per hour per process, all faults together: PostHog's
 * free plan, and a broken dependency must not spend the month's quota in a
 * day (20 × 24 × 30 = 14,400 a month at worst).
 */
export const ERROR_HOURLY_CAP = 20;
/** Faults remembered for the repeat window; the oldest are forgotten past it. */
export const MAX_TRACKED_FAULTS = 500;

const HOUR_MS = 60 * 60 * 1000;

export type ThrottleDecision =
  | { admitted: true; repeatsSuppressed: number }
  | { admitted: false; reason: "repeat" | "sampled" | "capped" };

export interface ErrorThrottleOptions {
  /** Share of the faults sent, from 0 to 1 (`POSTHOG_ERROR_TRACKING_SAMPLE_RATE`). */
  sampleRate?: number;
  repeatWindowMs?: number;
  hourlyCap?: number;
  maxTracked?: number;
  now?: () => number;
  random?: () => number;
}

/** Decides, per fingerprint, which errors are sent. One per process. */
export function createErrorThrottle(options: ErrorThrottleOptions = {}) {
  const {
    sampleRate = 1,
    repeatWindowMs = ERROR_REPEAT_WINDOW_MS,
    hourlyCap = ERROR_HOURLY_CAP,
    maxTracked = MAX_TRACKED_FAULTS,
    now = Date.now,
    random = Math.random,
  } = options;
  // In the order sent, oldest first: a Map keeps insertion order.
  const faults = new Map<string, { sentAt: number; suppressed: number }>();
  let hour = { start: Number.NEGATIVE_INFINITY, sent: 0 };

  return {
    admit(fingerprint: string): ThrottleDecision {
      const time = now();
      const known = faults.get(fingerprint);
      if (known && time - known.sentAt < repeatWindowMs) {
        known.suppressed += 1;
        return { admitted: false, reason: "repeat" };
      }
      if (random() >= sampleRate) return { admitted: false, reason: "sampled" };
      if (time - hour.start >= HOUR_MS) hour = { start: time, sent: 0 };
      if (hour.sent >= hourlyCap) return { admitted: false, reason: "capped" };
      hour.sent += 1;
      faults.delete(fingerprint);
      faults.set(fingerprint, { sentAt: time, suppressed: 0 });
      while (faults.size > maxTracked) {
        const oldest = faults.keys().next().value;
        if (oldest === undefined) break;
        faults.delete(oldest);
      }
      return { admitted: true, repeatsSuppressed: known?.suppressed ?? 0 };
    },
  };
}

export type ErrorThrottle = ReturnType<typeof createErrorThrottle>;

// --- The reporter ----------------------------------------------------------------

/** What goes with the error to error tracking. */
export type ServerErrorProperties = Record<string, string | number>;

/**
 * A `ReportServerError` that filters, prepares and throttles, then hands the
 * copy to `send`. It never throws and never waits: `send` must not either.
 */
export function createServerErrorReporter(options: {
  send: (error: Error, properties: ServerErrorProperties) => void;
  sanitize: TextSanitizer;
  throttle: ErrorThrottle;
  /** Called once per hour at most, when the hourly cap starts dropping errors. */
  onCapReached?: () => void;
}): ReportServerError {
  let capNoticeAt = Number.NEGATIVE_INFINITY;
  return (error, context) => {
    try {
      if (!isUnexpectedServerError(error)) return;
      const prepared = prepareServerError(error, options.sanitize);
      const decision = options.throttle.admit(prepared.fingerprint);
      if (!decision.admitted) {
        if (decision.reason === "capped" && Date.now() - capNoticeAt >= HOUR_MS) {
          capNoticeAt = Date.now();
          options.onCapReached?.();
        }
        return;
      }
      const properties: ServerErrorProperties = {
        $exception_fingerprint: prepared.fingerprint,
        source: context.source,
        http_status: serverErrorStatus(error),
        repeats_suppressed: decision.repeatsSuppressed,
      };
      if (prepared.code) properties.error_code = prepared.code;
      const fields = [
        "transport",
        "procedure",
        "tool",
        "route",
        "routeType",
        "task",
        "storeId",
        "client",
        "directory",
      ] as const;
      for (const field of fields) {
        const value = context[field];
        if (typeof value === "string" && value.length > 0) {
          properties[SNAKE[field]] = value.slice(0, 200);
        }
      }
      options.send(prepared.error, properties);
    } catch {
      // Error tracking never adds a failure of its own.
    }
  };
}

const SNAKE = {
  transport: "transport",
  procedure: "procedure",
  tool: "mcp_tool",
  route: "route",
  routeType: "route_type",
  task: "cron_task",
  storeId: "store_id",
  client: "client_kind",
  directory: "client_directory",
} as const;

// --- The oRPC hook ----------------------------------------------------------------

/**
 * oRPC client interceptor that reports a procedure's unexpected error through
 * `ports.reportError`, then rethrows it unchanged. On every transport: the
 * RPC and OpenAPI handlers' `clientInterceptors`, and MCP's `call()`. It
 * wraps the middlewares and the validation, so it sees an output that breaks
 * its contract too. The procedures fill `errorScope` as they learn who calls.
 */
export async function reportUnexpectedErrors<
  TOptions extends { context: BaseContext; path: readonly string[] },
  TResult,
>(options: TOptions & { next: (options?: TOptions) => Promise<TResult> }): Promise<TResult> {
  const { next, ...rest } = options;
  const report = rest.context.ports?.reportError;
  if (!report) return next();
  const errorScope: ErrorScope = {};
  try {
    return await next({ ...rest, context: { ...rest.context, errorScope } } as unknown as TOptions);
  } catch (error) {
    report(error, {
      source: "procedure",
      transport: rest.context.transport,
      procedure: rest.path.join("."),
      ...errorScope,
    });
    throw error;
  }
}
