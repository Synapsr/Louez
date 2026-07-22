import { generateText, stepCountIs, streamText } from 'ai'
import { eq } from 'drizzle-orm'

import { aiAdvisorConversations, aiAdvisorMessages, db } from '@louez/db'
import type { AiPhoneSettings, BusinessHours } from '@louez/types'

import { normalizeUsage, type AdvisorUsage } from '@/lib/ai/pricing'
import { getPhoneAIModel } from '@/lib/ai/provider'
import { buildStoreCatalog } from '@/lib/ai/product-guidance'
import { recordCallTurnDebit } from '@/lib/ai/phone/credits'
import { buildPhoneSystemPrompt } from '@/lib/ai/phone/system-prompt'
import { createPhoneTools } from '@/lib/ai/phone/tools'
import { log } from '@/lib/evlog'
import { areAiCreditsEnabled } from '@/lib/plans'
import type { Plan } from '@/lib/plans'

// Only the last turns stay in the model context; older turns live in the DB.
// Phone turns are short, so keep a wider window than the text advisor to avoid
// the model forgetting a choice made earlier in the call.
const HISTORY_WINDOW = 30
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
    email: string | null
    phone: string | null
    address: string | null
    businessHours: BusinessHours | null
    timezone: string | null
    deliveryEnabled: boolean | null
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

const ZERO_USAGE: AdvisorUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
}

type ToolCallPart = { type: 'tool-call'; toolName: string }

/**
 * Persist the caller's speech and build the model inputs (history + system
 * prompt + tools). Shared by the turn-based (generateText) and streaming
 * (streamText) paths so both behave identically.
 */
async function preparePhoneTurn(params: PhoneTurnParams): Promise<{
  system: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  tools: ReturnType<typeof createPhoneTools>
}> {
  const { store, conversationId, settings, userSpeech } = params

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

  // Ground the model in what is static (catalog) and what it already gathered
  // (collected facts), so it never has to re-fetch mid-call and stays consistent.
  const [catalog, conversation] = await Promise.all([
    buildStoreCatalog(store.id),
    db.query.aiAdvisorConversations.findFirst({
      where: eq(aiAdvisorConversations.id, conversationId),
      columns: { collectedData: true },
    }),
  ])

  const system = buildPhoneSystemPrompt({
    storeName: store.name,
    storeDescription: store.description,
    language: settings.language,
    currency: store.currency,
    canTakeReservations: settings.canTakeReservations,
    storeEmail: store.email,
    storePhone: store.phone,
    storeAddress: store.address,
    businessHours: store.businessHours,
    timezone: store.timezone,
    deliveryEnabled: store.deliveryEnabled,
    catalog,
    collectedFacts: conversation?.collectedData ?? null,
    storeContext: params.storeContext,
    productGuidance: params.productGuidance,
    today: params.today,
  })

  const tools = createPhoneTools({
    storeId: store.id,
    storeSlug: store.slug,
    storeName: store.name,
    conversationId,
    callerPhone: params.callerPhone,
    language: settings.language,
    canTakeReservations: settings.canTakeReservations,
    transferNumber: settings.transferNumber?.trim() || null,
  })

  return { system, messages, tools }
}

/** Tool calls the model made this turn, and the control intent they signal. */
function controlFromSteps(steps: readonly { content: readonly unknown[] }[]): {
  control: PhoneTurnControl
  toolCalls: ToolCallPart[]
} {
  const toolCalls = steps.flatMap((step) =>
    step.content.filter(
      (part): part is ToolCallPart =>
        typeof part === 'object' &&
        part !== null &&
        (part as { type?: unknown }).type === 'tool-call',
    ),
  )
  const called = (name: string) => toolCalls.some((c) => c.toolName === name)
  const control: PhoneTurnControl = called('transfer_to_human')
    ? 'transfer'
    : called('end_call')
      ? 'end'
      : null
  return { control, toolCalls }
}

/**
 * Persist the assistant turn and meter its tokens atomically (transcript +
 * accounting commit together). Never throws — a metering/DB failure must not
 * break the live call.
 */
async function persistAssistantTurn(params: {
  store: PhoneTurnParams['store']
  conversationId: string
  plan: Plan
  text: string
  toolCalls: ToolCallPart[]
  usage: AdvisorUsage
}): Promise<void> {
  const { store, conversationId, plan, text, toolCalls, usage } = params

  // Persist the assistant message FIRST, on its own. The transcript and the
  // model's memory of its own reply must NEVER be lost to a metering failure —
  // bundling them made a debit error roll back the whole turn, so the model
  // stopped seeing its replies and re-greeted the caller.
  let assistantMessageId: string | null = null
  try {
    const [inserted] = await db
      .insert(aiAdvisorMessages)
      .values({
        conversationId,
        storeId: store.id,
        role: 'assistant',
        content: text || null,
        toolInvocations: toolCalls.length > 0 ? toolCalls : null,
      })
      .$returningId()
    assistantMessageId = inserted?.id ?? null
    await db
      .update(aiAdvisorConversations)
      .set({ updatedAt: new Date() })
      .where(eq(aiAdvisorConversations.id, conversationId))
  } catch (error) {
    log.error(
      'phone',
      `failed to persist assistant turn: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return
  }

  // Meter this turn's tokens best-effort, in a SEPARATE transaction: a metering
  // failure logs but must never roll back the transcript above.
  if (
    areAiCreditsEnabled() &&
    assistantMessageId &&
    (usage.inputTokens > 0 || usage.outputTokens > 0)
  ) {
    const id = assistantMessageId
    try {
      await db.transaction((tx) =>
        recordCallTurnDebit(tx, {
          storeId: store.id,
          conversationId,
          assistantMessageId: id,
          usage,
          plan,
        }),
      )
    } catch (error) {
      log.error(
        'phone',
        `failed to meter phone turn: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
}

/**
 * Run one turn of the phone receptionist (turn-based <Gather> transport):
 * persist the caller's speech, call the tool-using agent, persist the reply
 * (metering tokens), and report whether the call should end or transfer.
 */
export async function runPhoneTurn(
  params: PhoneTurnParams,
): Promise<PhoneTurnResult> {
  const { store, conversationId, plan } = params
  const { system, messages, tools } = await preparePhoneTurn(params)

  const result = await generateText({
    model: getPhoneAIModel(),
    system,
    messages,
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
  })

  const { control, toolCalls } = controlFromSteps(result.steps)
  const text = result.steps
    .map((step) => step.text)
    .filter(Boolean)
    .join(' ')
    .trim()

  await persistAssistantTurn({
    store,
    conversationId,
    plan,
    text,
    toolCalls,
    usage: normalizeUsage(result.totalUsage ?? result.usage ?? {}),
  })

  return { text, control }
}

export interface PhoneStreamResult {
  /** Assistant reply text, streamed token-by-token for the ConversationRelay TTS. */
  textStream: AsyncIterable<string>
  /**
   * Call after consuming (or aborting) the stream: persist the assistant turn +
   * meter tokens, and resolve the control intent. Safe to call once; never
   * throws. On barge-in `spokenText` is what was STREAMED, which may slightly
   * exceed what the caller actually heard before interrupting.
   */
  finalize: (spokenText: string) => Promise<{ control: PhoneTurnControl }>
}

/**
 * Streaming variant of runPhoneTurn for the ConversationRelay transport: the
 * reply text streams out token-by-token so the provider's TTS speaks the first
 * words while the model is still generating. `abortSignal` fires on barge-in
 * (the caller talked over the reply) — finalize then persists only what was
 * actually spoken.
 */
export async function streamPhoneTurn(
  params: PhoneTurnParams,
  abortSignal: AbortSignal,
): Promise<PhoneStreamResult> {
  const { store, conversationId, plan } = params
  const { system, messages, tools } = await preparePhoneTurn(params)

  const result = streamText({
    model: getPhoneAIModel(),
    system,
    messages,
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
    abortSignal,
  })

  const finalize = async (
    spokenText: string,
  ): Promise<{ control: PhoneTurnControl }> => {
    // On barge-in the promises below reject/resolve partially — best-effort.
    let control: PhoneTurnControl = null
    let toolCalls: ToolCallPart[] = []
    let usage: AdvisorUsage = ZERO_USAGE
    try {
      const resolved = controlFromSteps(await result.steps)
      control = resolved.control
      toolCalls = resolved.toolCalls
    } catch {
      // interrupted before the step data settled → treat as a normal continue.
    }
    try {
      const total = normalizeUsage((await result.totalUsage) ?? {})
      // A mid-turn barge-in resolves the aggregate to a null-usage object; fall
      // back to the last completed step's usage so multi-step turns still bill.
      usage =
        total.inputTokens > 0 || total.outputTokens > 0
          ? total
          : normalizeUsage((await result.usage) ?? {})
    } catch {
      // aborted before any step settled → audio metering still covers the call.
    }

    const text = spokenText.trim()
    if (text.length > 0 || toolCalls.length > 0) {
      await persistAssistantTurn({
        store,
        conversationId,
        plan,
        text,
        toolCalls,
        usage,
      })
    }
    return { control }
  }

  return { textStream: result.textStream, finalize }
}
