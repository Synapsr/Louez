import { ORPCError } from "@orpc/server";

import type { BaseContext } from "../context";
import type { Transport } from "./actor";
import type { ErrorScope } from "./error-reporting";

/**
 * How a refusal raised by a procedure is logged (docs/architecture/api-and-agents.md,
 * "Logs"). A refusal (a confirmation or an approval to ask, a validation error, a
 * record not found, a limit the procedure checks) is the API working: the request log records what it was
 * and who asked, and keeps only what Louez knows to be an identifier or a field name
 * of its own schema. Its message, its preview, its stack and anything the caller sent
 * stay in the answer the caller gets, which this changes in nothing. A fault (a 5xx,
 * or anything that is not an HTTP error) is logged as it was: the error itself.
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
   * (`preview.details.reservation.id`): only the paths of `LOGGED_ID_PATHS`, and only
   * a value shaped as a Louez id.
   */
  ids?: Record<string, string>;
  /**
   * A validation error's issues: each by its code, and by the field of the procedure's
   * own input schema it is under, never a nested key, an index or a value.
   */
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

/**
 * The details a refusal's ids are read from, by their path: the keys Louez's own code
 * sets in its errors' details with ids it generated or read from its records, as the
 * procedures name them. Anything else in the details is dropped, `id` included: the
 * not-found errors echo there the id the caller sent.
 */
export const LOGGED_ID_PATHS: ReadonlySet<string> = new Set([
  // The record a preview is about, as the procedure read it under its locks.
  "preview.details.reservationId", // record_payment, record_deposit_return, record_refund, refund_payment
  "preview.details.paymentId", // delete_payment, record_refund, refund_payment
  "preview.details.reservation.id", // a status change, a date change
  "preview.details.customer.id", // a reservation's creation
  "preview.details.product.id", // a product image's AI operation
  // What Louez made for the call: the approval it asks for, the operation it records.
  "approval.id", // APPROVAL_REQUIRED, APPROVAL_PENDING
  "approvalId", // APPROVAL_DECLINED
  "operationId", // OPERATION_OUTCOME_UNKNOWN
  // Records the refusal's own read found.
  "invitationId", // TEAM_INVITATION_ALREADY_SENT
  "existingId", // CATEGORY_NAME_TAKEN
  "overlappingId", // SEASONAL_PRICING_OVERLAP
  // Ids a refusal names by their record's kind.
  "reservationId", // DEPOSIT_ATTEMPT_*
  "paymentId", // PAYMENT_NOT_FOUND
  "refundId", // REFUND_NOT_FOUND
  "productId", // RESERVATION_PRODUCT_NOT_BOOKABLE, SEASONAL_PRICING_FIXED_PRODUCT
]);

/** The exact shape of a Louez id (`nanoid()`, 21 characters). */
const LOUEZ_ID = /^[A-Za-z0-9_-]{21}$/;
/** How many issues are kept. */
const MAX_ISSUES = 20;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The ids of a refusal's details, at the paths of `LOGGED_ID_PATHS` only. */
function idsOf(details: unknown): Record<string, string> {
  const ids: Record<string, string> = {};
  for (const path of LOGGED_ID_PATHS) {
    let value: unknown = details;
    for (const key of path.split(".")) value = isRecord(value) ? value[key] : undefined;
    if (typeof value === "string" && LOUEZ_ID.test(value)) ids[path] = value;
  }
  return ids;
}

/** The fields of a procedure's input schema, when it is an object schema; else none. */
export function inputFieldsOf(procedure: unknown): ReadonlySet<string> {
  const definition = isRecord(procedure) ? procedure["~orpc"] : undefined;
  const schema = isRecord(definition) ? definition.inputSchema : undefined;
  const shape = isRecord(schema) ? schema.shape : undefined;
  return new Set(isRecord(shape) ? Object.keys(shape) : []);
}

/**
 * A validation error's issues as `code at field`: the field only when the issue's path
 * starts with a key of the procedure's own input schema (`fields`). A nested key, an
 * index or a record's key are the caller's data, and are never kept.
 */
function issuesOf(issues: unknown, fields: ReadonlySet<string>): string[] | undefined {
  if (!Array.isArray(issues)) return undefined;
  return issues.slice(0, MAX_ISSUES).map((issue) => {
    const code = isRecord(issue) && typeof issue.code === "string" ? issue.code : "invalid";
    const first = isRecord(issue) && Array.isArray(issue.path) ? issue.path[0] : undefined;
    return typeof first === "string" && fields.has(first) ? `${code} at ${first}` : code;
  });
}

/** What the log keeps of a refusal: its code and status, where, who, and its known ids. */
export function refusalLogEvent(
  refusal: ORPCError<string, unknown>,
  at: {
    procedure?: string;
    transport?: Transport;
    scope?: ErrorScope;
    /** The procedure's own input fields (`inputFieldsOf`); none outside a procedure. */
    inputFields?: ReadonlySet<string>;
  } = {},
): RefusalLogEvent {
  const data = isRecord(refusal.data) ? refusal.data : {};
  const code = typeof data.code === "string" ? data.code : refusal.code;
  const ids = idsOf(data.details);
  const issues = issuesOf(data.issues, at.inputFields ?? new Set());
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
  return async <
    TOptions extends { context: BaseContext; path: readonly string[]; procedure?: unknown },
    TResult,
  >(
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
            inputFields: inputFieldsOf(options.procedure),
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
