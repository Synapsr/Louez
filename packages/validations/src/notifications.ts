import { z } from 'zod'

import { NOTIFICATION_EVENT_TYPES } from '@louez/types'

import { isPossiblePhoneNumberInput } from './phone'

export const notificationChannelConfigSchema = z.object({
  email: z.boolean(),
  sms: z.boolean(),
  discord: z.boolean(),
  push: z.boolean(),
})

export const notificationSettingsSchema = z.object({
  reservation_new: notificationChannelConfigSchema,
  reservation_confirmed: notificationChannelConfigSchema,
  reservation_rejected: notificationChannelConfigSchema,
  reservation_cancelled: notificationChannelConfigSchema,
  reservation_picked_up: notificationChannelConfigSchema,
  reservation_completed: notificationChannelConfigSchema,
  reservation_reminder_pickup: notificationChannelConfigSchema,
  reservation_reminder_return: notificationChannelConfigSchema,
  payment_received: notificationChannelConfigSchema,
  payment_failed: notificationChannelConfigSchema,
  reminderSettings: z
    .object({
      pickupReminderHours: z.number().int().min(1).max(168),
      returnReminderHours: z.number().int().min(1).max(168),
      // Keep in sync with the NotificationSettings['reminderSettings'] type and
      // updateAdminReminderSettings — omitting these would silently strip the
      // admin delivery mode / digest hour if this schema is ever used to parse.
      mode: z.enum(['per_reservation', 'daily_digest']).optional(),
      digestHour: z.number().int().min(0).max(23).optional(),
    })
    .optional(),
})

export type NotificationSettingsInput = z.infer<typeof notificationSettingsSchema>

export const discordWebhookSchema = z.object({
  webhookUrl: z
    .string()
    .url('Invalid URL format')
    .regex(
      /^https:\/\/discord\.com\/api\/webhooks\/\d+\/[\w-]+$/,
      'Invalid Discord webhook URL format'
    )
    .nullable(),
})

export type DiscordWebhookInput = z.infer<typeof discordWebhookSchema>

export const ownerPhoneSchema = z.object({
  phone: z
    .string()
    .refine((value) => isPossiblePhoneNumberInput(value), {
      message: 'Invalid phone number format',
    })
    .nullable(),
})

export type OwnerPhoneInput = z.infer<typeof ownerPhoneSchema>

export const updateSinglePreferenceSchema = z.object({
  eventType: z.enum(NOTIFICATION_EVENT_TYPES as [string, ...string[]]),
  channel: z.enum(['email', 'sms', 'discord', 'push']),
  enabled: z.boolean(),
})

export type UpdateSinglePreferenceInput = z.infer<typeof updateSinglePreferenceSchema>

// ===== Web Push subscriptions =====

// Endpoints come from the browser's push service. Allowlist the known hosts so a
// crafted subscription can't turn the server-side web-push POST into an SSRF
// (same hardening pattern as the Discord webhook URL above).
const ALLOWED_PUSH_ENDPOINT_HOSTS = [
  '.googleapis.com', // FCM — Chrome, Edge, Brave, Opera, Samsung Internet
  '.push.apple.com', // Apple — Safari, iOS/iPadOS, macOS
  '.push.services.mozilla.com', // Firefox
  '.notify.windows.com', // WNS — legacy Edge
]

function isAllowedPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    return ALLOWED_PUSH_ENDPOINT_HOSTS.some((suffix) => host.endsWith(suffix))
  } catch {
    return false
  }
}

export const pushSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(2048)
    .refine(isAllowedPushEndpoint, 'Unsupported push endpoint'),
  keys: z.object({
    p256dh: z.string().min(1).max(255),
    auth: z.string().min(1).max(255),
  }),
  userAgent: z.string().max(512).optional(),
})

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>

export const unsubscribePushSchema = z.object({
  endpoint: z.string().url(),
})

export type UnsubscribePushInput = z.infer<typeof unsubscribePushSchema>
