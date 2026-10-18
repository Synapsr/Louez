import { createHash, randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import type { SessionConfig } from "@louez/voice/protocol";
import type { LiveSession } from "./events.js";

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

function startupContext(config: SessionConfig): string {
  // Seed the complete conversation context before the first audio frame. Keep
  // immutable instructions too, so Live retains its role through compaction.
  return `${config.instructions}\n\n${config.greeting}`;
}

export function checkLiveSession(config: SessionConfig, session: LiveSession) {
  const matches = (actual: unknown, expected: unknown) =>
    actual === undefined ? null : actual === expected;
  return {
    model: matches(session.model, config.model),
    instructions: matches(session.instructions, config.instructions),
    startupContext:
      session.input === undefined
        ? null
        : session.input.some(
            (item) =>
              item.role === "developer" &&
              item.content.some((part) => part.text === startupContext(config)),
          ),
    voice: matches(session.audio?.output?.voice, config.voice),
    delegation: matches(session.delegation === null ? null : session.delegation?.type, "responses"),
    backendModel: matches(session.delegation?.responses?.model, config.backendModel),
    backendInstructions: matches(
      session.delegation?.responses?.instructions,
      config.backendInstructions,
    ),
  };
}

export function sessionStart(config: SessionConfig) {
  if (
    ![config.instructions, config.backendInstructions, config.greeting].every((text) => text.trim())
  ) {
    throw new Error("Voice session context is empty");
  }
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
          content: [{ type: "input_text", text: startupContext(config) }],
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
