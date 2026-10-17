import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { log } from "evlog";
import { verifyStreamToken } from "@louez/voice/auth";
import {
  sessionConfigSchema,
  toolResultSchema,
  type CallBinding,
  type Usage,
} from "@louez/voice/protocol";
import { createAppClient, type AppClient } from "./app-client.js";
import { InterruptionDetector, mulawRms } from "./audio.js";
import { Backend } from "./backend.js";
import type { Config } from "./env.js";
import { liveEventSchema, parseJson, twilioEventSchema } from "./events.js";
import { openLiveSocket, sessionStart } from "./live-session.js";
import { Transcripts } from "./transcripts.js";

type Dependencies = { app?: AppClient; openLive?: typeof openLiveSocket };

export function bridge(twilio: WebSocket, config: Config, dependencies: Dependencies = {}) {
  const app = dependencies.app ?? createAppClient(config);
  const openLive = dependencies.openLive ?? openLiveSocket;
  const transcripts = new Transcripts();
  const vad = new InterruptionDetector(config.VOICE_VAD_THRESHOLD);
  const pendingAudio: string[] = [];
  const marks = new Map<string, number>();
  const responses: { id: string; usage: Usage }[] = [];
  let bufferedBytes = 0;
  let markSequence = 0;
  let inputTimer: ReturnType<typeof setInterval> | undefined;
  let binding: CallBinding | null = null;
  let live: WebSocket | null = null;
  let sessionId: string | null = null;
  let started = false;
  let closing = false;
  let finalized = false;
  let settled = false;
  let failing = false;
  let outcome: "end" | "transfer" | "failed" = "failed";
  let seconds = 0;
  let finishing = false;
  let farewellHeard = false;
  let lastSpeechAt = 0;
  let lastCallerAt = Date.now();
  let syncChain: Promise<void> = Promise.resolve();
  let syncing = false;
  let maxTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let farewellTimer: ReturnType<typeof setTimeout> | undefined;
  let greetingTimer: ReturnType<typeof setTimeout> | undefined;
  let callerSpoke = false;
  let assistantSpoke = false;
  let firstSpeechLogged = false;
  const connectedAt = performance.now();
  let configuredAt = connectedAt;
  let socketOpenedAt = connectedAt;
  let liveStartedAt = connectedAt;
  const startupTimer = setTimeout(() => fail("startup_timeout"), 20_000);

  const sendLive = (event: unknown) => {
    if (live?.readyState === WebSocket.OPEN && !closing) {
      if (live.bufferedAmount > 256 * 1024) {
        fail("openai_backpressure");
        return;
      }
      live.send(JSON.stringify(event));
    }
  };
  const sendTwilio = (event: unknown) => {
    if (twilio.readyState === WebSocket.OPEN) {
      if (twilio.bufferedAmount > 256 * 1024) {
        fail("twilio_backpressure");
        return;
      }
      twilio.send(JSON.stringify(event));
    }
  };
  const clearPlayback = () => {
    if (binding) sendTwilio({ event: "clear", streamSid: binding.streamId });
    // Twilio acknowledges cleared marks too; removing them prevents mistaking
    // discarded audio for successful playback.
    marks.clear();
  };
  const backend = new Backend({
    send: sendLive,
    execute: async (call) => {
      if (!binding || closing || finishing) throw new Error("Call no longer active");
      return toolResultSchema.parse(await app({ type: "tool", ...binding, call }));
    },
    recordUsage: (id, usage) => {
      responses.push({ id, usage });
    },
    control: (control) => {
      outcome = control;
      finishing = true;
      backend.stop();
      sendLive({
        type: "session.instructions.append",
        delegation_id: null,
        content:
          control === "transfer"
            ? "The transfer was authorized. Tell the caller briefly in their language that you are connecting them to the store, then remain silent."
            : "The caller is finished. Say a brief goodbye in their language, then remain silent.",
      });
      farewellTimer = setTimeout(close, 8000);
    },
  });

  function sync(): Promise<void> {
    if (!binding) return Promise.resolve();
    if (syncing) return syncChain;
    const request = {
      type: "sync" as const,
      ...binding,
      transcripts: transcripts.drain(),
      responses: responses.splice(0),
      seconds,
    };
    syncing = true;
    syncChain = syncChain
      .catch(() => {})
      .then(async () => {
        const result = await app(request);
        if (
          result &&
          typeof result === "object" &&
          "allowed" in result &&
          result.allowed === false
        ) {
          outcome = "end";
          close();
        }
      })
      .finally(() => {
        syncing = false;
      });
    return syncChain;
  }
  const idleTimer = setInterval(() => {
    if (
      started &&
      !closing &&
      Date.now() - Math.max(lastCallerAt, lastSpeechAt) > config.VOICE_IDLE_SECONDS * 1000
    ) {
      outcome = "end";
      clearPlayback();
      close();
    }
  }, 1000);
  const syncTimer = setInterval(() => {
    if (started && !closing) void sync().catch(() => fail("app_sync_failed"));
  }, 2000);

  async function settle() {
    if (settled) return;
    settled = true;
    clearTimeout(startupTimer);
    clearTimeout(maxTimer);
    clearTimeout(closeTimer);
    clearTimeout(farewellTimer);
    clearTimeout(greetingTimer);
    clearInterval(syncTimer);
    clearInterval(inputTimer);
    clearInterval(idleTimer);
    backend.stop();
    // Release the paid upstream even when the app cannot persist final usage.
    live?.terminate();
    // Normally persist the outcome before Twilio runs <Connect action>. An
    // unavailable app must not hold the caller indefinitely during retries.
    const disconnectTimer = setTimeout(() => twilio.terminate(), 10_000);
    disconnectTimer.unref();
    try {
      await syncChain.catch(() => {});
      await sync();
    } catch {
      log.error("voice", "Transcript or backend usage persistence failed");
    }
    if (binding) {
      try {
        await app({ type: "close", ...binding, seconds, finalized, sessionId, outcome });
      } catch {
        log.error("voice", "Final usage persistence failed; reconcile the session");
      }
    }
    clearTimeout(disconnectTimer);
    twilio.close(1000);
    const timer = setTimeout(() => twilio.terminate(), 1000);
    timer.unref();
  }
  function close() {
    if (closing) return;
    closing = true;
    backend.stop();
    clearTimeout(startupTimer);
    clearTimeout(maxTimer);
    clearTimeout(farewellTimer);
    clearTimeout(greetingTimer);
    clearInterval(syncTimer);
    clearInterval(inputTimer);
    clearInterval(idleTimer);
    if (started && live?.readyState === WebSocket.OPEN) {
      live.send(JSON.stringify({ type: "session.close" }));
      closeTimer = setTimeout(() => {
        void settle();
      }, 15_000);
    } else {
      void settle();
    }
  }
  function fail(code: string) {
    if (settled || failing) return;
    failing = true;
    log.error("voice", code); // No credentials, phone numbers, transcript or tool arguments in logs.
    outcome = "failed";
    clearPlayback();
    close();
  }

  async function start(raw: unknown) {
    const parsed = twilioEventSchema.safeParse(raw);
    if (!parsed.success || parsed.data.event !== "start") {
      fail("invalid_start");
      return;
    }
    const { start: message } = parsed.data;
    const { conversationId, expires, token } = message.customParameters;
    if (
      binding ||
      message.accountSid !== config.TWILIO_ACCOUNT_SID ||
      !verifyStreamToken(
        config.VOICE_RELAY_SIGNING_SECRET,
        conversationId,
        message.callSid,
        expires,
        token,
      )
    ) {
      fail("invalid_stream_credentials");
      return;
    }
    binding = {
      conversationId,
      callId: message.callSid,
      streamId: message.streamSid,
      connectionId: randomUUID(),
    };
    const settings = sessionConfigSchema.parse(await app({ type: "start", ...binding }));
    if (closing) return;
    configuredAt = performance.now();
    if (settings.model !== config.AI_PHONE_LIVE_MODEL)
      throw new Error("App and preview model must match");
    live = openLive(config.OPENAI_API_KEY, conversationId);
    live.on("open", () => {
      if (closing) {
        live?.terminate();
        return;
      }
      socketOpenedAt = performance.now();
      sendLive(sessionStart(settings));
    });
    live.on("message", (data) => {
      try {
        const parsedEvent = liveEventSchema.safeParse(parseJson(data.toString()));
        if (!parsedEvent.success) return; // Forward-compatible, irrelevant event.
        const event = parsedEvent.data;
        if (event.type === "session.started") {
          if (started) {
            fail("duplicate_session_start");
            return;
          }
          started = true;
          sessionId = event.session.id;
          liveStartedAt = performance.now();
          log.info({
            event: "voice_session_ready",
            conversationId: binding?.conversationId,
            configMs: Math.round(configuredAt - connectedAt),
            connectionMs: Math.round(socketOpenedAt - configuredAt),
            sessionStartMs: Math.round(liveStartedAt - socketOpenedAt),
          });
          // Startup input is a request, not a guaranteed speech trigger. Nudge
          // once if both sides stay silent, never during an active conversation.
          if (!callerSpoke && !assistantSpoke) {
            greetingTimer = setTimeout(() => {
              if (closing || finishing || callerSpoke || assistantSpoke) return;
              log.warn({
                event: "voice_greeting_retry",
                conversationId: binding?.conversationId,
                elapsedMs: Math.round(performance.now() - liveStartedAt),
              });
              sendLive({
                type: "session.instructions.append",
                event_id: randomUUID(),
                delegation_id: null,
                content:
                  "If neither side has spoken yet, say your configured opening greeting now, then listen. Do not consult the backend. Otherwise continue normally without repeating the greeting or interrupting.",
              });
            }, 2000);
          }
          clearTimeout(startupTimer);
          maxTimer = setTimeout(() => {
            outcome = "end";
            clearPlayback();
            close();
          }, settings.maxSeconds * 1000);
          inputTimer = setInterval(() => {
            if (closing) return;
            const audio = pendingAudio.shift();
            if (audio) {
              bufferedBytes -= Buffer.byteLength(audio, "base64");
              sendLive({ type: "session.input_audio.append", audio });
            } else {
              // Keep the session timeline moving across occasional PSTN gaps.
              sendLive({
                type: "session.input_audio.append",
                audio: Buffer.alloc(160, 255).toString("base64"),
              });
            }
          }, 20);
        } else if (event.type === "session.output_audio.delta" && binding && !closing) {
          const bytes = Buffer.from(event.delta, "base64");
          if (!bytes.length) return;
          if (mulawRms(bytes) > 200) {
            assistantSpoke = true;
            clearTimeout(greetingTimer);
            if (!firstSpeechLogged) {
              firstSpeechLogged = true;
              log.info({
                event: "voice_first_speech",
                conversationId: binding.conversationId,
                readyToSpeechMs: Math.round(performance.now() - liveStartedAt),
                totalMs: Math.round(performance.now() - connectedAt),
              });
            }
            lastSpeechAt = Date.now();
            if (finishing) farewellHeard = true;
          }
          // Bound outstanding playback independently of WebSocket backpressure.
          if ([...marks.values()].reduce((sum, size) => sum + size, 0) + bytes.length > 40_000) {
            fail("playback_fell_behind");
            return;
          }
          sendTwilio({
            event: "media",
            streamSid: binding.streamId,
            media: { payload: event.delta },
          });
          const name = String(++markSequence);
          marks.set(name, bytes.length);
          sendTwilio({ event: "mark", streamSid: binding.streamId, mark: { name } });
          if (finishing && farewellHeard && Date.now() - lastSpeechAt > 750 && marks.size <= 1)
            close();
        } else if (
          event.type === "session.input_transcript.delta" ||
          event.type === "session.output_transcript.delta"
        ) {
          if (event.delta.trim()) {
            clearTimeout(greetingTimer);
            if (event.type === "session.input_transcript.delta") {
              callerSpoke = true;
              lastCallerAt = Date.now();
            } else {
              assistantSpoke = true;
            }
          }
          transcripts.append(
            event.event_id,
            event.type === "session.input_transcript.delta" ? "user" : "assistant",
            event.delta,
            event.start_ms,
            event.end_ms,
          );
        } else if (event.type === "session.usage.updated") {
          seconds = Math.max(seconds, event.usage.seconds);
        } else if (event.type === "session.closed") {
          seconds = event.usage.seconds;
          finalized = true;
          closing = true;
          if (
            event.reason &&
            !["close_requested", "expired", "remote_hangup"].includes(event.reason)
          )
            outcome = "failed";
          void settle();
        } else if (event.type === "response.event") {
          void backend.handle(event.delegation_id, event.event).catch(() => fail("backend_failed"));
        } else if (event.type === "error") {
          fail("openai_error");
        }
      } catch {
        fail("invalid_live_event");
      }
    });
    live.on("error", () => fail("openai_connection_error"));
    live.on("close", () => {
      if (!settled) {
        outcome = "failed";
        closing = true;
        void settle();
      }
    });
  }

  twilio.on("message", (data) => {
    try {
      const raw = parseJson(data.toString());
      const parsed = twilioEventSchema.safeParse(raw);
      if (!parsed.success) {
        fail("invalid_twilio_event");
        return;
      }
      const event = parsed.data;
      if (event.event === "start") {
        void start(raw).catch(() => fail("session_setup_failed"));
        return;
      }
      if (event.event === "connected") return;
      if (!binding || event.streamSid !== binding.streamId) {
        fail("stream_mismatch");
        return;
      }
      if (event.event === "stop") {
        if (!finishing) outcome = "end";
        close();
        return;
      }
      if (event.event === "mark") {
        marks.delete(event.mark.name);
        return;
      }
      if (event.event !== "media" || closing) return;
      const bytes = Buffer.from(event.media.payload, "base64");
      if (vad.push(bytes)) {
        callerSpoke = true;
        clearTimeout(greetingTimer);
        lastCallerAt = Date.now();
        clearPlayback();
      }
      bufferedBytes += bytes.length;
      if (bufferedBytes > 24_000) {
        fail("input_audio_overflow");
        return;
      }
      // Media frames may contain more than 20ms. Split raw PCMU at 160 bytes.
      for (let offset = 0; offset < bytes.length; offset += 160) {
        pendingAudio.push(bytes.subarray(offset, offset + 160).toString("base64"));
      }
    } catch {
      fail("invalid_twilio_message");
    }
  });
  twilio.on("error", () => fail("twilio_connection_error"));
  twilio.on("close", () => {
    if (!closing) {
      outcome = "end";
      close();
    }
  });
  return { close };
}
