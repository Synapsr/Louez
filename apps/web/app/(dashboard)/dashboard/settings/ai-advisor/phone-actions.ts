'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'

import { db, stores } from '@louez/db'
import type { AiPhoneSettings } from '@louez/types'
import {
  aiPhoneSettingsSchema,
  type AiPhoneSettingsInput,
} from '@louez/validations'

import { getStorePlan } from '@/lib/plan-limits'
import { getCurrentStore } from '@/lib/store-context'

/**
 * Persist the AI voice agent's behavior settings. The inbound-number binding
 * (provision / link / release) is managed separately — see
 * voice-provisioning-actions.ts.
 */
export async function updateAiPhoneSettings(data: AiPhoneSettingsInput) {
  const store = await getCurrentStore()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  const plan = await getStorePlan(store.id)
  if (!plan.features.aiPhone) {
    return { error: 'errors.featureNotAvailable' }
  }

  const validated = aiPhoneSettingsSchema.safeParse(data)
  if (!validated.success) {
    return { error: 'errors.invalidData' }
  }

  const aiPhoneSettings: AiPhoneSettings = {
    enabled: validated.data.enabled,
    language: validated.data.language,
    canTakeReservations: validated.data.canTakeReservations,
    answerMode: validated.data.answerMode,
    greeting: validated.data.greeting || undefined,
    transferNumber: validated.data.transferNumber || undefined,
    voice: validated.data.voice || undefined,
    recordCalls: validated.data.recordCalls,
  }

  await db
    .update(stores)
    .set({ aiPhoneSettings, updatedAt: new Date() })
    .where(eq(stores.id, store.id))

  revalidatePath('/dashboard/settings/ai-advisor')
  return { success: true }
}
