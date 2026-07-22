import { createHmac, timingSafeEqual } from 'node:crypto'

import { env } from '@/env'
import { log } from '@/lib/evlog'

import type {
  AvailableNumber,
  InboundCall,
  VoiceAction,
  VoiceProvider,
  VoiceSpeech,
} from '../types'

const TWILIO_REST_BASE = 'https://api.twilio.com/2010-04-01'

const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * App locale → Twilio <Say>/<Gather> locale + a sensible default neural voice
 * (Amazon Polly). The merchant can override the voice per store (settings.voice);
 * this is only the fallback so every supported language sounds natural out of
 * the box. All values are real Amazon Polly neural voices — validate them
 * against the operator's Twilio account during the pre-production test, since a
 * voice string Twilio does not expose would make <Say> fail with no audio.
 */
const LANGUAGE_MAP: Record<string, { locale: string; voice: string }> = {
  fr: { locale: 'fr-FR', voice: 'Polly.Lea-Neural' },
  en: { locale: 'en-US', voice: 'Polly.Joanna-Neural' },
  it: { locale: 'it-IT', voice: 'Polly.Bianca-Neural' },
  nl: { locale: 'nl-NL', voice: 'Polly.Laura-Neural' },
  pt: { locale: 'pt-PT', voice: 'Polly.Ines-Neural' },
  de: { locale: 'de-DE', voice: 'Polly.Vicki-Neural' },
  es: { locale: 'es-ES', voice: 'Polly.Lucia-Neural' },
  pl: { locale: 'pl-PL', voice: 'Polly.Ola-Neural' },
}

const FALLBACK_LANGUAGE = { locale: 'en-US', voice: 'Polly.Joanna-Neural' }

function resolveLanguage(language: string) {
  return LANGUAGE_MAP[language] ?? FALLBACK_LANGUAGE
}

/** Escape a string for safe inclusion in XML text/attribute content. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function sayTag(speak: VoiceSpeech): string {
  const { locale, voice } = resolveLanguage(speak.language)
  const chosenVoice = speak.voice?.trim() || voice
  return `<Say voice="${escapeXml(chosenVoice)}" language="${locale}">${escapeXml(
    speak.text,
  )}</Say>`
}

/**
 * Twilio telephony provider for the inbound AI receptionist. Uses the TwiML
 * <Gather input="speech"> turn-based model, which works over plain HTTP
 * webhooks (no WebSocket) — the transport that fits this app's standalone
 * Next.js server. STT and TTS are handled by Twilio.
 */
export class TwilioVoiceProvider implements VoiceProvider {
  readonly name = 'twilio' as const

  private getAuthToken(): string | undefined {
    return env.TWILIO_AUTH_TOKEN
  }

  isConfigured(): boolean {
    return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN)
  }

  getConfigStatus(): { configured: boolean; missingVars?: string[] } {
    const missing: string[] = []
    if (!env.TWILIO_ACCOUNT_SID) missing.push('TWILIO_ACCOUNT_SID')
    if (!env.TWILIO_AUTH_TOKEN) missing.push('TWILIO_AUTH_TOKEN')
    return missing.length
      ? { configured: false, missingVars: missing }
      : { configured: true }
  }

  /**
   * Validate X-Twilio-Signature for an application/x-www-form-urlencoded POST.
   * Algorithm: HMAC-SHA1(authToken, fullUrl + concat(sortedByKey(k + v))),
   * base64-encoded, compared in constant time.
   * See https://www.twilio.com/docs/usage/security#validating-requests
   */
  verifyWebhook(input: {
    url: string
    params: Record<string, string>
    signature: string | null
  }): boolean {
    const authToken = this.getAuthToken()
    if (!authToken || !input.signature) return false

    const data =
      input.url +
      Object.keys(input.params)
        .sort()
        .map((key) => key + input.params[key])
        .join('')

    const expected = createHmac('sha1', authToken).update(data, 'utf8').digest()
    let provided: Buffer
    try {
      provided = Buffer.from(input.signature, 'base64')
    } catch {
      return false
    }
    if (provided.length !== expected.length) return false
    return timingSafeEqual(expected, provided)
  }

  parseInboundCall(params: Record<string, string>): InboundCall {
    const duration = params.CallDuration
      ? Number.parseInt(params.CallDuration, 10)
      : null
    return {
      callId: params.CallSid ?? '',
      from: params.From ?? '',
      to: params.To ?? '',
      speech:
        typeof params.SpeechResult === 'string' ? params.SpeechResult : null,
      status: params.CallStatus ?? null,
      durationSeconds:
        duration !== null && Number.isFinite(duration) ? duration : null,
    }
  }

  renderResponse(action: VoiceAction): { body: string; contentType: string } {
    const contentType = 'text/xml; charset=utf-8'
    let inner: string

    switch (action.type) {
      case 'gather': {
        const { locale } = resolveLanguage(action.speak.language)
        const timeout = action.timeoutSeconds ?? 5
        // actionOnEmptyResult keeps control on our side even when the caller
        // stays silent — the route decides whether to reprompt or end.
        inner =
          `<Gather input="speech" action="${escapeXml(action.actionUrl)}" method="POST"` +
          ` language="${locale}" speechModel="phone_call" speechTimeout="auto"` +
          ` timeout="${timeout}" actionOnEmptyResult="true">` +
          sayTag(action.speak) +
          `</Gather>`
        break
      }
      case 'say_hangup':
        inner = sayTag(action.speak) + '<Hangup/>'
        break
      case 'dial': {
        const callerId = action.callerId
          ? ` callerId="${escapeXml(action.callerId)}"`
          : ''
        inner =
          (action.speakBefore ? sayTag(action.speakBefore) : '') +
          `<Dial${callerId}>${escapeXml(action.number)}</Dial>`
        break
      }
      case 'connect_relay': {
        // Hand off to Twilio ConversationRelay: it runs STT + TTS + endpointing +
        // barge-in and streams TEXT to our worker over the (already-signed) wss
        // url. Query separators in that url are escaped by escapeXml (& → &amp;).
        const { locale } = resolveLanguage(action.language)
        const attrs = [
          `url="${escapeXml(action.wsUrl)}"`,
          `transcriptionProvider="${escapeXml(action.sttProvider)}"`,
          `ttsProvider="${escapeXml(action.ttsProvider)}"`,
          action.voice ? `voice="${escapeXml(action.voice)}"` : '',
          `language="${escapeXml(locale)}"`,
          `welcomeGreeting="${escapeXml(action.welcomeGreeting)}"`,
          `action="${escapeXml(action.actionUrl)}"`,
        ]
          .filter(Boolean)
          .join(' ')
        inner = `<Connect><ConversationRelay ${attrs} /></Connect>`
        break
      }
      case 'hangup':
        inner = '<Hangup/>'
        break
    }

    return {
      body: `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`,
      contentType,
    }
  }

  /** Basic-auth header for the Twilio REST API, or null if not configured. */
  private authHeader(): string | null {
    const sid = env.TWILIO_ACCOUNT_SID
    const token = env.TWILIO_AUTH_TOKEN
    if (!sid || !token) return null
    return `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`
  }

  async startCallRecording(input: {
    callId: string
    statusCallbackUrl: string
  }): Promise<void> {
    const auth = this.authHeader()
    const sid = env.TWILIO_ACCOUNT_SID
    if (!auth || !sid) return

    const body = new URLSearchParams({
      RecordingStatusCallback: input.statusCallbackUrl,
      RecordingStatusCallbackEvent: 'completed',
      RecordingStatusCallbackMethod: 'POST',
      RecordingTrack: 'both',
    })
    const url = `${TWILIO_REST_BASE}/Accounts/${encodeURIComponent(
      sid,
    )}/Calls/${encodeURIComponent(input.callId)}/Recordings.json`

    // The call may not be in-progress the instant the webhook returns, which
    // Twilio rejects with a 400 — retry once after a short delay.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await delay(800)
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            authorization: auth,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body,
        })
        if (res.ok) return
        if (res.status !== 400) {
          log.error('phone', `startCallRecording failed: HTTP ${res.status}`)
          return
        }
      } catch (error) {
        log.error(
          'phone',
          `startCallRecording error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
        return
      }
    }
    log.error('phone', 'startCallRecording: call not recordable after retry')
  }

  parseRecordingCallback(params: Record<string, string>): {
    callId: string
    recordingSid: string
    durationSeconds: number | null
  } | null {
    if (params.RecordingStatus !== 'completed') return null
    const recordingSid = params.RecordingSid
    const callId = params.CallSid
    if (!recordingSid || !callId) return null
    const duration = params.RecordingDuration
      ? Number.parseInt(params.RecordingDuration, 10)
      : null
    return {
      callId,
      recordingSid,
      durationSeconds:
        duration !== null && Number.isFinite(duration) ? duration : null,
    }
  }

  async fetchRecordingMedia(input: {
    recordingSid: string
    range?: string | null
  }): Promise<Response> {
    const auth = this.authHeader()
    const sid = env.TWILIO_ACCOUNT_SID
    if (!auth || !sid) {
      return new Response('Recording unavailable', { status: 503 })
    }

    const url = `${TWILIO_REST_BASE}/Accounts/${encodeURIComponent(
      sid,
    )}/Recordings/${encodeURIComponent(input.recordingSid)}.mp3`
    const headers: Record<string, string> = { authorization: auth }
    if (input.range) headers.range = input.range

    let upstream: Response
    try {
      upstream = await fetch(url, { headers })
    } catch {
      return new Response('Recording unavailable', { status: 502 })
    }
    if (!upstream.ok && upstream.status !== 206) {
      return new Response('Recording unavailable', {
        status: upstream.status === 404 ? 404 : 502,
      })
    }

    // Forward only the headers a player needs; never leak provider headers.
    const out = new Headers({
      'content-type': 'audio/mpeg',
      'accept-ranges': 'bytes',
      'cache-control': 'private, no-store',
    })
    const contentLength = upstream.headers.get('content-length')
    if (contentLength) out.set('content-length', contentLength)
    const contentRange = upstream.headers.get('content-range')
    if (contentRange) out.set('content-range', contentRange)

    return new Response(upstream.body, { status: upstream.status, headers: out })
  }

  async searchAvailableNumbers(input: {
    country: string
    areaCode?: string
    contains?: string
    limit?: number
  }): Promise<AvailableNumber[]> {
    const auth = this.authHeader()
    const sid = env.TWILIO_ACCOUNT_SID
    if (!auth || !sid) return []

    const country = input.country.toUpperCase()
    const params = new URLSearchParams({
      PageSize: String(Math.min(Math.max(input.limit ?? 10, 1), 30)),
      // Only surface numbers that can actually receive inbound calls.
      VoiceEnabled: 'true',
    })
    if (input.areaCode) params.set('AreaCode', input.areaCode)
    if (input.contains) params.set('Contains', input.contains)
    const url = `${TWILIO_REST_BASE}/Accounts/${encodeURIComponent(
      sid,
    )}/AvailablePhoneNumbers/${encodeURIComponent(
      country,
    )}/Local.json?${params.toString()}`

    const res = await fetch(url, { headers: { authorization: auth } })
    if (!res.ok) throw new Error(`number search failed: HTTP ${res.status}`)
    const data = (await res.json()) as {
      available_phone_numbers?: Array<{
        phone_number?: string
        friendly_name?: string
        locality?: string | null
        region?: string | null
      }>
    }
    const list: AvailableNumber[] = []
    for (const n of data.available_phone_numbers ?? []) {
      if (typeof n.phone_number !== 'string') continue
      list.push({
        phoneNumber: n.phone_number,
        friendlyName: n.friendly_name || n.phone_number,
        locality: n.locality ?? null,
        region: n.region ?? null,
      })
    }
    return list
  }

  async provisionNumber(input: {
    phoneNumber: string
    voiceUrl: string
    statusCallbackUrl: string
  }): Promise<{ e164: string; providerNumberId: string }> {
    const auth = this.authHeader()
    const sid = env.TWILIO_ACCOUNT_SID
    if (!auth || !sid) throw new Error('Telephony provider not configured')

    const body = new URLSearchParams({
      PhoneNumber: input.phoneNumber,
      VoiceUrl: input.voiceUrl,
      VoiceMethod: 'POST',
      StatusCallback: input.statusCallbackUrl,
      StatusCallbackMethod: 'POST',
    })
    // Many countries (e.g. FR) require a regulatory address, and stricter ones a
    // bundle, to purchase a number. Sent when the operator configured them.
    if (env.TWILIO_ADDRESS_SID) body.set('AddressSid', env.TWILIO_ADDRESS_SID)
    if (env.TWILIO_BUNDLE_SID) body.set('BundleSid', env.TWILIO_BUNDLE_SID)
    const url = `${TWILIO_REST_BASE}/Accounts/${encodeURIComponent(
      sid,
    )}/IncomingPhoneNumbers.json`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: auth,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
    })
    if (!res.ok) {
      let message = `provisioning failed: HTTP ${res.status}`
      try {
        const err = (await res.json()) as { message?: string }
        if (err.message) message = err.message
      } catch {
        // keep the default message
      }
      throw new Error(message)
    }
    const data = (await res.json()) as { sid?: string; phone_number?: string }
    if (!data.sid || !data.phone_number) {
      throw new Error('provisioning returned an unexpected response')
    }
    return { e164: data.phone_number, providerNumberId: data.sid }
  }

  async releaseNumber(providerNumberId: string): Promise<void> {
    const auth = this.authHeader()
    const sid = env.TWILIO_ACCOUNT_SID
    if (!auth || !sid) return
    const url = `${TWILIO_REST_BASE}/Accounts/${encodeURIComponent(
      sid,
    )}/IncomingPhoneNumbers/${encodeURIComponent(providerNumberId)}.json`
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { authorization: auth },
    })
    // 404 = already released upstream; treat as success (idempotent).
    if (!res.ok && res.status !== 404) {
      throw new Error(`release failed: HTTP ${res.status}`)
    }
  }
}
