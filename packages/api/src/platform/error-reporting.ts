import { createHash } from "node:crypto";

import { ORPCError } from "@orpc/server";

import type { BaseContext } from "../context";
import type { CredentialKind, Transport } from "./actor";
import type { ClientDirectory } from "./agent-clients";
import { sanitizeError, sanitizeText, type SanitizedError } from "./sanitize-error";
import { relativeFramePath } from "./source-paths";

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
  /** A background job's operation (`enhance`, `remove_background`…). */
  job?: string;
  /** An outbox effect's type (`reservation.customerMessage`…). */
  effect?: string;
}

/** Sends an unexpected error with its context; ignores any other. Never throws. */
export type ReportServerError = (error: unknown, context: ServerErrorContext) => void;

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
/** Generic 5xx errors unwrapped to reach the fault (`rootFault`). */
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

/** Issues of a validation error (Zod's) named, never their values. */
const MAX_ISSUES = 5;

/** A validation error's issues as codes and paths: its own message may quote the input. */
function issuesMessage(error: unknown): string | undefined {
  const issues: unknown = error instanceof Error ? Reflect.get(error, "issues") : undefined;
  if (!Array.isArray(issues)) return undefined;
  const named = issues.slice(0, MAX_ISSUES).map((issue: unknown) => {
    const code = typeof issue === "object" && issue ? Reflect.get(issue, "code") : undefined;
    const path = typeof issue === "object" && issue ? Reflect.get(issue, "path") : undefined;
    const at = Array.isArray(path) ? path.map((part) => String(part)).join(".") : "";
    return `${typeof code === "string" ? code : "invalid"}${at ? ` at ${at}` : ""}`;
  });
  const more = issues.length > MAX_ISSUES ? ` (+${issues.length - MAX_ISSUES})` : "";
  return sanitizeText(`${issues.length} issue(s): ${named.join("; ")}${more}`);
}

/** An Error built back from the sanitized facts, as posthog-node reads it. */
function toError(facts: SanitizedError, message: string): Error {
  const copy = new Error(message);
  copy.name = facts.name === "NonError" ? "NonErrorThrown" : facts.name;
  const frames = facts.frames.map((frame) => `    ${relativeFramePath(frame)}`);
  copy.stack = [`${copy.name}: ${message}`, ...frames].join("\n");
  if (facts.cause) copy.cause = toError(facts.cause, facts.cause.message);
  return copy;
}

/**
 * The copy that is sent: the allowlisted, sanitized facts of
 * `sanitizeError` (name, message, frames, causes), never the error object.
 */
function safeCopy(error: unknown): Error {
  const facts = sanitizeError(error, { frames: MAX_FRAMES });
  return toError(facts, issuesMessage(error) ?? facts.message);
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

/**
 * The fault under a generic server error: a 5xx oRPC error that wraps
 * another (`toORPCError` keeps it as `cause`) stands for its cause, so two
 * different faults behind `errors.internalServerError` stay two.
 */
export function rootFault(error: unknown): unknown {
  let fault = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (!(fault instanceof ORPCError) || fault.status < 500 || fault.cause === undefined) break;
    fault = fault.cause;
  }
  return fault;
}

export interface PreparedServerError {
  /** The copy to send: sanitized message and frames, causes included. */
  error: Error;
  /** Type, message template and top frame, hashed: one per fault. */
  fingerprint: string;
  code?: string;
}

/** The root fault's copy and fingerprint (`rootFault`). */
export function prepareServerError(error: unknown): PreparedServerError {
  const fault = rootFault(error);
  const copy = safeCopy(fault);
  const code = errorCode(fault);
  const key = [copy.name, code ?? "", messageTemplate(copy.message), topFrame(copy.stack)].join(
    "|",
  );
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
  throttle: ErrorThrottle;
  /** Called once per hour at most, when the hourly cap starts dropping errors. */
  onCapReached?: () => void;
}): ReportServerError {
  let capNoticeAt = Number.NEGATIVE_INFINITY;
  return (error, context) => {
    try {
      if (!isUnexpectedServerError(error)) return;
      const prepared = prepareServerError(error);
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
        "job",
        "effect",
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
  job: "job_operation",
  effect: "effect_type",
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
