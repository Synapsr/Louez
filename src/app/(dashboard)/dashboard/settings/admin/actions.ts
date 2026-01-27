'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/lib/db'
import { stores } from '@/lib/db/schema'
import { getCurrentStore } from '@/lib/store-context'
import { isCurrentUserPlatformAdmin } from '@/lib/platform-admin'

const trialDaysSchema = z.object({
  trialDays: z.number().int().min(0).max(365),
})

type TrialDaysInput = z.infer<typeof trialDaysSchema>

export async function updateTrialDays(data: TrialDaysInput) {
  const store = await getCurrentStore()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  const isAdmin = await isCurrentUserPlatformAdmin()
  if (!isAdmin) {
    return { error: 'errors.unauthorized' }
  }

  const validated = trialDaysSchema.safeParse(data)
  if (!validated.success) {
    return { error: 'errors.invalidData' }
  }

  await db
    .update(stores)
    .set({
      trialDays: validated.data.trialDays,
      updatedAt: new Date(),
    })
    .where(eq(stores.id, store.id))

  revalidatePath('/dashboard/settings/admin')
  return { success: true }
}
