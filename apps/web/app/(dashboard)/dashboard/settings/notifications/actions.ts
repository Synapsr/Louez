'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db } from '@louez/db'
import { stores } from '@louez/db'
import { getCurrentStore } from '@/lib/store-context'
import { validateDiscordWebhook, sendTestDiscordNotification } from '@/lib/discord/client'
import {
  updateSinglePreferenceSchema,
  discordWebhookSchema,
  ownerPhoneSchema,
} from '@louez/validations'
import { getSmsQuotaStatus } from '@/lib/plan-limits'
import { notifyNotificationSettingsUpdated } from '@/lib/discord/platform-notifications'
import { validateAndNormalizePhone } from '@/lib/sms/phone'
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS,
  type NotificationSettings,
  type NotificationEventType,
  type CustomerNotificationSettings,
  type CustomerNotificationEventType,
  type CustomerNotificationTemplate,
} from '@louez/types'
import { getLocaleFromCountry, type EmailLocale } from '@/lib/email/i18n'

// Language name mapping for display
const LANGUAGE_NAMES: Record<EmailLocale, string> = {
  fr: 'Francais',
  en: 'English',
  de: 'Deutsch',
  es: 'Espanol',
  it: 'Italiano',
  nl: 'Nederlands',
  pl: 'Polski',
  pt: 'Portugues',
}

export async function getNotificationSettings() {
  const store = await getCurrentStore()
  if (!store) return { error: 'errors.unauthorized' }

  const smsQuota = await getSmsQuotaStatus(store.id)

  // Determine locale from store country
  const locale = getLocaleFromCountry(store.settings?.country)
  const languageName = LANGUAGE_NAMES[locale]

  return {
    // Admin notification settings
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
    // Customer notification settings
    customerSettings: store.customerNotificationSettings || DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS,
    storeLocale: locale,
    storeLanguageName: languageName,
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

    notifyNotificationSettingsUpdated({ id: store.id, name: store.name, slug: store.slug }).catch(() => {})

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

  notifyNotificationSettingsUpdated({ id: store.id, name: store.name, slug: store.slug }).catch(() => {})

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

    notifyNotificationSettingsUpdated({ id: store.id, name: store.name, slug: store.slug }).catch(() => {})

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

  notifyNotificationSettingsUpdated({ id: store.id, name: store.name, slug: store.slug }).catch(() => {})

  revalidatePath('/dashboard/settings/notifications')
  return { success: true, phone: normalizedPhone }
}

// ============================================================================
// Customer Notification Actions
// ============================================================================

export async function updateCustomerPreference(data: {
  eventType: CustomerNotificationEventType
  channel: 'email' | 'sms'
  enabled: boolean
}) {
  const store = await getCurrentStore()
  if (!store) return { error: 'errors.unauthorized' }

  const { eventType, channel, enabled } = data

  // Get current settings or default
  const currentSettings: CustomerNotificationSettings =
    store.customerNotificationSettings || DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS

  // Update the specific preference
  const updatedSettings: CustomerNotificationSettings = {
    ...currentSettings,
    [eventType]: {
      ...currentSettings[eventType],
      [channel]: enabled,
      // If enabling a channel, also ensure the event is enabled
      enabled: enabled ? true : currentSettings[eventType].enabled,
    },
  }

  await db
    .update(stores)
    .set({
      customerNotificationSettings: updatedSettings,
      updatedAt: new Date(),
    })
    .where(eq(stores.id, store.id))

  revalidatePath('/dashboard/settings/notifications')
  return { success: true }
}

export async function updateCustomerEventEnabled(data: {
  eventType: CustomerNotificationEventType
  enabled: boolean
}) {
  const store = await getCurrentStore()
  if (!store) return { error: 'errors.unauthorized' }

  const { eventType, enabled } = data

  // Get current settings or default
  const currentSettings: CustomerNotificationSettings =
    store.customerNotificationSettings || DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS

  // Update the enabled state
  const updatedSettings: CustomerNotificationSettings = {
    ...currentSettings,
    [eventType]: {
      ...currentSettings[eventType],
      enabled,
      // If disabling, turn off all channels
      ...(enabled ? {} : { email: false, sms: false }),
    },
  }

  await db
    .update(stores)
    .set({
      customerNotificationSettings: updatedSettings,
      updatedAt: new Date(),
    })
    .where(eq(stores.id, store.id))

  revalidatePath('/dashboard/settings/notifications')
  return { success: true }
}

export async function updateCustomerTemplate(data: {
  eventType: CustomerNotificationEventType
  template: CustomerNotificationTemplate
}) {
  const store = await getCurrentStore()
  if (!store) return { error: 'errors.unauthorized' }

  const { eventType, template } = data

  // Get current settings or default
  const currentSettings: CustomerNotificationSettings =
    store.customerNotificationSettings || DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS

  // Update the template
  const updatedSettings: CustomerNotificationSettings = {
    ...currentSettings,
    templates: {
      ...currentSettings.templates,
      [eventType]: template,
    },
  }

  await db
    .update(stores)
    .set({
      customerNotificationSettings: updatedSettings,
      updatedAt: new Date(),
    })
    .where(eq(stores.id, store.id))

  revalidatePath('/dashboard/settings/notifications')
  return { success: true }
}

export async function getCustomerTemplate(eventType: CustomerNotificationEventType) {
  const store = await getCurrentStore()
  if (!store) return { error: 'errors.unauthorized' }

  const settings = store.customerNotificationSettings || DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS
  const template = settings.templates?.[eventType] || {}

  return { template }
}

export async function updateReminderSettings(data: {
  pickupReminderHours: number
  returnReminderHours: number
}) {
  const store = await getCurrentStore()
  if (!store) return { error: 'errors.unauthorized' }

  // Validate hours (must be between 1 and 168 = 1 week)
  const { pickupReminderHours, returnReminderHours } = data
  if (pickupReminderHours < 1 || pickupReminderHours > 168) {
    return { error: 'errors.invalidReminderHours' }
  }
  if (returnReminderHours < 1 || returnReminderHours > 168) {
    return { error: 'errors.invalidReminderHours' }
  }

  // Get current settings or default
  const currentSettings: CustomerNotificationSettings =
    store.customerNotificationSettings || DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS

  // Update the reminder settings
  const updatedSettings: CustomerNotificationSettings = {
    ...currentSettings,
    reminderSettings: {
      pickupReminderHours,
      returnReminderHours,
    },
  }

  await db
    .update(stores)
    .set({
      customerNotificationSettings: updatedSettings,
      updatedAt: new Date(),
    })
    .where(eq(stores.id, store.id))

  revalidatePath('/dashboard/settings/notifications')
  return { success: true }
}
