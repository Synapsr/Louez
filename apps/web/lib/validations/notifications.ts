import { z } from 'zod'
import { NOTIFICATION_EVENT_TYPES } from '@louez/types'

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
  payment_received: notificationChannelConfigSchema,
  payment_failed: notificationChannelConfigSchema,
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
    .regex(/^\+?[0-9\s-]{8,20}$/, 'Invalid phone number format')
    .nullable(),
})

export type OwnerPhoneInput = z.infer<typeof ownerPhoneSchema>

export const updateSinglePreferenceSchema = z.object({
  eventType: z.enum(NOTIFICATION_EVENT_TYPES as [string, ...string[]]),
  channel: z.enum(['email', 'sms', 'discord']),
  enabled: z.boolean(),
})

export type UpdateSinglePreferenceInput = z.infer<typeof updateSinglePreferenceSchema>
