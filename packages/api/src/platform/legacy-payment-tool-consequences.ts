import type { Consequences } from "./approval-rule";

/**
 * Temporary: remove with pull request 6 of the approval plan
 * (docs/architecture/api-and-agents.md), when these three tools become
 * procedures that declare `["money"]` themselves.
 *
 * The hand-written payment tools (`legacyTool`, packages/mcp) say `always`
 * where a procedure declares its consequences. They record, give back or
 * erase money: `always` reads as `money`, for them alone. Only `legacyTool`
 * imports this (approval-coverage.test.ts checks it), and it converts when it
 * registers a tool, so any other tool, or one of these without `always`, is
 * refused before it can be called.
 */
export const LEGACY_PAYMENT_TOOLS = ["record_payment", "delete_payment", "record_deposit_return"];

export function legacyPaymentToolConsequences(
  tool: string,
  always: boolean | undefined,
): Consequences {
  if (!LEGACY_PAYMENT_TOOLS.includes(tool) || always !== true) {
    throw new Error(
      `MCP tool ${tool}: only ${LEGACY_PAYMENT_TOOLS.join(", ")} confirm through \`always\`, which reads as money; any other tool runs as a procedure that declares its consequences.`,
    );
  }
  return ["money"];
}
