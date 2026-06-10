import { z } from 'zod'

import { NOTIFICATION_EVENT_TYPES } from '@louez/types'

import { isPossiblePhoneNumberInput } from './phone'

export const notificationChannelConfigSchema = z.object({
  email: z.boolean(),
  sms: z.boolean(),
  discord: z.boolean(),
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
  channel: z.enum(['email', 'sms', 'discord']),
  enabled: z.boolean(),
})

export type UpdateSinglePreferenceInput = z.infer<typeof updateSinglePreferenceSchema>
