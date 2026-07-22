import { z } from 'zod'
import type { AiPhoneSettings } from '@louez/types'

// NOTE: this module is imported by a CLIENT component (the settings form) for
// its constants/defaults, so it must stay free of heavy deps like
// libphonenumber. E.164 is checked here with a lightweight regex; the strict
// libphonenumber validation runs server-side (see phone.ts / the save action).
export const AI_PHONE_GREETING_MAX_LENGTH = 300
export const AI_PHONE_VOICE_MAX_LENGTH = 80

/**
 * Languages the receptionist can be configured to speak. Kept in sync with the
 * app's supported locales (apps/web/i18n/config.ts). Duplicated here on purpose:
 * validations is the schema boundary and must not import from the app.
 */
export const AI_PHONE_LANGUAGES = [
  'fr',
  'en',
  'it',
  'nl',
  'pt',
  'de',
  'es',
  'pl',
] as const

export const aiPhoneLanguageSchema = z.enum(AI_PHONE_LANGUAGES)

export const aiPhoneAnswerModeSchema = z.enum(['always', 'after_hours'])

/** Lightweight E.164 shape check (e.g. +33123456789). */
const E164_REGEX = /^\+[1-9]\d{1,14}$/
const e164Schema = z.string().trim().regex(E164_REGEX, {
  message: 'Must be a valid phone number in international format (E.164).',
})

export const aiPhoneSettingsSchema = z.object({
  enabled: z.boolean(),
  language: aiPhoneLanguageSchema,
  canTakeReservations: z.boolean(),
  answerMode: aiPhoneAnswerModeSchema,
  greeting: z.string().max(AI_PHONE_GREETING_MAX_LENGTH).optional(),
  // Allow clearing the transfer number with an empty string; otherwise require E.164.
  transferNumber: z.union([z.literal(''), e164Schema]).optional(),
  voice: z.string().max(AI_PHONE_VOICE_MAX_LENGTH).optional(),
})

export type AiPhoneSettingsInput = z.infer<typeof aiPhoneSettingsSchema>

/** Default settings applied when a store first enables the phone receptionist. */
export const defaultAiPhoneSettings: AiPhoneSettings = {
  enabled: false,
  language: 'fr',
  canTakeReservations: true,
  answerMode: 'always',
}

/**
 * Binding a store to an inbound phone number. The merchant points the number's
 * voice webhook at the app and registers the E.164 here so inbound calls resolve
 * to the store. Uniqueness (one number → one store) is enforced by the DB.
 */
export const aiPhoneNumberBindingSchema = z.object({
  e164: e164Schema,
})

export type AiPhoneNumberBinding = z.infer<typeof aiPhoneNumberBindingSchema>
