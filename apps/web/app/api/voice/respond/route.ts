import { eq } from 'drizzle-orm'

import { aiAdvisorConversations, db } from '@louez/db'

import { runPhoneTurn } from '@/lib/ai/phone/agent'
import {
  isVoiceAgentActiveForStore,
  isVoiceAgentConfigured,
} from '@/lib/ai/phone/eligibility'
import { phoneStrings } from '@/lib/ai/phone/messages'
import {
  loadCallStore,
  readVoiceWebhook,
  voiceResponse,
  voiceWebhookParamsSchema,
} from '@/lib/ai/phone/webhook'
import { buildProductGuidance } from '@/lib/ai/product-guidance'
import { env } from '@/env'
import { log } from '@/lib/evlog'
import { getStorePlan } from '@/lib/plan-limits'
import { getVoiceProvider } from '@/lib/voice/client'

// INTENTIONALLY PUBLIC route [SE-01]: the per-turn telephony callback. Same
// security model as /api/voice/incoming — signature-authenticated, store-scoped,
// Zod-validated. The `c` (conversation id) is part of the signed URL, so it
// cannot be forged.

export async function POST(req: Request) {
  if (!isVoiceAgentConfigured()) {
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

  const conversationId = new URL(req.url).searchParams.get('c') ?? ''
  if (!/^[A-Za-z0-9_-]{21}$/.test(conversationId)) {
    return new Response('Invalid request', { status: 400 })
  }

  const conversation = await db.query.aiAdvisorConversations.findFirst({
    where: eq(aiAdvisorConversations.id, conversationId),
    columns: {
      id: true,
      storeId: true,
      channel: true,
      callerPhone: true,
      createdAt: true,
    },
  })
  if (!conversation || conversation.channel !== 'phone') {
    return voiceResponse({
      type: 'say_hangup',
      speak: { text: phoneStrings('en').unavailable, language: 'en' },
    })
  }

  const store = await loadCallStore(conversation.storeId)
  const settings = store?.aiPhoneSettings
  if (
    !store ||
    !settings ||
    !(await isVoiceAgentActiveForStore(store))
  ) {
    return voiceResponse({
      type: 'say_hangup',
      speak: {
        text: phoneStrings(settings?.language ?? 'en').unavailable,
        language: settings?.language ?? 'en',
        voice: settings?.voice,
      },
    })
  }

  const language = settings.language
  const strings = phoneStrings(language)
  const speak = (text: string) => ({ text, language, voice: settings.voice })
  const respondUrl = (extra = '') =>
    `${read.origin}/api/voice/respond?c=${conversationId}${extra}`

  // Hard duration cap — bound cost and toll-fraud blast radius.
  const elapsedSeconds =
    (Date.now() - conversation.createdAt.getTime()) / 1000
  if (elapsedSeconds > env.AI_PHONE_MAX_CALL_SECONDS) {
    return voiceResponse({ type: 'say_hangup', speak: speak(strings.goodbye) })
  }

  const speech = (parsed.data.SpeechResult ?? '').trim()
  if (!speech) {
    // No speech recognized: reprompt once (marked with empty=1), then end.
    if (new URL(req.url).searchParams.get('empty') === '1') {
      return voiceResponse({ type: 'say_hangup', speak: speak(strings.goodbye) })
    }
    return voiceResponse({
      type: 'gather',
      speak: speak(strings.reprompt),
      actionUrl: respondUrl('&empty=1'),
    })
  }

  const [plan, productGuidance] = await Promise.all([
    getStorePlan(store.id),
    buildProductGuidance(store.id),
  ])

  let result
  try {
    result = await runPhoneTurn({
      store: {
        id: store.id,
        name: store.name,
        slug: store.slug,
        description: store.description ?? null,
        currency: store.settings?.currency ?? 'EUR',
        email: store.email ?? null,
        phone: store.phone ?? null,
        address: store.address ?? null,
        businessHours: store.settings?.businessHours ?? null,
        timezone: store.settings?.timezone ?? null,
        deliveryEnabled: store.settings?.delivery?.enabled ?? null,
        deliveryMode: store.settings?.delivery?.mode ?? null,
      },
      conversationId,
      callerPhone: conversation.callerPhone ?? call.from,
      settings,
      storeContext: store.aiAdvisorSettings?.storeContext ?? null,
      productGuidance,
      plan,
      userSpeech: speech,
      today: new Date().toISOString().split('T')[0],
    })
  } catch (error) {
    log.error(
      'phone',
      `turn failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return voiceResponse({ type: 'say_hangup', speak: speak(strings.goodbye) })
  }

  if (result.control === 'transfer' && settings.transferNumber) {
    return voiceResponse({
      type: 'dial',
      number: settings.transferNumber,
      callerId: call.to,
      speakBefore: speak(result.text || strings.transferring),
    })
  }

  if (result.control === 'end') {
    return voiceResponse({
      type: 'say_hangup',
      speak: speak(result.text || strings.goodbye),
    })
  }

  return voiceResponse({
    type: 'gather',
    speak: speak(result.text || strings.reprompt),
    actionUrl: respondUrl(),
  })
}
