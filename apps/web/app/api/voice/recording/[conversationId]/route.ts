import { and, eq } from 'drizzle-orm'

import { aiAdvisorConversations, db } from '@louez/db'

import { getCurrentStore } from '@/lib/store-context'
import { getVoiceProvider } from '@/lib/voice/client'

// Dashboard-only [SE-01]: streams a call recording's audio to the merchant.
// Session-authenticated AND store-scoped [SE-05] — the conversation must belong
// to the caller's active store (same authorization as its transcript). The
// media is proxied with the provider credentials, so no recording is ever
// publicly reachable and no provider URL is exposed to the browser.

export async function GET(
  req: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const store = await getCurrentStore()
  if (!store) return new Response('Unauthorized', { status: 401 })

  const { conversationId } = await params
  if (conversationId.length > 32) {
    return new Response('Not found', { status: 404 })
  }

  const conversation = await db.query.aiAdvisorConversations.findFirst({
    where: and(
      eq(aiAdvisorConversations.id, conversationId),
      eq(aiAdvisorConversations.storeId, store.id),
    ),
    columns: { recordingSid: true },
  })
  if (!conversation?.recordingSid) {
    return new Response('Not found', { status: 404 })
  }

  return getVoiceProvider().fetchRecordingMedia({
    recordingSid: conversation.recordingSid,
    range: req.headers.get('range'),
  })
}
