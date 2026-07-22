'use server'

import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'

import { db, storePhoneNumbers, stores } from '@louez/db'
import type { AiPhoneSettings } from '@louez/types'
import {
  aiPhoneSettingsSchema,
  isPossibleE164PhoneNumber,
  type AiPhoneSettingsInput,
} from '@louez/validations'

import { env } from '@/env'
import { getStorePlan } from '@/lib/plan-limits'
import { getCurrentStore } from '@/lib/store-context'

export type UpdateAiPhoneInput = AiPhoneSettingsInput & {
  /** Inbound number bound to this store (E.164), or '' to unbind. */
  phoneNumber?: string
}

/**
 * Persist the phone receptionist settings AND the store's inbound-number
 * binding in one action. The number lives in its own table (globally unique),
 * so binding validates E.164 and rejects a number already used by another store.
 */
export async function updateAiPhoneSettings(data: UpdateAiPhoneInput) {
  const store = await getCurrentStore()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  const plan = await getStorePlan(store.id)
  if (!plan.features.aiPhone) {
    return { error: 'errors.featureNotAvailable' }
  }

  const { phoneNumber, ...settingsInput } = data
  const validated = aiPhoneSettingsSchema.safeParse(settingsInput)
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

  // Bind / rebind / release the inbound number.
  const trimmedNumber = (phoneNumber ?? '').trim()
  if (trimmedNumber) {
    if (!isPossibleE164PhoneNumber(trimmedNumber)) {
      return { error: 'errors.invalidPhoneNumber' }
    }
    const numberOwner = await db.query.storePhoneNumbers.findFirst({
      where: eq(storePhoneNumbers.e164, trimmedNumber),
      columns: { id: true, storeId: true },
    })
    if (numberOwner && numberOwner.storeId !== store.id) {
      return { error: 'errors.phoneNumberInUse' }
    }

    const mine = await db.query.storePhoneNumbers.findFirst({
      where: and(
        eq(storePhoneNumbers.storeId, store.id),
        eq(storePhoneNumbers.status, 'active'),
      ),
      columns: { id: true, e164: true },
    })
    const provider = env.VOICE_PROVIDER ?? 'twilio'

    if (numberOwner) {
      // Already this store's number — just ensure it's active.
      await db
        .update(storePhoneNumbers)
        .set({ status: 'active', updatedAt: new Date() })
        .where(eq(storePhoneNumbers.id, numberOwner.id))
    } else if (mine) {
      // Switch the store's active number to the new value.
      await db
        .update(storePhoneNumbers)
        .set({ e164: trimmedNumber, status: 'active', updatedAt: new Date() })
        .where(eq(storePhoneNumbers.id, mine.id))
    } else {
      await db.insert(storePhoneNumbers).values({
        storeId: store.id,
        e164: trimmedNumber,
        provider,
        status: 'active',
      })
    }
  } else {
    // Empty input releases the store's active binding (inbound stops resolving).
    await db
      .update(storePhoneNumbers)
      .set({ status: 'released', updatedAt: new Date() })
      .where(
        and(
          eq(storePhoneNumbers.storeId, store.id),
          eq(storePhoneNumbers.status, 'active'),
        ),
      )
  }

  await db
    .update(stores)
    .set({ aiPhoneSettings, updatedAt: new Date() })
    .where(eq(stores.id, store.id))

  revalidatePath('/dashboard/settings/ai-advisor')
  return { success: true }
}
