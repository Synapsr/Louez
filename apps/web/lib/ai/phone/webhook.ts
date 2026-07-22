import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { db, storePhoneNumbers, stores } from '@louez/db'

import { getVoiceProvider } from '@/lib/voice/client'
import type { VoiceAction } from '@/lib/voice/types'

const MAX_BODY_BYTES = 64 * 1024

/** Render a provider-agnostic action into an HTTP response (TwiML for Twilio). */
export function voiceResponse(action: VoiceAction): Response {
  const { body, contentType } = getVoiceProvider().renderResponse(action)
  return new Response(body, {
    status: 200,
    headers: { 'content-type': contentType },
  })
}

/**
 * Validated subset of the telephony webhook form fields we consume. Unknown
 * fields are stripped here but preserved in the raw params for the signature
 * check (the provider signs EVERY posted field). [SE-03]
 */
export const voiceWebhookParamsSchema = z.object({
  CallSid: z.string().min(1).max(64),
  From: z.string().max(32).optional().default(''),
  To: z.string().max(32).optional().default(''),
  CallStatus: z.string().max(32).optional(),
  CallDuration: z.string().max(12).optional(),
  SpeechResult: z.string().max(4000).optional(),
})

/** Public origin the provider actually reached (behind the reverse proxy). */
function getRequestOrigin(req: Request): string {
  const host =
    req.headers.get('x-forwarded-host') ??
    req.headers.get('host') ??
    new URL(req.url).host
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  return `${proto}://${host}`
}

export type VoiceWebhookRead =
  | {
      ok: true
      /** Every posted field, for the signature check. */
      rawParams: Record<string, string>
      /** The exact public URL the provider signed (origin + path + query). */
      publicUrl: string
      /** Public origin, for building the next turn's absolute action URL. */
      origin: string
      signature: string | null
    }
  | { ok: false; status: number }

/** Read + size-guard an inbound telephony webhook (form-urlencoded POST). */
export async function readVoiceWebhook(req: Request): Promise<VoiceWebhookRead> {
  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BODY_BYTES) return { ok: false, status: 413 }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return { ok: false, status: 400 }
  }

  const rawParams: Record<string, string> = {}
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') rawParams[key] = value
  }

  const origin = getRequestOrigin(req)
  const url = new URL(req.url)
  return {
    ok: true,
    rawParams,
    publicUrl: origin + url.pathname + url.search,
    origin,
    signature: req.headers.get('x-twilio-signature'),
  }
}

/** Columns loaded for a call. currency/timezone/businessHours live in settings. */
export const callStoreColumns = {
  id: true,
  name: true,
  slug: true,
  description: true,
  email: true,
  phone: true,
  address: true,
  settings: true,
  aiPhoneSettings: true,
  aiAdvisorSettings: true,
  onboardingCompleted: true,
} as const

export function loadCallStore(storeId: string) {
  return db.query.stores.findFirst({
    where: eq(stores.id, storeId),
    columns: callStoreColumns,
  })
}

/**
 * Resolve the store an inbound call is for, by the CALLED number (E.164). Only
 * an active binding matches, and the number is globally unique, so this maps to
 * exactly one store. [SE-05]
 */
export async function resolveStoreForCall(e164: string) {
  const binding = await db.query.storePhoneNumbers.findFirst({
    where: and(
      eq(storePhoneNumbers.e164, e164),
      eq(storePhoneNumbers.status, 'active'),
    ),
    columns: { storeId: true },
  })
  if (!binding) return null
  return loadCallStore(binding.storeId)
}
