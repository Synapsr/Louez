import { and, eq } from "drizzle-orm";
import { db, voiceSessionsTable } from "@louez/db";
import { z } from "zod";
import { phoneStrings } from "@/lib/ai/phone/messages";
import { loadCallStore, readVoiceWebhook, voiceResponse } from "@/lib/ai/phone/webhook";
import { getVoiceProvider } from "@/lib/voice/client";

// INTENTIONALLY PUBLIC: Twilio's signed <Connect action> callback. The worker
// persists the outcome before closing its media socket; no caller-supplied
// HandoffData or destination number is trusted.
export async function POST(req: Request) {
  const read = await readVoiceWebhook(req);
  if (!read.ok) return new Response("Bad request", { status: read.status });
  if (
    !getVoiceProvider().verifyWebhook({
      url: read.publicUrl,
      params: read.rawParams,
      signature: read.signature,
    })
  ) {
    return new Response("Invalid signature", { status: 403 });
  }
  const parsed = z
    .object({
      conversationId: z.string().regex(/^[A-Za-z0-9_-]{21}$/),
      callId: z.string().min(1).max(64),
    })
    .safeParse({
      conversationId: new URL(req.url).searchParams.get("c"),
      callId: read.rawParams.CallSid,
    });
  if (!parsed.success) return new Response("Invalid request", { status: 400 });
  const session = await db.query.voiceSessionsTable.findFirst({
    where: and(
      eq(voiceSessionsTable.conversationId, parsed.data.conversationId),
      eq(voiceSessionsTable.providerCallId, parsed.data.callId),
    ),
  });
  if (!session || session.status === "end") return voiceResponse({ type: "hangup" });
  const store = await loadCallStore(session.storeId);
  const settings = store?.aiPhoneSettings;
  const language = settings?.language ?? "en";
  const strings = phoneStrings(language);
  // A disconnected/crashed worker is a failed call, not a successful goodbye.
  if (settings?.enabled && settings.transferNumber) {
    return voiceResponse({
      type: "dial",
      number: settings.transferNumber,
      callerId: read.rawParams.To || undefined,
      speakBefore:
        session.status === "transfer" ? undefined : { text: strings.transferring, language },
    });
  }
  return voiceResponse({ type: "say_hangup", speak: { text: strings.unavailable, language } });
}
