import { convertToModelMessages, stepCountIs, streamText } from 'ai'
import type { UIMessage } from 'ai'
import { and, eq, inArray } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { z } from 'zod'

import {
  aiAdvisorConversations,
  aiAdvisorMessages,
  db,
  products,
  stores,
} from '@louez/db'
import {
  AI_ADVISOR_MESSAGE_MAX_LENGTH,
  advisorCartSnapshotSchema,
} from '@louez/validations'
import type { AdvisorCartSnapshot } from '@louez/validations'

import { getCustomerSession } from '@/app/(storefront)/[slug]/account/actions'
import { maybeTriggerAutoTopup } from '@/lib/ai/advisor/auto-topup'
import {
  checkAdvisorCredits,
  recordAdvisorRunDebit,
} from '@/lib/ai/advisor/credits'
import { checkAdvisorRateLimit } from '@/lib/ai/advisor/rate-limit'
import { buildAdvisorSystemPrompt } from '@/lib/ai/advisor/system-prompt'
import { createAdvisorTools } from '@/lib/ai/advisor/tools'
import type { AdvisorChatContext } from '@/lib/ai/advisor/tools'
import { normalizeUsage } from '@/lib/ai/pricing'
import { buildProductGuidance } from '@/lib/ai/product-guidance'
import { getAdvisorAIModel, isAIChatConfigured } from '@/lib/ai/provider'
import { log } from '@/lib/evlog'
import { areAiCreditsEnabled } from '@/lib/plans'
import { getStorePlan } from '@/lib/plan-limits'
import { getClientIp } from '@/lib/request'
import { defaultLocale, locales } from '@/i18n/config'

// INTENTIONALLY PUBLIC route [SE-01]: customers chat anonymously with the
// store's advisor. It only activates for stores that opted in, is rate limited
// per IP / conversation / store (fail-closed), and every query is store-scoped.
// Anonymous access model: possession of the unguessable conversation id.

// Keep the model context bounded: older turns stay in DB, not in the prompt.
const HISTORY_WINDOW = 20
// Hard cap on the raw request size (a message history full of tool parts
// stays well under this; anything bigger is abuse).
const MAX_BODY_BYTES = 256 * 1024
// Structural validation only — convertToModelMessages() performs the strict
// UIMessage validation (tool parts included) and throws on malformed input.
const advisorChatRequestSchema = z.object({
  messages: z
    .array(
      z
        .object({
          role: z.string(),
          parts: z.array(z.looseObject({ type: z.string() })).optional(),
        })
        .loose(),
    )
    .min(1)
    .max(200),
  conversationId: z.string().length(21).optional(),
  cart: advisorCartSnapshotSchema.optional(),
})

/** Plain text of a UIMessage (for persistence and length checks). */
function messageText(message: { parts?: Array<{ type: string }> }): string {
  return (message.parts ?? [])
    .filter(
      (part): part is { type: 'text'; text: string } =>
        part.type === 'text' && typeof (part as { text?: unknown }).text === 'string',
    )
    .map((part) => part.text)
    .join('\n')
}

async function resolveLocale(acceptLanguage: string | null): Promise<string> {
  const cookieStore = await cookies()
  const cookieLocale = cookieStore.get('NEXT_LOCALE')?.value
  if (cookieLocale && (locales as readonly string[]).includes(cookieLocale)) {
    return cookieLocale
  }

  const headerLocale = acceptLanguage
    ?.split(',')[0]
    ?.trim()
    .split('-')[0]
    ?.toLowerCase()
  if (headerLocale && (locales as readonly string[]).includes(headerLocale)) {
    return headerLocale
  }

  return defaultLocale
}

/** Cart lines with product names, for the system prompt. */
async function buildCartSummary(
  storeId: string,
  cart: AdvisorCartSnapshot | undefined,
): Promise<string | null> {
  if (!cart || cart.items.length === 0) return null

  const rows = await db
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(
      and(
        eq(products.storeId, storeId),
        eq(products.status, 'active'),
        inArray(
          products.id,
          cart.items.map((item) => item.productId),
        ),
      ),
    )

  const productById = new Map(rows.map((row) => [row.id, row]))
  const lines = cart.items.flatMap((item) => {
    const product = productById.get(item.productId)
    return product
      ? [`- ${item.quantity} × "${product.name}" (productId: ${product.id})`]
      : []
  })
  if (lines.length === 0) return null

  if (cart.startDate && cart.endDate) {
    lines.push(`Rental period: ${cart.startDate} → ${cart.endDate}`)
  }

  return lines.join('\n')
}

export async function POST(req: Request) {
  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BODY_BYTES) {
    return new Response('Payload too large', { status: 413 })
  }

  const storeSlug = req.headers.get('x-store-slug')
  if (!storeSlug) {
    return new Response('Missing store context', { status: 400 })
  }

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, storeSlug),
    columns: {
      id: true,
      name: true,
      slug: true,
      description: true,
      settings: true,
      aiAdvisorSettings: true,
      onboardingCompleted: true,
    },
  })

  // The advisor is invisible unless the store opted in.
  if (
    !store ||
    !store.onboardingCompleted ||
    !store.aiAdvisorSettings?.enabled
  ) {
    return new Response('Not found', { status: 404 })
  }

  if (!isAIChatConfigured()) {
    return new Response('AI advisor is not configured', { status: 503 })
  }

  const body = advisorChatRequestSchema.safeParse(await req.json())
  if (!body.success) {
    return new Response('Invalid request body', { status: 400 })
  }

  const { messages: rawMessages, conversationId, cart } = body.data

  // A request is either a new user turn, or the automatic continuation sent
  // after a client-side tool (add_to_cart) resolved — its history then ends
  // with the assistant message carrying the tool result. Continuations must
  // reference an existing conversation: they never mint one.
  const lastMessage = rawMessages[rawMessages.length - 1]
  const isUserTurn = lastMessage?.role === 'user'
  const lastUserText = isUserTurn ? messageText(lastMessage) : null

  if (isUserTurn) {
    if (!lastUserText || lastUserText.length > AI_ADVISOR_MESSAGE_MAX_LENGTH) {
      return new Response('Invalid message', { status: 400 })
    }
  } else if (lastMessage?.role !== 'assistant' || !conversationId) {
    return new Response('Invalid message', { status: 400 })
  }

  // Strict UIMessage validation (tool parts included) happens here — the
  // system-boundary cast is guarded by the zod structural check above and
  // convertToModelMessages throwing on anything malformed.
  let modelMessages
  try {
    modelMessages = await convertToModelMessages(
      rawMessages.slice(-HISTORY_WINDOW) as unknown as UIMessage[],
    )
  } catch {
    return new Response('Invalid request body', { status: 400 })
  }

  const [plan, rateCheck] = await Promise.all([
    getStorePlan(store.id),
    checkAdvisorRateLimit({
      storeId: store.id,
      conversationId: conversationId ?? null,
      ip: getClientIp(req.headers),
    }),
  ])

  if (!plan.features.aiAdvisor) {
    return new Response('upgrade_required', { status: 403 })
  }

  if (!rateCheck.allowed) {
    return new Response(rateCheck.code, {
      status: 429,
      headers: {
        ...(rateCheck.retryAfter && {
          'Retry-After': String(rateCheck.retryAfter),
        }),
      },
    })
  }

  // AI credit gate (cloud commercial layer). Inert unless enabled; fail-closed.
  // Keyed on the store's credits (monthly-included allowance + prepaid balance).
  if (areAiCreditsEnabled()) {
    const creditCheck = await checkAdvisorCredits(store.id, plan)
    if (!creditCheck.allowed) {
      return new Response(creditCheck.code ?? 'credits_exhausted', {
        status: 402,
      })
    }
  }

  const [existingConversation, cartSummary, productGuidance, locale] =
    await Promise.all([
      conversationId
        ? db.query.aiAdvisorConversations.findFirst({
            where: and(
              eq(aiAdvisorConversations.id, conversationId),
              eq(aiAdvisorConversations.storeId, store.id),
            ),
            columns: { id: true },
          })
        : Promise.resolve(undefined),
      buildCartSummary(store.id, cart),
      buildProductGuidance(store.id),
      resolveLocale(req.headers.get('accept-language')),
    ])

  if (conversationId && !existingConversation) {
    return new Response('Conversation not found', { status: 404 })
  }

  // Resolve or create the conversation, then persist the user turn — one
  // transaction so a failure never leaves a conversation without its message.
  let activeConversationId = conversationId
  if (!activeConversationId) {
    const customerSession = await getCustomerSession(store.slug)
    activeConversationId = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(aiAdvisorConversations)
        .values({
          storeId: store.id,
          customerId: customerSession?.customerId ?? null,
          locale,
        })
        .$returningId()
      if (lastUserText) {
        await tx.insert(aiAdvisorMessages).values({
          conversationId: created.id,
          storeId: store.id,
          role: 'user',
          content: lastUserText,
        })
      }
      return created.id
    })
  } else if (isUserTurn && lastUserText) {
    await db.insert(aiAdvisorMessages).values({
      conversationId: activeConversationId,
      storeId: store.id,
      role: 'user',
      content: lastUserText,
    })
  }

  const advisorCtx: AdvisorChatContext = {
    storeId: store.id,
    storeSlug: store.slug,
    conversationId: activeConversationId,
    cart: cart ?? null,
  }

  const systemPrompt = buildAdvisorSystemPrompt({
    storeName: store.name,
    storeDescription: store.description,
    settings: store.aiAdvisorSettings,
    cartSummary,
    productGuidance,
    locale,
    currency: store.settings?.currency ?? 'EUR',
  })

  const result = streamText({
    model: getAdvisorAIModel(),
    system: systemPrompt,
    messages: modelMessages,
    tools: createAdvisorTools(advisorCtx),
    stopWhen: stepCountIs(8),
    onFinish: async ({ steps, totalUsage }) => {
      try {
        const allToolCalls = steps.flatMap((step) =>
          step.content.filter(
            (part): part is Extract<typeof part, { type: 'tool-call' }> =>
              'type' in part && part.type === 'tool-call',
          ),
        )
        // `text` alone would only be the LAST step's text — join every step
        // so nothing streamed to the customer is missing from the transcript.
        const content = steps
          .map((step) => step.text)
          .filter(Boolean)
          .join('\n\n')

        if (!content && allToolCalls.length === 0) return

        await db.transaction(async (tx) => {
          const [inserted] = await tx
            .insert(aiAdvisorMessages)
            .values({
              conversationId: activeConversationId,
              storeId: store.id,
              role: 'assistant',
              content,
              toolInvocations: allToolCalls.length > 0 ? allToolCalls : null,
            })
            .$returningId()
          await tx
            .update(aiAdvisorConversations)
            .set({ updatedAt: new Date() })
            .where(eq(aiAdvisorConversations.id, activeConversationId))

          // Meter this run's real token cost against the store's AI credits
          // (only when the credit layer is enabled). Same transaction as the
          // assistant-message insert, so accounting commits atomically.
          if (areAiCreditsEnabled() && inserted) {
            const usage = normalizeUsage(totalUsage ?? {})
            if (usage.inputTokens > 0 || usage.outputTokens > 0) {
              await recordAdvisorRunDebit(tx, {
                storeId: store.id,
                conversationId: activeConversationId,
                assistantMessageId: inserted.id,
                usage,
                plan,
              })
            }
          }
        })

        // Off the customer's critical path (stream already finished): recharge
        // the merchant's balance off-session if it dropped below their threshold.
        if (areAiCreditsEnabled()) {
          await maybeTriggerAutoTopup(store.id)
        }
      } catch (error) {
        log.error(
          'advisor',
          `failed to save assistant message: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    },
  })

  return result.toUIMessageStreamResponse({
    headers: {
      'X-Conversation-Id': activeConversationId,
    },
  })
}
