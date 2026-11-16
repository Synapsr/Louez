import { ORPCError } from "@orpc/server";

import type { BaseContext } from "../context";
import type { Transport } from "./actor";
import type { ErrorScope } from "./error-reporting";

/**
 * How a refused call is logged (docs/architecture/api-and-agents.md, "Logs"). A
 * refusal (any 4xx: a confirmation or an approval to ask, a validation error, a
 * record not found, a limit) is the API working: the request log records what it
 * was and who asked, by code and ids, and never its words. Its message, its
 * preview and its stack are built from what the store holds (a customer's name,
 * amounts, dates) or from what the caller sent, and stay in the answer the caller
 * gets, which this changes in nothing. A fault (a 5xx, or anything that is not an
 * HTTP error) is logged as it was: the error itself.
 */

/** A refused call, as the request log keeps it. */
export interface RefusalLogEvent {
  /** Louez's code (`data.code`), else oRPC's own (`BAD_REQUEST`). */
  code: string;
  status: number;
  /** The procedure's path, dotted, when the call reached one. */
  procedure?: string;
  transport?: Transport;
  /** Who called and on which store, as far as the call got. */
  storeId?: string;
  actorId?: string;
  client?: ErrorScope["client"];
  /**
   * The ids the refusal is about, by their path in its details
   * (`preview.reservation.id`): only plain identifiers, never a token.
   */
  ids?: Record<string, string>;
  /** A validation error's issues: their codes and the fields they name, never their words. */
  issues?: string[];
}

/** Where a transport's log goes: a refusal's facts, and a fault as it is. */
export interface RequestLogSink {
  refusal: (event: RefusalLogEvent) => void;
  fault: (error: Error) => void;
}

/** The refusals a procedure's interceptor logged: the handler's own hook skips them. */
const logged = new WeakSet<object>();

/** An error the caller is answered with on purpose: an HTTP error below 500. */
export function asRefusal(error: unknown): ORPCError<string, unknown> | null {
  return error instanceof ORPCError && error.status >= 400 && error.status < 500 ? error : null;
}

/** A plain identifier: what Louez's ids, Stripe's and the client's own look like. */
const PLAIN_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** A key that names an id: `id`, `reservationId`. */
const ID_KEY = /^(?:id|[a-z][A-Za-z0-9]*Id)$/;
/** Paths that hold a credential or what opens one: an approval is its own token. */
const SECRET_PATH = /approval|token|secret|handoff|session|key|url|link/i;
/** How deep the details are read, and how many ids are kept. */
const MAX_DEPTH = 4;
const MAX_IDS = 20;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The plain ids of a refusal's details, by their dotted path. */
function idsOf(details: unknown): Record<string, string> {
  const ids: Record<string, string> = {};
  let count = 0;
  const visit = (value: unknown, path: string, depth: number) => {
    if (!isRecord(value) || depth > MAX_DEPTH) return;
    for (const [key, child] of Object.entries(value)) {
      if (count >= MAX_IDS) return;
      const at = path ? `${path}.${key}` : key;
      if (SECRET_PATH.test(at)) continue;
      if (typeof child === "string" && ID_KEY.test(key) && PLAIN_ID.test(child)) {
        ids[at] = child;
        count += 1;
      } else {
        visit(child, at, depth + 1);
      }
    }
  };
  visit(details, "", 0);
  return ids;
}

/** A validation error's issues as `code at path`: their words may quote what was sent. */
function issuesOf(issues: unknown): string[] | undefined {
  if (!Array.isArray(issues)) return undefined;
  return issues.slice(0, MAX_IDS).map((issue) => {
    const code = isRecord(issue) && typeof issue.code === "string" ? issue.code : "invalid";
    const path =
      isRecord(issue) && Array.isArray(issue.path)
        ? issue.path
            .map((segment) =>
              typeof segment === "string" || typeof segment === "number" ? String(segment) : "?",
            )
            .join(".")
        : "";
    return path ? `${code} at ${path}` : code;
  });
}

/** What the log keeps of a refusal: its code and status, where, who, and its plain ids. */
export function refusalLogEvent(
  refusal: ORPCError<string, unknown>,
  at: { procedure?: string; transport?: Transport; scope?: ErrorScope } = {},
): RefusalLogEvent {
  const data = isRecord(refusal.data) ? refusal.data : {};
  const code = typeof data.code === "string" ? data.code : refusal.code;
  const ids = idsOf(data.details);
  const issues = issuesOf(data.issues);
  const { scope } = at;
  return {
    code,
    status: refusal.status,
    ...(at.procedure ? { procedure: at.procedure } : {}),
    ...(at.transport ? { transport: at.transport } : {}),
    ...(scope?.storeId ? { storeId: scope.storeId } : {}),
    ...(scope?.actorId ? { actorId: scope.actorId } : {}),
    ...(scope?.client ? { client: scope.client } : {}),
    ...(Object.keys(ids).length > 0 ? { ids } : {}),
    ...(issues ? { issues } : {}),
  };
}

/**
 * oRPC client interceptor that logs a procedure's refusal through `log`, by its
 * facts only, then rethrows it unchanged. Placed after `reportUnexpectedErrors`,
 * it reads the call's `errorScope` the procedure fills as it learns who calls.
 */
export function logRefusals(log: (event: RefusalLogEvent) => void) {
  return async <TOptions extends { context: BaseContext; path: readonly string[] }, TResult>(
    options: TOptions & { next: (options?: TOptions) => Promise<TResult> },
  ): Promise<TResult> => {
    try {
      return await options.next();
    } catch (error) {
      const refusal = asRefusal(error);
      if (refusal && !logged.has(refusal)) {
        logged.add(refusal);
        log(
          refusalLogEvent(refusal, {
            procedure: options.path.join("."),
            transport: options.context.transport,
            scope: options.context.errorScope,
          }),
        );
      }
      throw error;
    }
  };
}

/**
 * The `onError` of a transport handler (RPC, OpenAPI) that logs to `sink`, with
 * `logRefusals(sink.refusal)` among its client interceptors: a procedure's refusal
 * is that interceptor's, with its procedure and who called; a refusal before any
 * procedure (a route not found, a body not read) is logged here by its code and
 * status; a fault as it is.
 */
export function logRequestError(sink: RequestLogSink): (error: unknown) => void {
  return (error) => {
    const refusal = asRefusal(error);
    if (refusal) {
      if (!logged.has(refusal)) sink.refusal(refusalLogEvent(refusal));
      return;
    }
    sink.fault(error instanceof Error ? error : new Error("Unknown oRPC error"));
  };
}
