import { WebSocket } from "ws";
import { previewSchema } from "@louez/voice/protocol";
import { pcmWav } from "./audio.js";
import { liveEventSchema, parseJson } from "./events.js";
import { openLiveSocket } from "./live-session.js";
import type { Config } from "./env.js";

const samples: Record<string, string> = {
  fr: "Bonjour, je suis votre assistant de location. Comment puis-je vous aider aujourd’hui ?",
  en: "Hello, I am your rental assistant. How can I help you today?",
  de: "Guten Tag, ich bin Ihr Mietassistent. Wie kann ich Ihnen heute helfen?",
  es: "Hola, soy su asistente de alquiler. ¿En qué puedo ayudarle hoy?",
  it: "Buongiorno, sono il suo assistente per il noleggio. Come posso aiutarla oggi?",
  nl: "Hallo, ik ben uw verhuurassistent. Hoe kan ik u vandaag helpen?",
  pt: "Olá, sou o seu assistente de aluguer. Como posso ajudar hoje?",
  pl: "Dzień dobry, jestem asystentem wypożyczalni. Jak mogę dziś pomóc?",
};
// At most 48 × 480 kB, single flight per preset/locale, two generations at once.
const cache = new Map<string, Buffer>();
const pending = new Map<string, Promise<Buffer>>();

export async function voicePreview(raw: unknown, config: Config): Promise<Buffer> {
  const { voiceId, language } = previewSchema.parse(raw);
  const key = `${config.AI_PHONE_LIVE_MODEL}:${voiceId}:${language}`;
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const existing = pending.get(key);
  if (existing) return existing;
  if (pending.size >= 2) throw new Error("Preview busy");
  const generation = generateVoicePreview(voiceId, samples[language] ?? samples.en ?? "", config);
  pending.set(key, generation);
  try {
    const audio = await generation;
    if (cache.size >= 48) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    cache.set(key, audio);
    return audio;
  } finally {
    pending.delete(key);
  }
}

export function generateVoicePreview(
  voice: string,
  sample: string,
  config: Config,
  openLive = openLiveSocket,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = openLive(config.OPENAI_API_KEY, `preview:${voice}`);
    const chunks: Buffer[] = [];
    let size = 0;
    let hasSpeech = false;
    let closing = false;
    let lastSpeechAt = 0;
    let started = false;
    let inputTimer: ReturnType<typeof setInterval> | undefined;
    let sampleTimer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      clearInterval(inputTimer);
      clearTimeout(sampleTimer);
      clearTimeout(timeout);
      socket.terminate();
    };
    const close = () => {
      if (closing) return;
      closing = true;
      clearInterval(inputTimer);
      clearTimeout(sampleTimer);
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: "session.close" }));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Preview timed out"));
    }, 20_000);
    socket.on("open", () =>
      socket.send(
        JSON.stringify({
          type: "session.start",
          session: {
            model: config.AI_PHONE_LIVE_MODEL,
            store: false,
            instructions:
              "Read the provided greeting once, naturally, exactly as written. Do not add anything. Remain silent afterward.",
            input: [
              {
                type: "message",
                role: "developer",
                content: [{ type: "input_text", text: `Say now: ${sample}` }],
              },
            ],
            audio: { format: { type: "audio/pcm", rate: 24000 }, output: { voice } },
            delegation: { type: "client" },
          },
        }),
      ),
    );
    socket.on("message", (data) => {
      const parsed = liveEventSchema.safeParse(parseJson(data.toString()));
      if (!parsed.success) return;
      const event = parsed.data;
      if (event.type === "session.started") {
        if (started) return;
        started = true;
        inputTimer = setInterval(() => {
          if (
            !closing &&
            hasSpeech &&
            Date.now() - lastSpeechAt > 1200 &&
            socket.readyState === WebSocket.OPEN
          ) {
            close();
          }
          if (!closing && socket.readyState === WebSocket.OPEN)
            socket.send(
              JSON.stringify({
                type: "session.input_audio.append",
                audio: Buffer.alloc(960).toString("base64"),
              }),
            );
        }, 20);
        sampleTimer = setTimeout(close, 10_000);
      } else if (event.type === "session.output_audio.delta") {
        const chunk = Buffer.from(event.delta, "base64");
        size += chunk.length;
        if (size > 480_000) return;
        for (let offset = 0; offset + 1 < chunk.length; offset += 2) {
          if (Math.abs(chunk.readInt16LE(offset)) > 300) {
            hasSpeech = true;
            lastSpeechAt = Date.now();
            break;
          }
        }
        chunks.push(chunk);
      } else if (event.type === "session.closed") {
        cleanup();
        if (hasSpeech) resolve(pcmWav(Buffer.concat(chunks)));
        else reject(new Error("Preview returned no speech"));
      } else if (event.type === "error") {
        cleanup();
        reject(new Error("Preview unavailable"));
      }
    });
    socket.on("error", () => {
      cleanup();
      reject(new Error("Preview connection failed"));
    });
    socket.on("close", () => {
      cleanup();
      reject(new Error("Preview ended before finalization"));
    });
  });
}
