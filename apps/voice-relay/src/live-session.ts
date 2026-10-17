import { createHash, randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import type { SessionConfig } from "@louez/voice/protocol";

export const LIVE_ENDPOINT = "wss://api.openai.com/v1/live/sessions";

export function openLiveSocket(apiKey: string, safetyId: string): WebSocket {
  return new WebSocket(LIVE_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Safety-Identifier": createHash("sha256").update(safetyId).digest("hex"),
    },
    maxPayload: 512 * 1024,
    handshakeTimeout: 10_000,
  });
}

export function sessionStart(config: SessionConfig) {
  return {
    type: "session.start",
    event_id: randomUUID(),
    session: {
      model: config.model,
      instructions: config.instructions,
      store: false,
      audio: { format: { type: "audio/pcmu", rate: 8000 }, output: { voice: config.voice } },
      input: [
        {
          type: "message",
          role: "developer",
          content: [{ type: "input_text", text: config.greeting }],
        },
      ],
      delegation: {
        type: "responses",
        responses: {
          model: config.backendModel,
          instructions: config.backendInstructions,
          tools: config.tools,
          tool_choice: "auto",
          parallel_tool_calls: false,
          max_output_tokens: 4096,
        },
      },
    },
  };
}
