import type { CallToolResult } from "@modelcontextprotocol/server";
import { ORPCError } from "@orpc/server";

/** A business error a tool answers with: `isError: true` and the message. */
export function toolError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
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

/**
 * The facts of an error thrown by a procedure or the platform. Our errors
 * carry `data.code`; oRPC's own (input validation) carry their code and
 * issues. Anything else is not described: it may hold internals.
 */
export function errorFacts(error: unknown): ToolErrorFacts {
  if (!(error instanceof ORPCError)) {
    return { message: "Internal server error.", code: "INTERNAL_SERVER_ERROR", retryable: false };
  }
  const data = (error.data ?? {}) as {
    code?: unknown;
    retryable?: unknown;
    details?: Record<string, unknown>;
    issues?: unknown;
  };
  const details = data.details ?? (data.issues === undefined ? undefined : { issues: data.issues });
  return {
    message: error.message,
    code: typeof data.code === "string" ? data.code : error.code,
    retryable: data.retryable === true,
    ...(details ? { details } : {}),
  };
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
  const facts = errorFacts(error);
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
