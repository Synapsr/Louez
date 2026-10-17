import { createHash } from "node:crypto";
import { asSchema } from "ai";
import { and, eq, gte, sql } from "drizzle-orm";
import {
  aiAdvisorConversations,
  db,
  voiceSessionsTable,
  voiceToolExecutionsTable,
} from "@louez/db";
import type { LiveRequest, ToolResult } from "@louez/voice/protocol";
import { toolsForCall, type CallStore } from "./live-config";
import { log } from "@/lib/evlog";

// Canonical keys make semantically identical writes idempotent even if the
// backend retries with another function-call ID or reordered JSON properties.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export async function executeLiveTool(
  request: Extract<LiveRequest, { type: "tool" }>,
  store: CallStore,
  callerPhone: string,
): Promise<ToolResult> {
  const tools = toolsForCall(store, request.conversationId, callerPhone);
  const tool = Object.hasOwn(tools, request.call.name) ? tools[request.call.name] : undefined;
  if (!tool) return { output: { error: "Tool not available for this store." } };
  let input: unknown;
  try {
    input = JSON.parse(request.call.arguments);
  } catch {
    return { output: { error: "Invalid tool arguments." } };
  }
  const schema = asSchema(tool.inputSchema);
  const validated = await schema.validate?.(input);
  if (!validated?.success) return { output: { error: "Invalid tool arguments." } };
  if (request.call.name === "end_call") return { output: { ok: true }, control: "end" };
  if (request.call.name === "transfer_to_human")
    return { output: { ok: true }, control: "transfer" };

  const inputHash = createHash("sha256").update(canonical(validated.value)).digest("hex");
  if (request.call.name === "create_reservation_hold") {
    const data = validated.value;
    if (!data || typeof data !== "object" || !("items" in data))
      return { output: { error: "Missing reservation items." } };
    const quoteHash = createHash("sha256")
      .update(canonical({ items: data.items }))
      .digest("hex");
    const quotes = await db.query.voiceToolExecutionsTable.findMany({
      where: and(
        eq(voiceToolExecutionsTable.conversationId, request.conversationId),
        eq(voiceToolExecutionsTable.name, "quote_reservation"),
        eq(voiceToolExecutionsTable.inputHash, quoteHash),
        eq(voiceToolExecutionsTable.status, "completed"),
        gte(voiceToolExecutionsTable.createdAt, new Date(Date.now() - 300_000)),
      ),
      columns: { output: true },
      limit: 5,
    });
    if (
      !quotes.some(
        ({ output }) =>
          output && typeof output === "object" && "ok" in output && output.ok === true,
      )
    ) {
      return {
        output: {
          error:
            "Quote these exact items and dates again before booking, then confirm the price with the caller.",
        },
      };
    }
  }

  const mutating = ["create_reservation_hold", "take_message"].includes(request.call.name);
  const key = createHash("sha256")
    .update(
      `${request.conversationId}:${request.call.name}:${mutating ? canonical(validated.value) : request.call.id}`,
    )
    .digest("hex");
  const claimed = await db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(voiceSessionsTable)
      .where(
        and(
          eq(voiceSessionsTable.conversationId, request.conversationId),
          eq(voiceSessionsTable.storeId, store.id),
        ),
      )
      .for("update");
    if (!session || session.status !== "active" || session.toolCount >= 100)
      return { allowed: false as const };
    const existing = await tx.query.voiceToolExecutionsTable.findFirst({
      where: eq(voiceToolExecutionsTable.id, key),
    });
    if (existing)
      return existing.inputHash === inputHash
        ? { allowed: true as const, existing }
        : { allowed: false as const };
    if (request.call.name === "create_reservation_hold") {
      const prior = await tx.query.voiceToolExecutionsTable.findMany({
        where: and(
          eq(voiceToolExecutionsTable.conversationId, request.conversationId),
          eq(voiceToolExecutionsTable.name, request.call.name),
        ),
        limit: 100,
      });
      const conversation = await tx.query.aiAdvisorConversations.findFirst({
        where: and(
          eq(aiAdvisorConversations.id, request.conversationId),
          eq(aiAdvisorConversations.storeId, store.id),
        ),
        columns: { reservationId: true },
      });
      const uncertainOrBooked = prior.some(
        (operation) =>
          operation.status !== "completed" ||
          !operation.output ||
          typeof operation.output !== "object" ||
          !("ok" in operation.output) ||
          operation.output.ok !== false,
      );
      if (uncertainOrBooked || conversation?.reservationId) return { allowed: false as const };
    }
    await tx.insert(voiceToolExecutionsTable).values({
      id: key,
      conversationId: request.conversationId,
      name: request.call.name,
      inputHash,
    });
    await tx
      .update(voiceSessionsTable)
      .set({ toolCount: sql`${voiceSessionsTable.toolCount} + 1` })
      .where(eq(voiceSessionsTable.conversationId, request.conversationId));
    return { allowed: true as const, existing: null };
  });
  if (!claimed.allowed)
    return {
      output: {
        error:
          "Call ended, operation limit reached, or a booking was already attempted. Do not create another reservation; offer a human follow-up.",
      },
    };
  if (claimed.existing)
    return {
      output:
        claimed.existing.status === "completed"
          ? claimed.existing.output
          : {
              error:
                "The previous operation has an uncertain result. Do not repeat it or claim success. Offer a human follow-up.",
            },
    };
  try {
    if (!tool.execute) return { output: { error: "Tool has no handler." } };
    const output = await tool.execute(validated.value, {
      toolCallId: request.call.id,
      messages: [],
    });
    await db
      .update(voiceToolExecutionsTable)
      .set({ status: "completed", output, updatedAt: new Date() })
      .where(eq(voiceToolExecutionsTable.id, key));
    return { output };
  } catch {
    // Leave the durable claim unresolved: a failed response may have committed
    // a reservation or sent a message. Never retry that side effect blindly.
    log.error("voice", `Tool execution requires reconciliation: ${key}`);
    return {
      output: {
        error:
          "Operation could not be confirmed. Do not claim success or retry. Offer a human follow-up.",
      },
    };
  }
}
