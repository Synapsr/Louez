import { logProviderError } from "@louez/api/platform/sanitize-error";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { ORPCError } from "@orpc/server";

import { TRANSLATION_KEY, TRANSLATION_KEY_MESSAGES, unknownKeyMessage } from "./error-messages";

/**
 * A business error a hand-written tool answers with, in the bridge's format:
 * `isError: true`, the message and its code. `REQUEST_REFUSED` when the
 * message alone says what to change.
 */
export function toolError(message: string, code = "REQUEST_REFUSED"): CallToolResult {
  return errorResult("", { message, code, retryable: false });
}

export function toolResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

/** What a model needs to act on a failed call. */
export interface ToolErrorFacts {
  message: string;
  code: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

/** What an error no one expected says: never its internals, always what to do. */
const UNEXPECTED: ToolErrorFacts = {
  message:
    "Louez hit an unexpected error and could not finish this call. Try once more in a moment; if it fails again, tell the user to contact Louez support.",
  code: "INTERNAL_SERVER_ERROR",
  retryable: false,
};

/**
 * The facts of an error thrown by a procedure or the platform. Our errors
 * carry `data.code`; oRPC's own (input validation) carry their code and
 * issues. A server error that is not ours, or anything else, is not
 * described: it may hold internals.
 */
export function errorFacts(error: unknown): ToolErrorFacts {
  if (!(error instanceof ORPCError)) return UNEXPECTED;
  const data = (error.data ?? {}) as {
    code?: unknown;
    retryable?: unknown;
    details?: Record<string, unknown>;
    issues?: unknown;
  };
  const ours = typeof data.code === "string";
  const details = data.details ?? (data.issues === undefined ? undefined : { issues: data.issues });
  // An older service's translation key: its English, and how to recover.
  const keyed = !ours && TRANSLATION_KEY.test(error.message);
  const known = keyed ? TRANSLATION_KEY_MESSAGES[error.message] : undefined;
  if (!ours && !known && error.status >= 500) return UNEXPECTED;
  if (keyed) {
    return {
      message: known?.message ?? unknownKeyMessage(error.message),
      code: error.code,
      retryable: known?.retryable === true,
      ...(details ? { details } : {}),
    };
  }
  return {
    message: error.message,
    code: ours ? (data.code as string) : error.code,
    retryable: data.retryable === true,
    ...(details ? { details } : {}),
  };
}

function isFacts(value: unknown): value is ToolErrorFacts {
  return (
    typeof value === "object" &&
    value !== null &&
    !(value instanceof Error) &&
    typeof (value as ToolErrorFacts).message === "string" &&
    typeof (value as ToolErrorFacts).code === "string"
  );
}

function confirmationText(tool: string, details: Record<string, unknown>): string {
  const preview = (details.preview ?? {}) as { summary?: string; details?: unknown };
  const lines = [
    `Confirmation required: ${preview.summary ?? "this action needs a confirmation."}`,
  ];
  if (preview.details !== undefined) lines.push(`Check: ${JSON.stringify(preview.details)}`);
  lines.push(
    "Nothing was done yet. Show this to the user and ask them to confirm.",
    `If they confirm, call ${tool} again with the same arguments and confirmationToken: "${String(details.confirmationToken)}" (valid until ${String(details.expiresAt)}, once).`,
  );
  return lines.join("\n");
}

/**
 * A failed call as a tool result: `isError: true`, a text block with the
 * message, the code, whether to retry and the details, and the same facts as
 * structured content. A confirmation request spells out the preview and the
 * token, so a model can ask the human and call again.
 */
export function errorResult(tool: string, error: unknown): CallToolResult {
  const facts = isFacts(error) ? error : errorFacts(error);
  // Kept out of the answer, so logged here, redacted.
  if (facts === UNEXPECTED) logProviderError(`[mcp] ${tool} failed unexpectedly`, error);
  const head =
    facts.code === "CONFIRMATION_REQUIRED" && facts.details
      ? confirmationText(tool, facts.details)
      : facts.message;
  const lines = [head, `code: ${facts.code}`, `retryable: ${facts.retryable}`];
  if (facts.details && facts.code !== "CONFIRMATION_REQUIRED") {
    lines.push(`details: ${JSON.stringify(facts.details)}`);
  }
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: { error: facts },
    isError: true,
  };
}
