import { ORPCError } from "@orpc/server";

import { LOUEZ_ERROR_CODES } from "./error-registry";

/**
 * Errors of the agent-ready API. Every transport sends the same thing:
 *
 * - `message`: plain English for a model or a developer, never a translation key;
 * - `data.code`: a stable code (`CATEGORY_NOT_FOUND`), the thing to branch on;
 * - `data.retryable`: whether the same call can succeed later unchanged;
 * - `data.i18nKey`: the dashboard's translation key, when it shows this error;
 * - `data.details`: structured facts (ids, amounts) when they help.
 *
 * Conventions: docs/architecture/api-and-agents.md.
 */
export interface ApiErrorData {
  code: string;
  retryable: boolean;
  i18nKey?: string;
  details?: Record<string, unknown>;
}

type HttpCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PRECONDITION_FAILED"
  | "TOO_MANY_REQUESTS"
  | "INTERNAL_SERVER_ERROR";

export function apiError(
  status: HttpCode,
  code: string,
  options: {
    message: string;
    i18nKey?: string;
    retryable?: boolean;
    details?: Record<string, unknown>;
  },
): ORPCError<HttpCode, ApiErrorData> {
  return new ORPCError(status, {
    message: options.message,
    data: {
      code,
      retryable: options.retryable ?? false,
      ...(options.i18nKey ? { i18nKey: options.i18nKey } : {}),
      ...(options.details ? { details: options.details } : {}),
    },
  });
}

/** The platform's own errors: authentication, rights, limits, confirmation. */
export const platformErrors = {
  unauthenticated: (message = "Sign in, or send a valid API key or access token.") =>
    apiError("UNAUTHORIZED", "UNAUTHENTICATED", { message, i18nKey: "errors.unauthenticated" }),
  credentialNotAccepted: (transport: string) =>
    apiError("UNAUTHORIZED", "CREDENTIAL_NOT_ACCEPTED", {
      message: `This credential is not accepted on the ${transport} endpoint.`,
      i18nKey: "errors.unauthenticated",
    }),
  noStore: () =>
    apiError("FORBIDDEN", "NO_STORE_ACCESS", {
      message: "You have no access to this store, or to any store yet.",
      i18nKey: "errors.unauthorized",
    }),
  noStoreYet: () =>
    apiError("FORBIDDEN", "NO_STORE_YET", {
      message:
        "This account has no store yet. Create one with stores_create (POST /stores), then call again with its id as storeId.",
      i18nKey: "errors.unauthorized",
    }),
  storeRequired: () =>
    apiError("BAD_REQUEST", "STORE_REQUIRED", {
      message:
        "This connection covers several stores. Say which one: pass storeId (an id from stores_list), or the Louez-Store header.",
      i18nKey: "errors.unauthorized",
    }),
  permissionDenied: (required: string) =>
    apiError("FORBIDDEN", "PERMISSION_DENIED", {
      message: `This connection or role does not allow it (needs ${required}).`,
      i18nKey: "errors.permissionDenied",
      details: { required },
    }),
  /**
   * A domain the agent's own directory forbids it (`clientWithholding`):
   * no grant changes it, so nothing to ask the user to enable.
   */
  withheldFromClient: (domain: string) =>
    apiError("FORBIDDEN", "NOT_AVAILABLE_TO_THIS_AGENT", {
      message: `Louez's ${domain} tools are not available to this agent. The user manages ${domain} in the Louez dashboard.`,
      i18nKey: "errors.permissionDenied",
      details: { domain },
    }),
  /**
   * A procedure the agent's own directory forbids it (`ClientWithholding.capabilities`):
   * no grant changes it, so nothing to ask the user to enable.
   */
  capabilityWithheldFromClient: (capability: string) =>
    apiError("FORBIDDEN", "NOT_AVAILABLE_TO_THIS_AGENT", {
      message:
        "This tool is not available to this agent. The user can do it in the Louez dashboard.",
      i18nKey: "errors.permissionDenied",
      details: { capability },
    }),
  /** An account write that needs a connection over all the user's stores, present and future. */
  connectionBoundToStores: (kind: "api_key" | "oauth") =>
    apiError("FORBIDDEN", "CONNECTION_BOUND_TO_STORES", {
      message:
        kind === "api_key"
          ? "An API key works on its own store only, so it cannot add a store. Create the store in Louez, or connect an agent through OAuth with access to all your stores."
          : "This connection covers chosen stores only, so it cannot add a store. The user can create the store in Louez, or let this agent reach all their stores, present and future: Settings > Integrations > MCP > Connected agents.",
      i18nKey: "errors.permissionDenied",
    }),
  sessionOnly: () =>
    apiError("FORBIDDEN", "SESSION_ONLY", {
      message: "Only the account owner, signed in to the Louez dashboard, can do this.",
      i18nKey: "errors.permissionDenied",
    }),
  apiAccessNotInPlan: () =>
    apiError("FORBIDDEN", "API_ACCESS_NOT_IN_PLAN", {
      message: "This store's plan does not include access through the API or agents.",
      i18nKey: "errors.permissionDenied",
    }),
  rateLimited: (retryAfterSeconds: number) =>
    apiError("TOO_MANY_REQUESTS", "RATE_LIMITED", {
      message: `Too many requests. Retry in ${retryAfterSeconds} seconds.`,
      retryable: true,
      details: { retryAfterSeconds },
    }),
  idempotencyConflict: () =>
    apiError("CONFLICT", "IDEMPOTENCY_KEY_REUSED", {
      message: "This idempotency key was already used with a different input.",
    }),
  operationInProgress: () =>
    apiError("CONFLICT", "OPERATION_IN_PROGRESS", {
      message:
        "The same operation is still running. Retry in a moment with the same idempotency key.",
      retryable: true,
    }),
  operationOutcomeUnknown: (operationId: string) =>
    apiError("CONFLICT", "OPERATION_OUTCOME_UNKNOWN", {
      message:
        "An earlier call with this idempotency key may have gone through: it ended on an unexpected error, or its outcome was not recorded. Check the current state before trying again with a new key.",
      details: { operationId },
    }),
  confirmationInvalid: () =>
    apiError("PRECONDITION_FAILED", "CONFIRMATION_INVALID", {
      message:
        "The confirmation token is unknown, expired, already used, or no longer matches the input or the current state. Call again without it to get a new preview.",
    }),
} as const;

/** How long an agent waits between two reads of an approval it waits for (`handoffs_get`). */
export const APPROVAL_POLL_SECONDS = 30;

/** An approval as an answer shows it: the agent gives `url` to the user, then reads it by `id`. */
export interface ApprovalAnswer {
  id: string;
  url: string;
  status: "pending" | "approved";
  expiresAt: string;
  pollAfterSeconds: number;
  /** What the person decided: null while pending. */
  decision: { outcome: "approved"; at: string; reason: string | null } | null;
  /**
   * An approved approval only: whether this call, and the store, are still as
   * the preview the person approved showed (its binding is the call's).
   */
  stillAsApproved?: boolean;
}

/**
 * Why an approval id sent with a call does not let it run: it names another
 * request (or none, for this caller), it expired, it was used, the store no
 * longer is as approved, or the person who approved may no longer.
 */
export type ApprovalInvalidReason =
  | "other_request"
  | "expired"
  | "used"
  | "state_changed"
  | "approver_not_allowed"
  /** An approved approval cannot be carried out yet (until pull request 3c of the plan). */
  | "execution_unavailable";

/**
 * The answers of an action a person must approve
 * (docs/architecture/api-and-agents.md, "A person's approval"). Each is a
 * refusal: nothing of the write happened.
 */
export const approvalErrors = {
  /**
   * The request's approval, as it stands. Approved, the preview is the one
   * the person approved, and `stillAsApproved` says whether this call is.
   */
  required: (
    preview: { summary: string; details?: Record<string, unknown> },
    approval: ApprovalAnswer,
  ) =>
    apiError("PRECONDITION_FAILED", "APPROVAL_REQUIRED", {
      message:
        approval.status === "approved"
          ? `The user approved: ${preview.summary} Nothing was done yet.${approval.stillAsApproved ? "" : " This call, or the store, is no longer as the preview the user approved showed."}`
          : `${preview.summary} Nothing was done yet. The user approves it in Louez, signed in, from this link: ${approval.url}`,
      details: { preview, approval, confirmationToken: approval.id },
    }),
  pending: (approval: ApprovalAnswer) =>
    apiError("PRECONDITION_FAILED", "APPROVAL_PENDING", {
      message: `The user has not decided yet. Nothing was done. Read the approval again in ${approval.pollAfterSeconds} seconds.`,
      retryable: true,
      details: { approval },
    }),
  declined: (approvalId: string, reason: string | null) =>
    apiError("CONFLICT", "APPROVAL_DECLINED", {
      message: reason
        ? "The user refused this action, and nothing was done. Their words are in details.reason."
        : "The user refused this action, and nothing was done.",
      details: { approvalId, reason },
    }),
  invalid: (reason: ApprovalInvalidReason) =>
    apiError("PRECONDITION_FAILED", "APPROVAL_INVALID", {
      message:
        "This approval does not let this call run, and nothing was done. Call again without it to ask the user again, with the preview as it is now.",
      details: { reason },
    }),
  recentlyDeclined: (retryAt: Date, now: Date) =>
    apiError("CONFLICT", "APPROVAL_RECENTLY_DECLINED", {
      message: `The user refused this same request a moment ago, and nothing was done. It may be asked again from ${retryAt.toISOString()}.`,
      details: {
        retryAt: retryAt.toISOString(),
        retryAfterSeconds: Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 1000)),
      },
    }),
  full: (limit: string, retryAt: Date, now: Date) =>
    apiError("TOO_MANY_REQUESTS", "APPROVALS_FULL", {
      message: "Too many requests wait for the user's approval. Nothing was done: retry later.",
      retryable: true,
      details: {
        limit,
        retryAfterSeconds: Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 1000)),
      },
    }),
} as const;

/** True when an error is one of ours, whatever transport threw it. */
export function isApiError(error: unknown): error is ORPCError<string, ApiErrorData> {
  return (
    error instanceof ORPCError &&
    typeof (error.data as Partial<ApiErrorData> | undefined)?.code === "string"
  );
}

/**
 * The operation layer's own answers about an idempotency key: they say where
 * an earlier call with the key stands, not that this one was refused. They
 * are thrown outside the classification of a handler's error
 * (platform/operations.ts): before a record is claimed, or after a handler
 * that returned when its outcome could not be recorded. Were one to reach
 * that classification, it must not be `failed`.
 */
export const OPERATION_STATE_CODES: ReadonlySet<string> = new Set([
  "OPERATION_OUTCOME_UNKNOWN",
  "OPERATION_IN_PROGRESS",
  "IDEMPOTENCY_KEY_REUSED",
]);

/**
 * True when Louez refused the call: one of its own errors (`apiError`) with a
 * code of the registry, other than the operation layer's answers
 * (`OPERATION_STATE_CODES`). A write that ends on one is `failed`, and its
 * idempotency key may run it again (platform/operations.ts). Anything else
 * (a database or network error, a timeout, a thrown `Error`, an error
 * without a registered code) is `unknown`, and its key never runs it again.
 *
 * The predicate reads the code, not what the handler did: a registered code
 * is a convention, not a proof that nothing was written. A handler raises a
 * refusal only when nothing it wrote remains: it refuses before it writes, in
 * the transaction that rolls its writes back, or after undoing what it wrote.
 * The one exception is the refusal's own trace (the preview row of
 * `CONFIRMATION_REQUIRED`, with the setup mark of the store it locked; the
 * approval of `APPROVAL_REQUIRED`, written in the write's transaction, which
 * commits it before the refusal is thrown; the activity line of
 * `DEPOSIT_ATTEMPT_NEEDS_STRIPE`), which records that the write did not
 * happen. A refusal raised after a write whose undoing failed
 * is raised as an ordinary error carrying both (`uploadImage`,
 * services/uploads.ts); a read after a commit goes through `readAfterCommit`.
 */
export function isRefusal(error: unknown): error is ORPCError<string, ApiErrorData> {
  return (
    isApiError(error) &&
    LOUEZ_ERROR_CODES.has(error.data.code) &&
    !OPERATION_STATE_CODES.has(error.data.code)
  );
}

/**
 * Reads a write's answer once its transaction has committed. A refusal there
 * (the record was deleted in between) is not the write's, which went
 * through: it is thrown as an unexpected error instead, so the operation is
 * unknown and its idempotency key never runs it again (`isRefusal`).
 */
export async function readAfterCommit<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (!isRefusal(error)) throw error;
    throw new Error("The write went through, but its answer could not be read back.", {
      cause: error,
    });
  }
}
