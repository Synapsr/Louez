import { z } from "zod";

const sid = z.string().min(1).max(128);
const audio = z
  .string()
  .max(128_000)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/);
export const twilioEventSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("connected") }),
  z.object({
    event: z.literal("start"),
    start: z.object({
      streamSid: sid,
      callSid: sid,
      accountSid: sid,
      mediaFormat: z.object({
        encoding: z.literal("audio/x-mulaw"),
        sampleRate: z.literal(8000),
        channels: z.literal(1),
      }),
      customParameters: z.object({
        conversationId: z.string().regex(/^[A-Za-z0-9_-]{21}$/),
        expires: z.string(),
        token: z.string(),
      }),
    }),
  }),
  z.object({
    event: z.literal("media"),
    streamSid: sid,
    media: z.object({ payload: audio, track: z.literal("inbound"), timestamp: z.string() }),
  }),
  z.object({ event: z.literal("mark"), streamSid: sid, mark: z.object({ name: z.string() }) }),
  z.object({ event: z.literal("stop"), streamSid: sid }),
  z.object({ event: z.literal("dtmf"), streamSid: sid }),
]);
export const liveEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("session.started"), session: z.object({ id: sid }) }),
  z.object({ type: z.literal("session.output_audio.delta"), delta: audio }),
  z.object({
    type: z.enum(["session.input_transcript.delta", "session.output_transcript.delta"]),
    event_id: sid,
    delta: z.string().max(16_000),
    start_ms: z.number().nonnegative(),
    end_ms: z.number().nonnegative(),
  }),
  z.object({
    type: z.literal("session.usage.updated"),
    usage: z.object({ seconds: z.number().nonnegative().max(3660) }),
  }),
  z.object({
    type: z.literal("session.closed"),
    usage: z.object({ seconds: z.number().nonnegative().max(3660) }),
    reason: z.string().optional(),
  }),
  z.object({ type: z.literal("response.event"), delegation_id: sid, event: z.unknown() }),
  z.object({
    type: z.literal("error"),
    error: z
      .object({ code: z.string().nullable().optional(), message: z.string().nullable().optional() })
      .optional(),
  }),
]);
export const responseEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("response.created"), response: z.object({ id: sid }) }),
  z.object({
    type: z.literal("response.output_item.done"),
    item: z.object({
      type: z.string(),
      call_id: sid.optional(),
      name: z.string().optional(),
      arguments: z.string().max(32_000).optional(),
    }),
  }),
  z.object({
    type: z.enum(["response.completed", "response.failed", "response.incomplete"]),
    response: z.object({
      id: sid,
      usage: z
        .object({
          input_tokens: z.number().int().nonnegative(),
          output_tokens: z.number().int().nonnegative(),
          input_tokens_details: z
            .object({ cached_tokens: z.number().int().nonnegative() })
            .optional(),
        })
        .nullable()
        .optional(),
    }),
  }),
]);
export type ResponseEvent = z.infer<typeof responseEventSchema>;

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
