/**
 * Voice Provider System Types
 *
 * Mirrors the SMS provider system (src/lib/sms/types.ts): the telephony
 * provider is selected via the VOICE_PROVIDER environment variable, and every
 * provider implements the same interface. This keeps the AI phone receptionist
 * transport-agnostic — the route handlers and the AI agent never touch
 * Twilio-specific markup.
 *
 * To add a new provider:
 *   1. Create a file in src/lib/voice/providers/ (e.g. telnyx.ts)
 *   2. Implement the VoiceProvider interface
 *   3. Register it in the factory in ../client.ts
 *   4. Add required env vars to env.ts and .env.example
 */

/** Supported telephony provider identifiers. */
export type VoiceProviderType = 'twilio'

/** A spoken prompt: text plus the language/voice it should be rendered in. */
export interface VoiceSpeech {
  /** Plain text to speak (never markup — it is XML-escaped by the provider). */
  text: string
  /** App locale the receptionist speaks, e.g. 'fr', 'en'. */
  language: string
  /** Provider-specific voice id/name. Falls back to a per-language default. */
  voice?: string
}

/**
 * Provider-agnostic instruction the route asks the provider to render into a
 * concrete response (TwiML for Twilio). One action == one HTTP turn.
 */
export type VoiceAction =
  | {
      /** Speak a prompt, then listen for the caller's speech. */
      type: 'gather'
      speak: VoiceSpeech
      /** Absolute URL the provider POSTs the recognized speech to. */
      actionUrl: string
      /** Seconds of silence before giving up on input. */
      timeoutSeconds?: number
    }
  | {
      /** Speak a final message, then hang up. */
      type: 'say_hangup'
      speak: VoiceSpeech
    }
  | {
      /** Transfer the call to a human (E.164), optionally speaking first. */
      type: 'dial'
      number: string
      callerId?: string
      speakBefore?: VoiceSpeech
    }
  | { type: 'hangup' }

/** Inbound call fields, normalized across providers. */
export interface InboundCall {
  /** Provider call identifier (Twilio CallSid). */
  callId: string
  /** Caller number (E.164). */
  from: string
  /** Called number (E.164) — used to resolve the store. */
  to: string
  /** Speech transcript from the previous turn, or null on the first turn. */
  speech: string | null
  /** Provider call status on a status callback (e.g. 'completed'). */
  status: string | null
  /** Billed call duration in seconds on a status callback. */
  durationSeconds: number | null
}

export interface VoiceProvider {
  /** Provider identifier. */
  readonly name: VoiceProviderType

  /** Whether all required env vars are set. */
  isConfigured(): boolean

  /** Configuration status for diagnostics (no secrets). */
  getConfigStatus(): { configured: boolean; missingVars?: string[] }

  /**
   * Verify the authenticity of an inbound webhook (signature check).
   * `url` is the exact public URL the provider requested; `params` are the
   * decoded form fields; `signature` is the provider's signature header.
   */
  verifyWebhook(input: {
    url: string
    params: Record<string, string>
    signature: string | null
  }): boolean

  /** Normalize provider webhook form fields into an InboundCall. */
  parseInboundCall(params: Record<string, string>): InboundCall

  /** Render an action into a provider-specific response body + content type. */
  renderResponse(action: VoiceAction): { body: string; contentType: string }
}
