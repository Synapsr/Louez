import { z } from 'zod'
import type { AiAdvisorSettings } from '@louez/types'

export const AI_ADVISOR_STORE_CONTEXT_MAX_LENGTH = 4000
export const AI_ADVISOR_PRODUCT_CONTEXT_MAX_LENGTH = 2000
export const AI_ADVISOR_MESSAGE_MAX_LENGTH = 2000

export const aiAdvisorModeSchema = z.enum([
  'optional',
  'recommended',
  'required',
])

export const aiAdvisorSettingsSchema = z.object({
  enabled: z.boolean(),
  mode: aiAdvisorModeSchema,
  storeContext: z.string().max(AI_ADVISOR_STORE_CONTEXT_MAX_LENGTH),
  welcomeMessage: z.string().max(500).optional(),
  displayName: z.string().max(60).optional(),
})

export type AiAdvisorSettingsInput = z.infer<typeof aiAdvisorSettingsSchema>

// Default settings when enabling the AI advisor
export const defaultAiAdvisorSettings: AiAdvisorSettings = {
  enabled: false,
  mode: 'optional',
  storeContext: '',
}

// Cart snapshot sent by the storefront widget with each chat request so the
// advisor is aware of what the customer is about to rent.
export const advisorCartSnapshotSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().length(21),
        quantity: z.number().int().min(1).max(999),
      }),
    )
    .max(50),
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).optional(),
})

export type AdvisorCartSnapshot = z.infer<typeof advisorCartSnapshotSchema>

// ============================================================================
// oRPC input/output schemas
// ============================================================================

export const advisorConversationsListInputSchema = z.object({
  filter: z.enum(['all', 'converted', 'not_converted']).optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(50).optional(),
})

export const advisorConversationGetInputSchema = z.object({
  conversationId: z.string().length(21),
})

export const advisorConversationByReservationInputSchema = z.object({
  reservationId: z.string().length(21),
})

export const advisorConversationStatusInputSchema = z.object({
  conversationId: z.string().length(21),
})

const advisorConversationListItemSchema = z.object({
  id: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  customerId: z.string().nullable(),
  customerName: z.string().nullable(),
  reservationId: z.string().nullable(),
  reservationNumber: z.string().nullable(),
  validatedAt: z.date().nullable(),
  locale: z.string().nullable(),
  messageCount: z.number(),
  firstUserMessage: z.string().nullable(),
})

export const advisorConversationsListOutputSchema = z.object({
  conversations: z.array(advisorConversationListItemSchema),
  totalCount: z.number(),
  page: z.number(),
  pageSize: z.number(),
})

export const advisorConversationTranscriptSchema = z.object({
  id: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  customerId: z.string().nullable(),
  customerName: z.string().nullable(),
  reservationId: z.string().nullable(),
  reservationNumber: z.string().nullable(),
  validatedAt: z.date().nullable(),
  collectedData: z.record(z.string(), z.string()).nullable(),
  locale: z.string().nullable(),
  messages: z.array(
    z.object({
      id: z.string(),
      role: z.enum(['user', 'assistant']),
      content: z.string(),
      createdAt: z.date(),
    }),
  ),
})

export const advisorValidatedCartSchema = z.object({
  items: z.array(
    z.object({ productId: z.string(), quantity: z.number().int().min(1) }),
  ),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
})

export const advisorConversationStatusOutputSchema = z.object({
  validated: z.boolean(),
  validatedCart: advisorValidatedCartSchema.nullable(),
})

export const advisorConversationMessagesInputSchema = z.object({
  conversationId: z.string().length(21),
})

export const advisorConversationMessagesOutputSchema = z.object({
  messages: z.array(
    z.object({
      id: z.string(),
      role: z.enum(['user', 'assistant']),
      content: z.string(),
    }),
  ),
})

export type AdvisorConversationsListInput = z.infer<
  typeof advisorConversationsListInputSchema
>
export type AdvisorConversationsListOutput = z.infer<
  typeof advisorConversationsListOutputSchema
>
export type AdvisorConversationTranscript = z.infer<
  typeof advisorConversationTranscriptSchema
>
