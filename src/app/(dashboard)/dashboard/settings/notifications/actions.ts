'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { stores } from '@/lib/db/schema'
import { getCurrentStore } from '@/lib/store-context'
import { validateDiscordWebhook, sendTestDiscordNotification } from '@/lib/discord/client'
import {
  updateSinglePreferenceSchema,
  discordWebhookSchema,
  ownerPhoneSchema,
} from '@/lib/validations/notifications'
import { getSmsQuotaStatus } from '@/lib/plan-limits'
import { validateAndNormalizePhone } from '@/lib/sms/phone'
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationSettings,
  type NotificationEventType,
} from '@/types/store'

export async function getNotificationSettings() {
  const store = await getCurrentStore()
  if (!store) return { error: 'errors.unauthorized' }

  const smsQuota = await getSmsQuotaStatus(store.id)

  return {
    settings: store.notificationSettings || DEFAULT_NOTIFICATION_SETTINGS,
    discordWebhookUrl: store.discordWebhookUrl,
    ownerPhone: store.ownerPhone,
    smsQuota: {
      current: smsQuota.current,
      limit: smsQuota.planLimit,
      prepaidBalance: smsQuota.prepaidBalance,
      allowed: smsQuota.allowed,
      totalAvailable: smsQuota.totalAvailable,
    },
  }
}

export async function updateSinglePreference(data: {
  eventType: string
  channel: 'email' | 'sms' | 'discord'
  enabled: boolean
}) {
  const store = await getCurrentStore()
  if (!store) return { error: 'errors.unauthorized' }

  const validated = updateSinglePreferenceSchema.safeParse(data)
  if (!validated.success) return { error: 'errors.invalidData' }

  const { eventType, channel, enabled } = validated.data

  // Get current settings or default
  const currentSettings: NotificationSettings =
    store.notificationSettings || DEFAULT_NOTIFICATION_SETTINGS

  // Update the specific preference
  const updatedSettings: NotificationSettings = {
    ...currentSettings,
    [eventType as NotificationEventType]: {
      ...currentSettings[eventType as NotificationEventType],
      [channel]: enabled,
    },
  }

  await db
    .update(stores)
    .set({
      notificationSettings: updatedSettings,
      updatedAt: new Date(),
    })
    .where(eq(stores.id, store.id))

  revalidatePath('/dashboard/settings/notifications')
  return { success: true }
}

export async function updateDiscordWebhook(webhookUrl: string | null) {
  const store = await getCurrentStore()
  if (!store) return { error: 'errors.unauthorized' }

  // Allow null/empty to disconnect
  if (!webhookUrl || webhookUrl.trim() === '') {
    await db
      .update(stores)
      .set({
        discordWebhookUrl: null,
        updatedAt: new Date(),
      })
      .where(eq(stores.id, store.id))

    revalidatePath('/dashboard/settings/notifications')
    return { success: true }
  }

  // Validate format
  const validated = discordWebhookSchema.safeParse({ webhookUrl })
  if (!validated.success) {
    return { error: 'errors.invalidWebhookUrl' }
  }

  // Validate webhook is actually reachable
  const isValid = await validateDiscordWebhook(webhookUrl)
  if (!isValid) {
    return { error: 'errors.discordWebhookInvalid' }
  }

  await db
    .update(stores)
    .set({
      discordWebhookUrl: webhookUrl,
      updatedAt: new Date(),
    })
    .where(eq(stores.id, store.id))

  revalidatePath('/dashboard/settings/notifications')
  return { success: true }
}

export async function testDiscordWebhook() {
  const store = await getCurrentStore()
  if (!store) return { error: 'errors.unauthorized' }
  if (!store.discordWebhookUrl) return { error: 'errors.noDiscordWebhook' }

  const result = await sendTestDiscordNotification(store.discordWebhookUrl, store.name)

  if (!result.success) {
    return { error: result.error || 'errors.discordTestFailed' }
  }

  return { success: true }
}

export async function updateOwnerPhone(phone: string | null) {
  const store = await getCurrentStore()
  if (!store) return { error: 'errors.unauthorized' }

  // Allow null/empty to remove
  if (!phone || phone.trim() === '') {
    await db
      .update(stores)
      .set({
        ownerPhone: null,
        updatedAt: new Date(),
      })
      .where(eq(stores.id, store.id))

    revalidatePath('/dashboard/settings/notifications')
    return { success: true, phone: null }
  }

  // Validate and normalize to E.164 format
  const phoneResult = validateAndNormalizePhone(phone)
  if (!phoneResult.valid || !phoneResult.normalized) {
    return { error: 'errors.invalidPhoneNumber' }
  }

  const normalizedPhone = phoneResult.normalized

  await db
    .update(stores)
    .set({
      ownerPhone: normalizedPhone,
      updatedAt: new Date(),
    })
    .where(eq(stores.id, store.id))

  revalidatePath('/dashboard/settings/notifications')
  return { success: true, phone: normalizedPhone }
}
