import { createHmac, timingSafeEqual } from 'node:crypto'

import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { aiAdvisorConversations, db } from '@louez/db'

import { streamPhoneTurn } from '@/lib/ai/phone/agent'
import { checkPhoneCredits } from '@/lib/ai/phone/credits'
import {
  isPhoneReceptionistActiveForStore,
  isPhoneReceptionistConfigured,
} from '@/lib/ai/phone/eligibility'
import { phoneStrings } from '@/lib/ai/phone/messages'
import { loadCallStore } from '@/lib/ai/phone/webhook'
import { buildProductGuidance } from '@/lib/ai/product-guidance'
import { env } from '@/env'
import { getRelaySigningSecret, isRelayTransport } from '@/lib/voice/config'
import { getStorePlan } from '@/lib/plan-limits'
import { areAiCreditsEnabled } from '@/lib/plans'

// INTENTIONALLY PUBLIC route [SE-01]: called by the ConversationRelay worker
// once per caller utterance. Authenticated by an HMAC signature over the raw
// body (shared VOICE_RELAY_SIGNING_SECRET), Zod-validated [SE-03], store-scoped
// [SE-05]. Streams the assistant reply as Server-Sent Events so the worker can
// relay it to the provider's TTS token-by-token.

// Streaming must not be statically optimized or buffered by the host.
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 16 * 1024

const turnSchema = z.object({
  conversationId: z.string().length(21),
  callSid: z.string().max(64).optional(),
  text: z.string().min(1).max(4000),
})

const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-store, no-transform',
} as const

const MAX_SIGNATURE_SKEW_MS = 60_000

/**
 * Constant-time check of the worker's fresh, HMAC-signed request. The signature
 * covers `${timestamp}.${rawBody}` and the timestamp must be recent, so a
 * captured request cannot be replayed outside a narrow window.
 */
function validSignature(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
): boolean {
  const secret = getRelaySigningSecret()
  if (!secret || !signature || !timestamp) return false
  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_SIGNATURE_SKEW_MS) {
    return false
  }
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('base64url')
  const provided = Buffer.from(signature)
  const wanted = Buffer.from(expected)
  return provided.length === wanted.length && timingSafeEqual(provided, wanted)
}

/** Encode one SSE data frame. */
function frame(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`
}

/** Speak one fixed line then end the call — for caps/gates that skip the model. */
function speakAndEnd(text: string): Response {
  return new Response(
    frame({ type: 'token', token: text }) +
      frame({ type: 'end', control: 'end', transferNumber: null }),
    { headers: SSE_HEADERS },
  )
}

export async function POST(req: Request) {
  if (!isPhoneReceptionistConfigured() || !isRelayTransport()) {
    return new Response('Not found', { status: 404 })
  }

  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BODY_BYTES) {
    return new Response('Payload too large', { status: 413 })
  }
  const rawBody = await req.text()
  if (rawBody.length > MAX_BODY_BYTES) {
    return new Response('Payload too large', { status: 413 })
  }
  if (
    !validSignature(
      rawBody,
      req.headers.get('x-relay-signature'),
      req.headers.get('x-relay-timestamp'),
    )
  ) {
    return new Response('Invalid signature', { status: 403 })
  }

  let json: unknown
  try {
    json = JSON.parse(rawBody)
  } catch {
    return new Response('Invalid request', { status: 400 })
  }
  const body = turnSchema.safeParse(json)
  if (!body.success) return new Response('Invalid request', { status: 400 })
  const { conversationId, text } = body.data

  const conversation = await db.query.aiAdvisorConversations.findFirst({
    where: and(
      eq(aiAdvisorConversations.id, conversationId),
      eq(aiAdvisorConversations.channel, 'phone'),
    ),
    columns: { id: true, storeId: true, callerPhone: true, createdAt: true },
  })
  if (!conversation) return new Response('Not found', { status: 404 })

  const store = await loadCallStore(conversation.storeId)
  const settings = store?.aiPhoneSettings
  if (!store || !settings || !(await isPhoneReceptionistActiveForStore(store))) {
    return new Response('Forbidden', { status: 403 })
  }

  const strings = phoneStrings(settings.language)

  // Hard duration cap (bounds cost + toll-fraud): say goodbye and end.
  const elapsedSeconds =
    (Date.now() - conversation.createdAt.getTime()) / 1000
  if (elapsedSeconds > env.AI_PHONE_MAX_CALL_SECONDS) {
    return speakAndEnd(strings.goodbye)
  }

  const plan = await getStorePlan(store.id)

  // Fail-closed mid-call credit gate: a long call that exhausts credits stops.
  if (areAiCreditsEnabled()) {
    const credit = await checkPhoneCredits(store.id, plan)
    if (!credit.allowed) return speakAndEnd(strings.goodbye)
  }

  const productGuidance = await buildProductGuidance(store.id)
  const transferNumber = settings.transferNumber?.trim() || null

  const { textStream, finalize } = await streamPhoneTurn(
    {
      store: {
        id: store.id,
        name: store.name,
        slug: store.slug,
        description: store.description ?? null,
        currency: store.settings?.currency ?? 'EUR',
      },
      conversationId,
      callerPhone: conversation.callerPhone ?? '',
      settings,
      storeContext: store.aiAdvisorSettings?.storeContext ?? null,
      productGuidance,
      plan,
      userSpeech: text,
      today: new Date().toISOString().split('T')[0],
    },
    req.signal, // aborts on worker disconnect / barge-in
  )

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let spoken = ''
      let aborted = false
      try {
        for await (const delta of textStream) {
          spoken += delta
          controller.enqueue(encoder.encode(frame({ type: 'token', token: delta })))
        }
      } catch {
        // AbortError (barge-in) or a stream error — stop relaying tokens.
        aborted = true
      }

      // Persist what was actually spoken + meter, and resolve the control intent.
      const { control } = await finalize(spoken)

      if (!aborted) {
        controller.enqueue(
          encoder.encode(
            frame({
              type: 'end',
              control:
                control === 'transfer'
                  ? 'transfer'
                  : control === 'end'
                    ? 'end'
                    : 'continue',
              transferNumber: control === 'transfer' ? transferNumber : null,
            }),
          ),
        )
      }
      try {
        controller.close()
      } catch {
        // Consumer already gone (aborted) — nothing to flush.
      }
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
}
