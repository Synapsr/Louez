import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { initLogger, log } from "evlog";
import { verifyRequest, verifyTwilioUpgrade } from "@louez/voice/auth";
import { previewSchema } from "@louez/voice/protocol";
import { bridge } from "./bridge.js";
import { loadConfig } from "./env.js";
import { parseJson } from "./events.js";
import { voicePreview } from "./preview.js";

initLogger({ env: { service: "louez-voice-relay" } });
const config = loadConfig();
const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
const calls = new Set<ReturnType<typeof bridge>>();
let shuttingDown = false;

const server = createServer(async (req, res) => {
  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(shuttingDown ? 503 : 200);
    res.end(shuttingDown ? "draining" : "ok");
    return;
  }
  if (req.url !== "/preview" || req.method !== "POST" || shuttingDown) {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > 2048) {
        res.writeHead(413);
        res.end();
        return;
      }
      chunks.push(bytes);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    const timestamp = req.headers["x-relay-timestamp"];
    const signature = req.headers["x-relay-signature"];
    if (
      !verifyRequest(
        config.VOICE_RELAY_SIGNING_SECRET,
        "/preview",
        typeof timestamp === "string" ? timestamp : null,
        typeof signature === "string" ? signature : null,
        raw,
      )
    ) {
      res.writeHead(403);
      res.end();
      return;
    }
    const parsed = previewSchema.safeParse(parseJson(raw));
    if (!parsed.success) {
      res.writeHead(400);
      res.end();
      return;
    }
    const audio = await voicePreview(parsed.data, config);
    res.writeHead(200, {
      "content-type": "audio/wav",
      "content-length": audio.length,
      "cache-control": "private, max-age=3600",
    });
    res.end(audio);
  } catch {
    res.writeHead(503);
    res.end("Preview unavailable");
  }
});
server.requestTimeout = 25_000;
server.headersTimeout = 10_000;

server.on("upgrade", (req, socket, head) => {
  const signature = req.headers["x-twilio-signature"];
  const publicUrl = new URL("/media", config.VOICE_RELAY_WS_URL);
  const wssUrl = publicUrl.href;
  publicUrl.protocol = "https:";
  const authenticated =
    typeof signature === "string" &&
    [wssUrl, `${wssUrl}/`, publicUrl.href, `${publicUrl.href}/`].some((url) =>
      verifyTwilioUpgrade(config.TWILIO_AUTH_TOKEN, url, signature),
    );
  if (
    req.url !== "/media" ||
    !authenticated ||
    shuttingDown ||
    sockets.clients.size >= config.MAX_CONCURRENT_CALLS
  ) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(req, socket, head, (ws) => {
    const call = bridge(ws, config);
    calls.add(call);
    ws.on("close", () => calls.delete(call));
  });
});

server.listen(config.PORT, () => log.info("voice", "GPT-Live relay ready"));
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close();
  for (const call of calls) call.close();
  const timer = setTimeout(() => {
    for (const ws of sockets.clients) ws.terminate();
    process.exit(0);
  }, 25_000);
  timer.unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
