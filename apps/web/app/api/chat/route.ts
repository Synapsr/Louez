import { stepCountIs, streamText } from 'ai'
import { db, aiChats, aiChatMessages } from '@louez/db'
import type { ApiKeyPermissions } from '@louez/db/schema'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { auth } from '@/lib/auth'
import { getCurrentStore } from '@/lib/store-context'

import { getAIModel, isAIChatConfigured } from '@/lib/ai/provider'
import { checkRateLimit, validateMessageLength } from '@/lib/ai/rate-limit'
import { buildSystemPrompt } from '@/lib/ai/system-prompt'
import { createAITools } from '@/lib/ai/tools'
import type { AIChatContext } from '@/lib/ai/tools'

const chatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.string(),
        content: z.string().optional(),
        parts: z
          .array(z.object({ type: z.string(), text: z.string().optional() }).passthrough())
          .optional(),
      }),
    )
    .min(1),
  chatId: z.string().max(30).optional(),
})

// Map dashboard member role to full AI permissions
function roleToPermissions(role: string): ApiKeyPermissions {
  if (role === 'owner' || role === 'platform_admin') {
    return {
      reservations: 'write',
      products: 'write',
      customers: 'write',
      categories: 'write',
      payments: 'write',
      analytics: 'read',
      settings: 'write',
    }
  }
  // member role: read + write on core, read on settings
  return {
    reservations: 'write',
    products: 'write',
    customers: 'write',
    categories: 'write',
    payments: 'write',
    analytics: 'read',
    settings: 'read',
  }
}

export async function POST(req: Request) {
  // Auth check
  const session = await auth()
  if (!session?.user?.id) {
    return new Response('Unauthorized', { status: 401 })
  }

  // AI config check
  if (!isAIChatConfigured()) {
    return new Response('AI chat is not configured', { status: 503 })
  }

  // Store context
  const store = await getCurrentStore()
  if (!store) {
    return new Response('No store found', { status: 403 })
  }

  const body = chatRequestSchema.safeParse(await req.json())
  if (!body.success) {
    return new Response('Invalid request body', { status: 400 })
  }

  const { messages: rawMessages, chatId } = body.data

  // Normalize UIMessage parts to plain content strings
  const messages = rawMessages.map((m) => ({
    role: m.role as 'user' | 'assistant' | 'system',
    content:
      m.content ??
      m.parts
        ?.filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('\n') ??
      '',
  }))

  // Rate limiting (plan-based)
  const rateCheck = await checkRateLimit(session.user.id, store.id)
  if (!rateCheck.allowed) {
    const status = rateCheck.code === 'upgrade_required' ? 403 : 429
    return new Response(rateCheck.code, {
      status,
      headers: {
        ...(rateCheck.retryAfter && { 'Retry-After': String(rateCheck.retryAfter) }),
      },
    })
  }

  // Validate message length
  const lastMsg = messages[messages.length - 1]
  if (lastMsg?.role === 'user') {
    const lengthCheck = validateMessageLength(lastMsg.content)
    if (!lengthCheck.allowed) {
      return new Response(lengthCheck.code, { status: 400 })
    }
  }

  // Resolve or create chat for conversation logging
  let activeChatId = chatId
  if (!activeChatId) {
    // Create a new chat
    const firstMessage = messages[0]?.content ?? ''
    const title = firstMessage.slice(0, 100) || 'New conversation'

    const [created] = await db
      .insert(aiChats)
      .values({
        storeId: store.id,
        userId: session.user.id,
        title,
      })
      .$returningId()

    activeChatId = created.id
  } else {
    // Verify the chat belongs to this user/store
    const existing = await db.query.aiChats.findFirst({
      where: and(
        eq(aiChats.id, activeChatId),
        eq(aiChats.storeId, store.id),
        eq(aiChats.userId, session.user.id),
      ),
      columns: { id: true },
    })
    if (!existing) {
      return new Response('Chat not found', { status: 404 })
    }
  }

  // Save the user message
  const lastUserMessage = messages[messages.length - 1]
  if (lastUserMessage?.role === 'user') {
    await db.insert(aiChatMessages).values({
      chatId: activeChatId,
      role: 'user',
      content: lastUserMessage.content,
    })
  }

  // Build AI context
  const aiCtx: AIChatContext = {
    storeId: store.id,
    storeName: store.name,
    permissions: roleToPermissions(store.role),
  }

  const tools = createAITools(aiCtx)
  const locale = 'fr' // TODO: derive from user preferences
  const systemPrompt = buildSystemPrompt(aiCtx, locale)

  // Stream the response
  const result = streamText({
    model: getAIModel(),
    system: systemPrompt,
    messages,
    tools,
    stopWhen: stepCountIs(10),
    onFinish: async ({ text, steps }) => {
      if (!activeChatId) return

      try {
        // Collect all tool calls from all steps
        const allToolCalls = steps.flatMap((step) =>
          step.content.filter(
            (part): part is Extract<typeof part, { type: 'tool-call' }> =>
              'type' in part && part.type === 'tool-call',
          ),
        )

        // Save the assistant message
        await db.insert(aiChatMessages).values({
          chatId: activeChatId,
          role: 'assistant',
          content: text,
          toolInvocations: allToolCalls.length > 0 ? allToolCalls : null,
        })

        // Update the chat's updatedAt
        await db
          .update(aiChats)
          .set({ updatedAt: new Date() })
          .where(eq(aiChats.id, activeChatId))
      } catch (error) {
        console.error('[AI Chat] Failed to save assistant message:', error)
      }
    },
  })

  return result.toUIMessageStreamResponse({
    headers: {
      'X-Chat-Id': activeChatId,
    },
  })
}
