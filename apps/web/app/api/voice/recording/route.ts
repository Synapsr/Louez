import { and, eq } from 'drizzle-orm'

import { aiAdvisorConversations, db } from '@louez/db'

import { isPhoneReceptionistConfigured } from '@/lib/ai/phone/eligibility'
import { readVoiceWebhook } from '@/lib/ai/phone/webhook'
import { getVoiceProvider } from '@/lib/voice/client'

// INTENTIONALLY PUBLIC route [SE-01]: the call-recording status callback. The
// provider POSTs here (signature-authenticated) when a recording finalizes. It
// stores the recording id + duration on the matching phone conversation so the
// merchant can replay it. No media is stored here — only the id; playback is
// proxied on demand (see /api/voice/recording/[conversationId]).

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

  const recording = provider.parseRecordingCallback(read.rawParams)
  if (!recording) return new Response(null, { status: 204 })

  // Scoped by the provider call id (unique per call) + channel; the recording
  // id comes from a signature-verified provider callback.
  await db
    .update(aiAdvisorConversations)
    .set({
      recordingSid: recording.recordingSid,
      recordingDurationSeconds: recording.durationSeconds,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(aiAdvisorConversations.providerCallId, recording.callId),
        eq(aiAdvisorConversations.channel, 'phone'),
      ),
    )

  return new Response(null, { status: 204 })
}
