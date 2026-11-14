import { logProviderError } from "@louez/api/platform/sanitize-error";
import type { McpRequestContext } from "../auth/context";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { ORPCError } from "@orpc/server";

import { APPROVAL_TEXTS } from "./approval-texts";
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
 * The text an error opens with: the bridge's own words for a confirmation
 * request and a person's approval (`APPROVAL_TEXTS`), else its message.
 * `spelledOut`: the words give every detail the model needs, which the text
 * then does not repeat as JSON (the structured content still holds them).
 */
function headOf(tool: string, facts: ToolErrorFacts): { text: string; spelledOut: boolean } {
  if (!facts.details) return { text: facts.message, spelledOut: false };
  if (facts.code === "CONFIRMATION_REQUIRED") {
    return { text: confirmationText(tool, facts.details), spelledOut: true };
  }
  const words = APPROVAL_TEXTS.get(facts.code)?.(tool, facts.details);
  if (!words) return { text: facts.message, spelledOut: false };
  return { text: words, spelledOut: facts.code === "APPROVAL_REQUIRED" };
}

/**
 * A failed call as a tool result: `isError: true`, a text block with the
 * message, the code, whether to retry and the details, and the same facts as
 * structured content. A confirmation request spells out the preview and the
 * token, so a model can ask the human and call again; a person's approval,
 * its link and how to wait for it.
 */
export function errorResult(tool: string, error: unknown): CallToolResult {
  const facts = isFacts(error) ? error : errorFacts(error);
  // Kept out of the answer, so logged here, redacted.
  if (facts === UNEXPECTED) logProviderError(`[mcp] ${tool} failed unexpectedly`, error);
  const head = headOf(tool, facts);
  const lines = [head.text, `code: ${facts.code}`, `retryable: ${facts.retryable}`];
  if (facts.details && !head.spelledOut) {
    lines.push(`details: ${JSON.stringify(facts.details)}`);
  }
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: { error: facts },
    isError: true,
  };
}

/**
 * Sends a hand-written tool's error to error tracking (`ports.reportError`,
 * which drops what is expected). A procedure's errors are reported by
 * `reportUnexpectedErrors` in its `call()`, never here.
 */
export function reportToolError(ctx: McpRequestContext, tool: string, error: unknown): void {
  const { credential } = ctx.actor;
  ctx.ports.reportError?.(error, {
    source: "mcp_tool",
    transport: "mcp",
    tool,
    client: credential.kind,
    ...(credential.directory ? { directory: credential.directory } : {}),
  });
}
