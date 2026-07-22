import { and, eq } from 'drizzle-orm'

import { aiAdvisorConversations, db } from '@louez/db'

import {
  isPhoneReceptionistActiveForStore,
  isPhoneReceptionistConfigured,
} from '@/lib/ai/phone/eligibility'
import { phoneStrings } from '@/lib/ai/phone/messages'
import {
  loadCallStore,
  readVoiceWebhook,
  voiceResponse,
} from '@/lib/ai/phone/webhook'
import { getVoiceProvider } from '@/lib/voice/client'

// INTENTIONALLY PUBLIC route [SE-01]: Twilio POSTs here when a ConversationRelay
// session ends (the worker sent {type:end, handoffData}). Signature-authenticated
// like the other voice webhooks, store-scoped [SE-05]; it only renders a final
// TwiML verb — transfer to a human (<Dial>) or hang up.

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

  const conversationId = new URL(req.url).searchParams.get('c') ?? ''
  if (!/^[A-Za-z0-9_-]{21}$/.test(conversationId)) {
    return new Response('Invalid request', { status: 400 })
  }

  // The worker sets handoffData to signal a transfer; anything else hangs up.
  let wantsTransfer = false
  try {
    const raw = read.rawParams.HandoffData
    if (raw) {
      const parsed = JSON.parse(raw) as { action?: unknown }
      wantsTransfer = parsed?.action === 'transfer'
    }
  } catch {
    // Malformed handoff data → treat as a plain hang up.
  }

  if (wantsTransfer) {
    const conversation = await db.query.aiAdvisorConversations.findFirst({
      where: and(
        eq(aiAdvisorConversations.id, conversationId),
        eq(aiAdvisorConversations.channel, 'phone'),
      ),
      columns: { storeId: true },
    })
    const store = conversation
      ? await loadCallStore(conversation.storeId)
      : null
    const settings = store?.aiPhoneSettings
    const transferNumber = settings?.transferNumber?.trim()
    if (
      store &&
      settings &&
      transferNumber &&
      (await isPhoneReceptionistActiveForStore(store))
    ) {
      const strings = phoneStrings(settings.language)
      return voiceResponse({
        type: 'dial',
        number: transferNumber,
        callerId: read.rawParams.To || undefined,
        speakBefore: {
          text: strings.transferring,
          language: settings.language,
          voice: settings.voice,
        },
      })
    }
  }

  return voiceResponse({ type: 'hangup' })
}
