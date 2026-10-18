import { and, eq } from "drizzle-orm";
import { aiAdvisorConversations, db, voiceSessionsTable } from "@louez/db";
import { APP_PATH, MAX_BODY_BYTES, liveRequestSchema } from "@louez/voice/protocol";
import { verifyRequest } from "@louez/voice/auth";
import { isVoiceAgentActiveForStore } from "@/lib/ai/phone/eligibility";
import { createLiveConfig } from "@/lib/ai/phone/live-config";
import { claimLiveSession, finishLiveSession, syncLiveSession } from "@/lib/ai/phone/live-session";
import { executeLiveTool } from "@/lib/ai/phone/live-tools";
import { loadCallStore } from "@/lib/ai/phone/webhook";
import { getRelaySigningSecret } from "@/lib/voice/config";
import { log } from "@/lib/evlog";

export const maxDuration = 60;

// INTENTIONALLY PUBLIC [SE-01]: worker-only, authenticated by a short-lived
// HMAC over method, exact path and raw bytes. No browser credentials accepted.
export async function POST(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) return new Response("Missing body", { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return new Response("Too large", { status: 413 });
    }
    chunks.push(value);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (
    !verifyRequest(
      getRelaySigningSecret(),
      APP_PATH,
      req.headers.get("x-relay-timestamp"),
      req.headers.get("x-relay-signature"),
      raw,
    )
  ) {
    return new Response("Forbidden", { status: 403 });
  }
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const parsed = liveRequestSchema.safeParse(input);
  if (!parsed.success) return new Response("Invalid request", { status: 400 });
  const request = parsed.data;
  const conversation = await db.query.aiAdvisorConversations.findFirst({
    where: and(
      eq(aiAdvisorConversations.id, request.conversationId),
      eq(aiAdvisorConversations.providerCallId, request.callId),
      eq(aiAdvisorConversations.channel, "phone"),
    ),
    columns: { storeId: true, callerPhone: true },
  });
  if (!conversation) return new Response("Not found", { status: 404 });
  const store = await loadCallStore(conversation.storeId);
  if (!store) return new Response("Not found", { status: 404 });
  try {
    if (request.type === "start") {
      if (!(await isVoiceAgentActiveForStore(store)))
        return new Response("Inactive", { status: 403 });
      const session = await claimLiveSession(request, store.id);
      if (!session) return new Response("Session already claimed or expired", { status: 409 });
      const config = await createLiveConfig(
        store,
        request.conversationId,
        conversation.callerPhone ?? "",
        session.maxSeconds,
      );
      return Response.json({
        ...config,
        model: session.liveModel,
        backendModel: session.backendModel,
        voice: session.voice,
      });
    }
    const session = await db.query.voiceSessionsTable.findFirst({
      where: and(
        eq(voiceSessionsTable.conversationId, request.conversationId),
        eq(voiceSessionsTable.storeId, store.id),
        eq(voiceSessionsTable.streamId, request.streamId),
        eq(voiceSessionsTable.connectionId, request.connectionId),
      ),
    });
    if (!session) return new Response("Invalid session", { status: 403 });
    // Final accounting must still work after a merchant disables the agent.
    if (request.type === "close") {
      await finishLiveSession({ ...request, storeId: store.id });
      return Response.json({ ok: true });
    }
    if (request.type === "sync") {
      const result = await syncLiveSession(request, store.id);
      return Response.json({
        allowed: result.allowed && !session.settled && (await isVoiceAgentActiveForStore(store)),
      });
    }
    const deadline = (session.startedAt?.getTime() ?? 0) + session.maxSeconds * 1000;
    if (
      session.status !== "active" ||
      Date.now() > deadline ||
      !(await isVoiceAgentActiveForStore(store))
    ) {
      return new Response("Call no longer active", { status: 409 });
    }
    return Response.json(await executeLiveTool(request, store, conversation.callerPhone ?? ""));
  } catch {
    log.error("voice", `Live ${request.type} failed for conversation ${request.conversationId}`);
    return new Response("Voice service unavailable", { status: 503 });
  }
}
