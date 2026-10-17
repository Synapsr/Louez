import { createHash } from "node:crypto";
import { streamToken } from "@louez/voice/auth";
import { callDurationBudget } from "@/lib/ai/phone/live-session";

import { aiAdvisorConversations, db, voiceSessionsTable } from "@louez/db";

import { checkPhoneCredits } from "@/lib/ai/phone/credits";
import { isVoiceAgentActiveForStore, isVoiceAgentConfigured } from "@/lib/ai/phone/eligibility";
import { phoneStrings } from "@/lib/ai/phone/messages";
import {
  readVoiceWebhook,
  resolveStoreForCall,
  voiceResponse,
  voiceWebhookParamsSchema,
} from "@/lib/ai/phone/webhook";
import { getStorePlan } from "@/lib/plan-limits";
import { areAiCreditsEnabled } from "@/lib/plans";
import { isWithinBusinessHours } from "@/lib/utils/business-hours";
import { getVoiceProvider } from "@/lib/voice/client";
import {
  getLiveModel,
  getPhoneBackendModel,
  getRelaySigningSecret,
  getRelayWsUrl,
  resolveVoiceId,
} from "@/lib/voice/config";

// INTENTIONALLY PUBLIC route [SE-01]: this is the inbound telephony webhook.
// It is authenticated by the provider's request SIGNATURE (X-Twilio-Signature),
// not a user session; every query is store-scoped [SE-05]; input is
// Zod-validated [SE-03]. The whole feature 404s unless the operator configured
// it and the store opted in.

export async function POST(req: Request) {
  if (!isVoiceAgentConfigured()) {
    return new Response("Not found", { status: 404 });
  }

  const read = await readVoiceWebhook(req);
  if (!read.ok) return new Response("Bad request", { status: read.status });

  const provider = getVoiceProvider();
  if (
    !provider.verifyWebhook({
      url: read.publicUrl,
      params: read.rawParams,
      signature: read.signature,
    })
  ) {
    return new Response("Invalid signature", { status: 403 });
  }

  const parsed = voiceWebhookParamsSchema.safeParse(read.rawParams);
  if (!parsed.success) return new Response("Invalid request", { status: 400 });
  const call = provider.parseInboundCall(read.rawParams);

  const store = await resolveStoreForCall(call.to);
  if (!store || !store.onboardingCompleted) {
    return voiceResponse({
      type: "say_hangup",
      speak: { text: phoneStrings("en").unavailable, language: "en" },
    });
  }

  const settings = store.aiPhoneSettings;
  const strings = phoneStrings(settings?.language ?? "en");

  if (!settings || !(await isVoiceAgentActiveForStore(store))) {
    return voiceResponse({
      type: "say_hangup",
      speak: {
        text: strings.unavailable,
        language: settings?.language ?? "en",
      },
    });
  }

  const language = settings.language;
  const speak = (text: string) => ({ text, language });

  // Credit gate (fail-closed) when the credit layer is on.
  const plan = await getStorePlan(store.id);
  if (areAiCreditsEnabled()) {
    const credit = await checkPhoneCredits(store.id, plan);
    if (!credit.allowed) {
      if (settings.transferNumber) {
        return voiceResponse({
          type: "dial",
          number: settings.transferNumber,
          callerId: call.to,
          speakBefore: speak(strings.transferring),
        });
      }
      return voiceResponse({
        type: "say_hangup",
        speak: speak(strings.unavailable),
      });
    }
  }

  // After-hours mode: hand off to the human line during business hours. Only
  // meaningful when the store actually configured (enabled) its hours —
  // otherwise every call would look "open" and always transfer.
  const businessHours = store.settings?.businessHours;
  if (settings.answerMode === "after_hours" && settings.transferNumber && businessHours?.enabled) {
    const open = isWithinBusinessHours(new Date(), businessHours, store.settings?.timezone).valid;
    if (open) {
      return voiceResponse({
        type: "dial",
        number: settings.transferNumber,
        callerId: call.to,
        speakBefore: speak(strings.transferring),
      });
    }
  }

  const maxSeconds = await callDurationBudget(store.id, plan);
  if (maxSeconds <= 0) {
    return settings.transferNumber
      ? voiceResponse({
          type: "dial",
          number: settings.transferNumber,
          callerId: call.to,
          speakBefore: speak(strings.transferring),
        })
      : voiceResponse({ type: "say_hangup", speak: speak(strings.unavailable) });
  }

  // Deterministic ID and a unique call binding make Twilio webhook retries safe.
  const conversationId = createHash("sha256")
    .update(`twilio:${call.callId}`)
    .digest("base64url")
    .slice(0, 21);
  const created = await db.transaction(async (tx) => {
    await tx
      .insert(aiAdvisorConversations)
      .values({
        id: conversationId,
        storeId: store.id,
        channel: "phone",
        callerPhone: call.from || null,
        providerCallId: call.callId,
        locale: language,
      })
      .onDuplicateKeyUpdate({ set: { id: conversationId } });
    const [inserted] = await tx
      .insert(voiceSessionsTable)
      .values({
        conversationId,
        storeId: store.id,
        providerCallId: call.callId,
        maxSeconds,
        liveModel: getLiveModel(),
        backendModel: getPhoneBackendModel(),
        voice: resolveVoiceId(language, settings.voice),
      })
      .onDuplicateKeyUpdate({ set: { conversationId } });
    return inserted.affectedRows === 1;
  });

  if (created && settings.recordCalls && call.callId) {
    // Keep existing opt-in recording. Failures are logged by the provider.
    void provider.startCallRecording({
      callId: call.callId,
      statusCallbackUrl: `${read.origin}/api/voice/recording`,
    });
  }
  const expires = String(Date.now() + 300_000);
  return voiceResponse({
    type: "connect_stream",
    wsUrl: `${getRelayWsUrl()}/media`,
    parameters: {
      conversationId,
      expires,
      token: streamToken(getRelaySigningSecret(), conversationId, call.callId, expires),
    },
    disclosure: speak(
      `${strings.disclosure(store.name)}${settings.recordCalls ? ` ${strings.recordingNotice}` : ""}`,
    ),
    actionUrl: `${read.origin}/api/voice/stream-action?c=${conversationId}`,
  });
}
