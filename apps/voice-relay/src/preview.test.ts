import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import { configSchema } from "./env.js";
import { parseJson } from "./events.js";
import { generateVoicePreview } from "./preview.js";

test(
  "preview sends one close and retains audio while final usage is delayed",
  { timeout: 20_000 },
  async (t) => {
    const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    let finalTimer: ReturnType<typeof setTimeout> | undefined;
    t.after(() => {
      clearTimeout(finalTimer);
      for (const ws of server.clients) ws.terminate();
      server.close();
    });
    let closeCount = 0;
    let inputAfterClose = 0;
    const speech = Buffer.alloc(960);
    for (let offset = 0; offset < speech.length; offset += 2) speech.writeInt16LE(2000, offset);
    server.on("connection", (socket) => {
      socket.on("message", (raw) => {
        const event = parseJson(raw.toString());
        if (!event || typeof event !== "object" || !("type" in event)) return;
        if (event.type === "session.start") {
          socket.send(JSON.stringify({ type: "session.started", session: { id: "preview_test" } }));
          socket.send(
            JSON.stringify({
              type: "session.output_audio.delta",
              delta: speech.toString("base64"),
            }),
          );
          // Finalization arrives after the ten-second generation deadline. An
          // early silence close must cancel that timer, not send another close.
          finalTimer = setTimeout(() => {
            socket.send(JSON.stringify({ type: "session.closed", usage: { seconds: 2 } }));
          }, 10_200);
        } else if (event.type === "session.close") {
          closeCount++;
        } else if (event.type === "session.input_audio.append" && closeCount) {
          inputAfterClose++;
        }
      });
    });
    const config = configSchema.parse({
      APP_URL: "https://app.example.com",
      VOICE_RELAY_WS_URL: "wss://voice.example.com",
      VOICE_RELAY_SIGNING_SECRET: "test-secret-at-least-32-characters",
      TWILIO_AUTH_TOKEN: "test",
      TWILIO_ACCOUNT_SID: `AC${"0".repeat(32)}`,
      OPENAI_API_KEY: "test-only-no-network",
    });
    const wav = await generateVoicePreview(
      "brise",
      "Bonjour",
      config,
      () => new WebSocket(`ws://127.0.0.1:${address.port}`),
    );
    assert.equal(closeCount, 1);
    assert.equal(inputAfterClose, 0);
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    assert.deepEqual(wav.subarray(44), speech);
  },
);
