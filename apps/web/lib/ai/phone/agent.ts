import { generateText, stepCountIs } from 'ai'
import { eq } from 'drizzle-orm'

import { aiAdvisorConversations, aiAdvisorMessages, db } from '@louez/db'
import type { AiPhoneSettings } from '@louez/types'

import { normalizeUsage } from '@/lib/ai/pricing'
import { getPhoneAIModel } from '@/lib/ai/provider'
import { recordCallTurnDebit } from '@/lib/ai/phone/credits'
import { buildPhoneSystemPrompt } from '@/lib/ai/phone/system-prompt'
import { createPhoneTools } from '@/lib/ai/phone/tools'
import { log } from '@/lib/evlog'
import { areAiCreditsEnabled } from '@/lib/plans'
import type { Plan } from '@/lib/plans'

// Only the last turns stay in the model context; older turns live in the DB.
const HISTORY_WINDOW = 20
// Bound tool-calling depth per caller turn (availability lookups etc.).
const MAX_STEPS = 6

export type PhoneTurnControl = 'end' | 'transfer' | null

export interface PhoneTurnResult {
  /** The assistant's spoken reply for this turn. */
  text: string
  /** Whether the model asked to end the call or transfer to a human. */
  control: PhoneTurnControl
}

export interface PhoneTurnParams {
  store: {
    id: string
    name: string
    slug: string
    description: string | null
    currency: string
  }
  conversationId: string
  callerPhone: string
  settings: AiPhoneSettings
  /** Owner instructions reused from the AI advisor settings. */
  storeContext: string | null
  /** Per-product owner guidance (products.aiContext). */
  productGuidance: string | null
  plan: Plan
  /** Transcript of the caller's latest speech turn. */
  userSpeech: string
  today: string
}

/**
 * Run one turn of the phone receptionist: persist the caller's speech, call the
 * tool-using agent, persist the reply (metering tokens against AI credits when
 * enabled), and report whether the call should end or transfer.
 */
export async function runPhoneTurn(
  params: PhoneTurnParams,
): Promise<PhoneTurnResult> {
  const { store, conversationId, settings, plan, userSpeech } = params

  // Persist the caller turn first, so a failure never drops it from the record.
  await db.insert(aiAdvisorMessages).values({
    conversationId,
    storeId: store.id,
    role: 'user',
    content: userSpeech,
  })

  // Load the recent history (chronological), current turn included.
  const rows = await db.query.aiAdvisorMessages.findMany({
    where: eq(aiAdvisorMessages.conversationId, conversationId),
    columns: { role: true, content: true },
    orderBy: (message, { desc }) => [desc(message.createdAt)],
    limit: HISTORY_WINDOW,
  })
  const messages = rows
    .reverse()
    .filter(
      (row): row is { role: 'user' | 'assistant'; content: string } =>
        (row.role === 'user' || row.role === 'assistant') &&
        typeof row.content === 'string' &&
        row.content.length > 0,
    )
    .map((row) => ({ role: row.role, content: row.content }))

  // The opening greeting is persisted as an assistant turn, so the history can
  // start with 'assistant'. Anthropic (and others) require the first message to
  // be 'user' — drop any leading assistant turns from the model input.
  while (messages.length > 0 && messages[0].role === 'assistant') {
    messages.shift()
  }

  const systemPrompt = buildPhoneSystemPrompt({
    storeName: store.name,
    storeDescription: store.description,
    language: settings.language,
    currency: store.currency,
    canTakeReservations: settings.canTakeReservations,
    storeContext: params.storeContext,
    productGuidance: params.productGuidance,
    today: params.today,
  })

  const result = await generateText({
    model: getPhoneAIModel(),
    system: systemPrompt,
    messages,
    tools: createPhoneTools({
      storeId: store.id,
      storeSlug: store.slug,
      storeName: store.name,
      conversationId,
      callerPhone: params.callerPhone,
      language: settings.language,
      canTakeReservations: settings.canTakeReservations,
      transferNumber: settings.transferNumber?.trim() || null,
    }),
    stopWhen: stepCountIs(MAX_STEPS),
  })

  const allToolCalls = result.steps.flatMap((step) =>
    step.content.filter(
      (part): part is Extract<typeof part, { type: 'tool-call' }> =>
        'type' in part && part.type === 'tool-call',
    ),
  )
  const calledTool = (name: string) =>
    allToolCalls.some((call) => call.toolName === name)

  const control: PhoneTurnControl = calledTool('transfer_to_human')
    ? 'transfer'
    : calledTool('end_call')
      ? 'end'
      : null

  const text = result.steps
    .map((step) => step.text)
    .filter(Boolean)
    .join(' ')
    .trim()

  // Persist the assistant turn and meter its tokens atomically.
  try {
    await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(aiAdvisorMessages)
        .values({
          conversationId,
          storeId: store.id,
          role: 'assistant',
          content: text || null,
          toolInvocations: allToolCalls.length > 0 ? allToolCalls : null,
        })
        .$returningId()
      await tx
        .update(aiAdvisorConversations)
        .set({ updatedAt: new Date() })
        .where(eq(aiAdvisorConversations.id, conversationId))

      if (areAiCreditsEnabled() && inserted) {
        const usage = normalizeUsage(result.totalUsage ?? result.usage ?? {})
        if (usage.inputTokens > 0 || usage.outputTokens > 0) {
          await recordCallTurnDebit(tx, {
            storeId: store.id,
            conversationId,
            assistantMessageId: inserted.id,
            usage,
            plan,
          })
        }
      }
    })
  } catch (error) {
    log.error(
      'phone',
      `failed to persist phone turn: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  return { text, control }
}
