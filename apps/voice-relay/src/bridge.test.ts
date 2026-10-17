import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import { streamToken } from "@louez/voice/auth";
import type { LiveRequest, SessionConfig } from "@louez/voice/protocol";
import { bridge } from "./bridge.js";
import { configSchema } from "./env.js";
import { parseJson } from "./events.js";

const config = configSchema.parse({
  APP_URL: "https://app.example.com",
  VOICE_RELAY_WS_URL: "wss://voice.example.com",
  VOICE_RELAY_SIGNING_SECRET: "test-secret-at-least-32-characters",
  TWILIO_AUTH_TOKEN: "test",
  TWILIO_ACCOUNT_SID: `AC${"0".repeat(32)}`,
  OPENAI_API_KEY: "test-only-no-network",
});
const settings: SessionConfig = {
  voice: "brise",
  model: "gpt-live-1",
  backendModel: "test-backend",
  instructions: "speak French",
  backendInstructions: "only authorized tools",
  greeting: "Bonjour",
  maxSeconds: 60,
  tools: [],
};
const conversationId = "a".repeat(21);
function startEvent(tokenOverride?: string) {
  const expires = String(Date.now() + 60_000);
  return {
    event: "start",
    start: {
      accountSid: config.TWILIO_ACCOUNT_SID,
      callSid: "CA_test",
      streamSid: "MZ_test",
      customParameters: {
        conversationId,
        expires,
        token:
          tokenOverride ??
          streamToken(config.VOICE_RELAY_SIGNING_SECRET, conversationId, "CA_test", expires),
      },
      mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 },
    },
  };
}
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 4000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Expected event did not arrive");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
async function server() {
  const instance = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await once(instance, "listening");
  const address = instance.address();
  if (!address || typeof address === "string") throw new Error("Missing socket address");
  return { instance, url: `ws://127.0.0.1:${address.port}` };
}

test("real WebSocket bridge passes PCMU, clears interrupted playback and settles final cumulative usage", async (t) => {
  const twilio = await server();
  const openai = await server();
  t.after(() => {
    for (const ws of twilio.instance.clients) ws.terminate();
    for (const ws of openai.instance.clients) ws.terminate();
    twilio.instance.close();
    openai.instance.close();
  });
  const requests: LiveRequest[] = [];
  const receivedAudio: string[] = [];
  const twilioEvents: unknown[] = [];
  let upstream: WebSocket | undefined;
  let sessionStart: unknown;
  openai.instance.on("connection", (socket) => {
    upstream = socket;
    socket.on("message", (raw) => {
      const event = parseJson(raw.toString());
      if (!event || typeof event !== "object" || !("type" in event)) return;
      if (event.type === "session.start") {
        sessionStart = event;
        socket.send(JSON.stringify({ type: "session.started", session: { id: "live_test" } }));
      } else if (
        event.type === "session.input_audio.append" &&
        "audio" in event &&
        typeof event.audio === "string"
      )
        receivedAudio.push(event.audio);
      else if (event.type === "session.close")
        socket.send(
          JSON.stringify({
            type: "session.closed",
            reason: "close_requested",
            usage: { seconds: 17 },
          }),
        );
    });
  });
  twilio.instance.on("connection", (socket) =>
    bridge(socket, config, {
      app: async (request) => {
        requests.push(request);
        return request.type === "start" ? settings : { allowed: true };
      },
      openLive: () => new WebSocket(openai.url),
    }),
  );
  const caller = new WebSocket(twilio.url);
  t.after(() => caller.terminate());
  caller.on("message", (raw) => {
    const event = parseJson(raw.toString());
    twilioEvents.push(event);
    if (
      event &&
      typeof event === "object" &&
      "event" in event &&
      event.event === "mark" &&
      "mark" in event
    ) {
      caller.send(JSON.stringify({ event: "mark", streamSid: "MZ_test", mark: event.mark }));
    }
  });
  await once(caller, "open");
  caller.send(JSON.stringify(startEvent()));
  const silence = Buffer.alloc(160, 255).toString("base64");
  caller.send(
    JSON.stringify({
      event: "media",
      streamSid: "MZ_test",
      media: { payload: silence, track: "inbound", timestamp: "0" },
    }),
  );
  await until(() => receivedAudio.length > 0);
  assert.equal(receivedAudio[0], silence);
  assert.ok(sessionStart && typeof sessionStart === "object" && "session" in sessionStart);
  assert.deepEqual(sessionStart.session, {
    model: "gpt-live-1",
    instructions: "speak French",
    store: false,
    audio: { format: { type: "audio/pcmu", rate: 8000 }, output: { voice: "brise" } },
    input: [
      { type: "message", role: "developer", content: [{ type: "input_text", text: "Bonjour" }] },
    ],
    delegation: {
      type: "responses",
      responses: {
        model: "test-backend",
        instructions: "only authorized tools",
        tools: [],
        tool_choice: "auto",
        parallel_tool_calls: false,
        max_output_tokens: 4096,
      },
    },
  });
  assert.ok(upstream);
  upstream.send(JSON.stringify({ type: "session.output_audio.delta", delta: silence }));
  upstream.send(JSON.stringify({ type: "session.usage.updated", usage: { seconds: 12 } }));
  upstream.send(JSON.stringify({ type: "session.usage.updated", usage: { seconds: 15 } }));
  await until(() => twilioEvents.some((event) => JSON.stringify(event).includes('"media"')));
  for (let i = 0; i < 6; i++)
    caller.send(
      JSON.stringify({
        event: "media",
        streamSid: "MZ_test",
        media: {
          payload: Buffer.alloc(160, 0).toString("base64"),
          track: "inbound",
          timestamp: String(20 * i),
        },
      }),
    );
  await until(() => twilioEvents.some((event) => JSON.stringify(event).includes('"clear"')));
  caller.send(JSON.stringify({ event: "stop", streamSid: "MZ_test" }));
  await until(() => requests.some((request) => request.type === "close"));
  const final = requests.find((request) => request.type === "close");
  assert.ok(final && final.type === "close");
  assert.equal(final.seconds, 17);
  assert.equal(final.finalized, true);
  assert.equal(final.outcome, "end");
});

test("invalid stream credentials cannot open a paid OpenAI connection", async (t) => {
  const twilio = await server();
  t.after(() => {
    for (const ws of twilio.instance.clients) ws.terminate();
    twilio.instance.close();
  });
  let opened = false;
  twilio.instance.on("connection", (socket) =>
    bridge(socket, config, {
      app: async () => {
        assert.fail("App must not be reached");
      },
      openLive: () => {
        opened = true;
        throw new Error("Unexpected");
      },
    }),
  );
  const caller = new WebSocket(twilio.url);
  await once(caller, "open");
  const closed = once(caller, "close");
  caller.send(JSON.stringify(startEvent("wrong")));
  await closed;
  assert.equal(opened, false);
});

test(
  "backpressure releases OpenAI immediately and bounds caller wait during an app outage",
  { timeout: 20_000 },
  async (t) => {
    const twilio = await server();
    const openai = await server();
    t.after(() => {
      for (const ws of twilio.instance.clients) ws.terminate();
      for (const ws of openai.instance.clients) ws.terminate();
      twilio.instance.close();
      openai.instance.close();
    });
    let releaseSync: (() => void) | undefined;
    const persistence = new Promise<void>((resolve) => {
      releaseSync = resolve;
    });
    t.after(() => releaseSync?.());
    let upstream: WebSocket | undefined;
    let downstream: WebSocket | undefined;
    let upstreamClosed = false;
    let ready = false;
    const requests: LiveRequest[] = [];
    openai.instance.on("connection", (socket) => {
      upstream = socket;
      socket.on("close", () => {
        upstreamClosed = true;
      });
      socket.on("message", (raw) => {
        const event = parseJson(raw.toString());
        if (!event || typeof event !== "object" || !("type" in event)) return;
        if (event.type === "session.start") {
          socket.send(JSON.stringify({ type: "session.started", session: { id: "live_outage" } }));
        } else if (event.type === "session.input_audio.append") {
          ready = true;
        } else if (event.type === "session.close") {
          socket.send(
            JSON.stringify({
              type: "session.closed",
              reason: "close_requested",
              usage: { seconds: 1 },
            }),
          );
        }
      });
    });
    twilio.instance.on("connection", (socket) => {
      downstream = socket;
      bridge(socket, config, {
        app: async (request) => {
          requests.push(request);
          if (request.type === "start") return settings;
          if (request.type === "sync") await persistence;
          return { allowed: true };
        },
        openLive: () => new WebSocket(openai.url),
      });
    });
    const caller = new WebSocket(twilio.url);
    t.after(() => caller.terminate());
    await once(caller, "open");
    const callerClosed = once(caller, "close");
    caller.send(JSON.stringify(startEvent()));
    await until(() => ready);
    assert.ok(downstream && upstream);
    // Simulate a saturated downstream socket without allocating a large buffer.
    Object.defineProperty(downstream, "bufferedAmount", { value: 300_000 });
    upstream.send(
      JSON.stringify({
        type: "session.output_audio.delta",
        delta: Buffer.alloc(160, 255).toString("base64"),
      }),
    );
    await until(() => upstreamClosed);
    assert.equal(caller.readyState, WebSocket.OPEN);
    assert.equal(
      requests.some((request) => request.type === "close"),
      false,
    );
    await callerClosed;
    releaseSync?.();
    await until(() => requests.some((request) => request.type === "close"));
    const final = requests.find((request) => request.type === "close");
    assert.ok(final && final.type === "close");
    assert.equal(final.outcome, "failed");
    assert.equal(final.finalized, true);
    assert.equal(requests.filter((request) => request.type === "close").length, 1);
  },
);
