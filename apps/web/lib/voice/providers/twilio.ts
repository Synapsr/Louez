import { createHmac, timingSafeEqual } from 'node:crypto'

import { env } from '@/env'

import type {
  InboundCall,
  VoiceAction,
  VoiceProvider,
  VoiceSpeech,
} from '../types'

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
}
