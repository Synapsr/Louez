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
