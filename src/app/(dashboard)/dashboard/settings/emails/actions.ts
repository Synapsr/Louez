'use server'

import { db } from '@/lib/db'
import { getCurrentStore } from '@/lib/store-context'
import { stores } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import type { EmailSettings } from '@/types/store'

export async function getEmailSettings(): Promise<{
  settings?: EmailSettings
  error?: string
}> {
  try {
    const store = await getCurrentStore()

    if (!store) {
      return { error: 'errors.storeNotFound' }
    }

    // Return email settings with defaults
    const defaultSettings: EmailSettings = {
      confirmationEnabled: true,
      reminderPickupEnabled: true,
      reminderReturnEnabled: true,
      replyToEmail: null,
      defaultSignature: '',
      confirmationContent: {},
      rejectionContent: {},
      pickupReminderContent: {},
      returnReminderContent: {},
      requestAcceptedContent: {},
    }

    return {
      settings: {
        ...defaultSettings,
        ...store.emailSettings,
      },
    }
  } catch (error) {
    console.error('Error getting email settings:', error)
    return { error: 'errors.fetchEmailSettingsError' }
  }
}

export async function updateEmailSettings(settings: EmailSettings): Promise<{
  success?: boolean
  error?: string
}> {
  try {
    const store = await getCurrentStore()

    if (!store) {
      return { error: 'errors.storeNotFound' }
    }

    await db
      .update(stores)
      .set({
        emailSettings: {
          ...store.emailSettings,
          ...settings,
        },
        updatedAt: new Date(),
      })
      .where(eq(stores.id, store.id))

    revalidatePath('/dashboard/settings/emails')
    revalidatePath('/dashboard/settings')

    return { success: true }
  } catch (error) {
    console.error('Error updating email settings:', error)
    return { error: 'errors.updateEmailSettingsError' }
  }
}
