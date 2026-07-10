'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'

import { db } from '@louez/db'
import { stores } from '@louez/db'
import { getCurrentStore } from '@/lib/store-context'
import { getStorePlan } from '@/lib/plan-limits'
import {
  aiAdvisorSettingsSchema,
  type AiAdvisorSettingsInput,
} from '@louez/validations'
import type { AiAdvisorSettings } from '@louez/types'

export async function updateAiAdvisorSettings(data: AiAdvisorSettingsInput) {
  const store = await getCurrentStore()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  // Check plan access
  const plan = await getStorePlan(store.id)
  if (!plan.features.aiAdvisor) {
    return { error: 'errors.featureNotAvailable' }
  }

  const validated = aiAdvisorSettingsSchema.safeParse(data)
  if (!validated.success) {
    return { error: 'errors.invalidData' }
  }

  const aiAdvisorSettings: AiAdvisorSettings = {
    enabled: validated.data.enabled,
    mode: validated.data.mode,
    storeContext: validated.data.storeContext,
    welcomeMessage: validated.data.welcomeMessage || undefined,
    displayName: validated.data.displayName || undefined,
  }

  await db
    .update(stores)
    .set({
      aiAdvisorSettings,
      updatedAt: new Date(),
    })
    .where(eq(stores.id, store.id))

  revalidatePath('/dashboard/settings/ai-advisor')
  revalidatePath(`/${store.slug}`) // Revalidate storefront
  return { success: true }
}
