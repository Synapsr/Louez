import { and, eq } from 'drizzle-orm'

import { aiAdvisorConversations, db } from '@louez/db'

import { maybeTriggerAutoTopup } from '@/lib/ai/advisor/auto-topup'
import { recordCallAudioDebit } from '@/lib/ai/phone/credits'
import { isPhoneReceptionistConfigured } from '@/lib/ai/phone/eligibility'
import {
  readVoiceWebhook,
  voiceWebhookParamsSchema,
} from '@/lib/ai/phone/webhook'
import { getStorePlan } from '@/lib/plan-limits'
import { areAiCreditsEnabled } from '@/lib/plans'
import { getVoiceProvider } from '@/lib/voice/client'

// INTENTIONALLY PUBLIC route [SE-01]: the end-of-call status callback. Signature
// authenticated. On call completion it records the billed duration and settles
// the call's AUDIO cost against the store's AI credits (idempotent per callId).
// Configure the number's "Call status changes" webhook to POST here.

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

  // Only the terminal event carries the billed duration; ignore the rest.
  if (call.status !== 'completed') {
    return new Response(null, { status: 204 })
  }

  const conversation = await db.query.aiAdvisorConversations.findFirst({
    where: and(
      eq(aiAdvisorConversations.providerCallId, call.callId),
      eq(aiAdvisorConversations.channel, 'phone'),
    ),
    columns: { id: true, storeId: true },
  })
  if (!conversation) return new Response(null, { status: 204 })

  const seconds = call.durationSeconds ?? 0
  await db
    .update(aiAdvisorConversations)
    .set({ durationSeconds: seconds, updatedAt: new Date() })
    .where(eq(aiAdvisorConversations.id, conversation.id))

  if (areAiCreditsEnabled() && seconds > 0) {
    const plan = await getStorePlan(conversation.storeId)
    await recordCallAudioDebit({
      storeId: conversation.storeId,
      conversationId: conversation.id,
      callId: call.callId,
      audioSeconds: seconds,
      plan,
    })
    await maybeTriggerAutoTopup(conversation.storeId)
  }

  return new Response(null, { status: 204 })
}
