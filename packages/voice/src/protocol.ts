import { z } from "zod";
import { isLiveVoice } from "./catalog.js";

export const APP_PATH = "/api/voice/live";
export const MAX_BODY_BYTES = 256 * 1024;
export const voiceSchema = z.custom<string>(isLiveVoice);
export const previewSchema = z.object({
  voiceId: voiceSchema,
  language: z.enum(["fr", "en", "it", "nl", "pt", "de", "es", "pl"]),
});
const id = z.string().regex(/^[A-Za-z0-9_-]{21}$/);
const providerId = z.string().min(1).max(128);
const tokens = z.number().int().nonnegative().max(100_000_000);
export const usageSchema = z.object({
  inputTokens: tokens,
  outputTokens: tokens,
  cachedInputTokens: tokens,
});
export const transcriptSchema = z.object({
  id,
  role: z.enum(["user", "assistant"]),
  text: z.string().max(16_000),
  startMs: z.number().nonnegative().max(3_600_000),
});
const binding = {
  conversationId: id,
  callId: providerId,
  streamId: providerId,
  connectionId: z.uuid(),
};
export const liveRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start"), ...binding }),
  z.object({
    type: z.literal("tool"),
    ...binding,
    call: z.object({
      id: providerId,
      name: z.string().min(1).max(80),
      arguments: z.string().max(32_000),
    }),
  }),
  z.object({
    type: z.literal("sync"),
    ...binding,
    transcripts: z.array(transcriptSchema).max(50),
    responses: z.array(z.object({ id: providerId, usage: usageSchema })).max(50),
    seconds: z.number().nonnegative().max(3_660),
  }),
  z.object({
    type: z.literal("close"),
    ...binding,
    seconds: z.number().nonnegative().max(3_660),
    finalized: z.boolean(),
    sessionId: providerId.nullable(),
    outcome: z.enum(["end", "transfer", "failed"]),
  }),
]);
export type LiveRequest = z.infer<typeof liveRequestSchema>;
export type Transcript = z.infer<typeof transcriptSchema>;
export type Usage = z.infer<typeof usageSchema>;
export type CallBinding = Pick<
  LiveRequest,
  "conversationId" | "callId" | "streamId" | "connectionId"
>;

export const sessionConfigSchema = z.object({
  voice: voiceSchema,
  model: z.string().min(1),
  backendModel: z.string().min(1),
  instructions: z.string(),
  backendInstructions: z.string(),
  greeting: z.string(),
  maxSeconds: z.number().int().min(1).max(3600),
  tools: z.array(
    z.object({
      type: z.literal("function"),
      name: z.string(),
      description: z.string(),
      parameters: z.record(z.string(), z.unknown()),
      strict: z.literal(false),
    }),
  ),
});
export type SessionConfig = z.infer<typeof sessionConfigSchema>;
export const toolResultSchema = z.object({
  output: z.unknown(),
  control: z.enum(["end", "transfer"]).optional(),
});
export type ToolResult = z.infer<typeof toolResultSchema>;
