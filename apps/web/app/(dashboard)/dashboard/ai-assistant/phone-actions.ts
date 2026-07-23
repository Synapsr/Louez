'use server'

import { revalidatePath } from 'next/cache'
import { and, eq, inArray } from 'drizzle-orm'

import { db, storePhoneNumbers, stores } from '@louez/db'
import type { AiPhoneSettings } from '@louez/types'
import {
  aiPhoneSettingsSchema,
  type AiPhoneSettingsInput,
} from '@louez/validations'

import { releaseNumberBinding } from '@/lib/ai/phone/number-release'
import { log } from '@/lib/evlog'
import { getStorePlan } from '@/lib/plan-limits'
import { getCurrentStore } from '@/lib/store-context'

/**
 * Persist the AI voice agent's behavior settings. The inbound-number binding
 * (provision / link / release) is managed separately — see
 * voice-provisioning-actions.ts — EXCEPT that turning the agent OFF also
 * releases the bound number (the UI warns first): a provisioned number keeps
 * costing rental money, so it is never left attached to a disabled agent.
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

  // Turning the agent off detaches the number (provisioned ones are handed
  // back to the provider). Best-effort: a provider hiccup must not block the
  // settings save — the failure is surfaced as a warning so the owner knows
  // the number is still attached (the renewal job also retries the cleanup).
  let warning: string | undefined
  if (!aiPhoneSettings.enabled) {
    const binding = await db.query.storePhoneNumbers.findFirst({
      where: and(
        eq(storePhoneNumbers.storeId, store.id),
        inArray(storePhoneNumbers.status, ['active', 'pending']),
      ),
      columns: { id: true, providerNumberId: true },
    })
    if (binding) {
      const released = await releaseNumberBinding(binding)
      if (!released.ok) {
        warning = 'numberReleaseFailed'
        log.error(
          'phone',
          `release-on-disable failed for store ${store.id} (number kept, cron will retry)`,
        )
      }
    }
  }

  revalidatePath('/dashboard/ai-assistant')
  return { success: true, warning }
}
