import { createHmac } from 'node:crypto'

import { aiAdvisorConversations, aiAdvisorMessages, db } from '@louez/db'

import { checkPhoneCredits } from '@/lib/ai/phone/credits'
import {
  isPhoneReceptionistActiveForStore,
  isPhoneReceptionistConfigured,
} from '@/lib/ai/phone/eligibility'
import { phoneStrings } from '@/lib/ai/phone/messages'
import {
  readVoiceWebhook,
  resolveStoreForCall,
  voiceResponse,
  voiceWebhookParamsSchema,
} from '@/lib/ai/phone/webhook'
import { getStorePlan } from '@/lib/plan-limits'
import { areAiCreditsEnabled } from '@/lib/plans'
import { isWithinBusinessHours } from '@/lib/utils/business-hours'
import { getVoiceProvider } from '@/lib/voice/client'
import {
  getRelaySigningSecret,
  getRelayWsUrl,
  getSttProvider,
  getTtsProvider,
  isRelayTransport,
  resolveVoiceId,
} from '@/lib/voice/config'

// INTENTIONALLY PUBLIC route [SE-01]: this is the inbound telephony webhook.
// It is authenticated by the provider's request SIGNATURE (X-Twilio-Signature),
// not a user session; every query is store-scoped [SE-05]; input is
// Zod-validated [SE-03]. The whole feature 404s unless the operator configured
// it and the store opted in.

export async function POST(req: Request) {
  if (!isPhoneReceptionistConfigured()) {
    return new Response('Not found', { status: 404 })
  }

  const read = await readVoiceWebhook(req)
  if (!read.ok) return new Response('Bad request', { status: read.status })

  const provider = getVoiceProvider()
  if (
    !provider.verifyWebhook({
      url: read.publicUrl,
      params: read.rawParams,
      signature: read.signature,
    })
  ) {
    return new Response('Invalid signature', { status: 403 })
  }

  const parsed = voiceWebhookParamsSchema.safeParse(read.rawParams)
  if (!parsed.success) return new Response('Invalid request', { status: 400 })
  const call = provider.parseInboundCall(read.rawParams)

  const store = await resolveStoreForCall(call.to)
  if (!store || !store.onboardingCompleted) {
    return voiceResponse({
      type: 'say_hangup',
      speak: { text: phoneStrings('en').unavailable, language: 'en' },
    })
  }

  const settings = store.aiPhoneSettings
  const strings = phoneStrings(settings?.language ?? 'en')

  if (!settings || !(await isPhoneReceptionistActiveForStore(store))) {
    return voiceResponse({
      type: 'say_hangup',
      speak: {
        text: strings.unavailable,
        language: settings?.language ?? 'en',
        voice: settings?.voice,
      },
    })
  }

  const language = settings.language
  const speak = (text: string) => ({ text, language, voice: settings.voice })

  // Credit gate (fail-closed) when the credit layer is on.
  const plan = await getStorePlan(store.id)
  if (areAiCreditsEnabled()) {
    const credit = await checkPhoneCredits(store.id, plan)
    if (!credit.allowed) {
      if (settings.transferNumber) {
        return voiceResponse({
          type: 'dial',
          number: settings.transferNumber,
          callerId: call.to,
          speakBefore: speak(strings.transferring),
        })
      }
      return voiceResponse({
        type: 'say_hangup',
        speak: speak(strings.unavailable),
      })
    }
  }

  // After-hours mode: hand off to the human line during business hours. Only
  // meaningful when the store actually configured (enabled) its hours —
  // otherwise every call would look "open" and always transfer.
  const businessHours = store.settings?.businessHours
  if (
    settings.answerMode === 'after_hours' &&
    settings.transferNumber &&
    businessHours?.enabled
  ) {
    const open = isWithinBusinessHours(
      new Date(),
      businessHours,
      store.settings?.timezone,
    ).valid
    if (open) {
      return voiceResponse({
        type: 'dial',
        number: settings.transferNumber,
        callerId: call.to,
        speakBefore: speak(strings.transferring),
      })
    }
  }

  // Create the phone conversation and persist the greeting as the first turn.
  const greeting = `${strings.disclosure(store.name)} ${
    settings.greeting?.trim() || strings.ask
  }`.trim()

  const conversationId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(aiAdvisorConversations)
      .values({
        storeId: store.id,
        channel: 'phone',
        callerPhone: call.from || null,
        providerCallId: call.callId || null,
        locale: language,
      })
      .$returningId()
    await tx.insert(aiAdvisorMessages).values({
      conversationId: created.id,
      storeId: store.id,
      role: 'assistant',
      content: greeting,
    })
    return created.id
  })

  // Streaming transport (ConversationRelay): hand off to the worker over a
  // signed wss url — the provider runs STT/TTS/barge-in and the per-turn loop
  // lives on the worker. Falls back to <Gather> when the relay isn't configured.
  if (isRelayTransport()) {
    // Short-lived, expiry-bound handshake token: the worker connects immediately,
    // so a captured wss url can't be replayed later to open new relay sessions.
    const expiresAt = Date.now() + 300_000
    const token = createHmac('sha256', getRelaySigningSecret())
      .update(`${conversationId}.${expiresAt}`)
      .digest('base64url')
    return voiceResponse({
      type: 'connect_relay',
      wsUrl: `${getRelayWsUrl()}/relay?c=${conversationId}&e=${expiresAt}&t=${token}`,
      welcomeGreeting: greeting,
      language,
      ttsProvider: getTtsProvider(),
      sttProvider: getSttProvider(),
      voice: resolveVoiceId(language, settings.voice),
      actionUrl: `${read.origin}/api/voice/relay-action?c=${conversationId}`,
    })
  }

  return voiceResponse({
    type: 'gather',
    speak: speak(greeting),
    actionUrl: `${read.origin}/api/voice/respond?c=${conversationId}`,
  })
}
