import { ORPCError } from "@orpc/server";

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
        "An earlier call with this idempotency key may have gone through, but its outcome was not recorded. Check the current state before trying again with a new key.",
      details: { operationId },
    }),
  confirmationInvalid: () =>
    apiError("PRECONDITION_FAILED", "CONFIRMATION_INVALID", {
      message:
        "The confirmation token is unknown, expired, already used, or no longer matches the input or the current state. Call again without it to get a new preview.",
    }),
} as const;

/** True when an error is one of ours, whatever transport threw it. */
export function isApiError(error: unknown): error is ORPCError<string, ApiErrorData> {
  return (
    error instanceof ORPCError &&
    typeof (error.data as Partial<ApiErrorData> | undefined)?.code === "string"
  );
}
