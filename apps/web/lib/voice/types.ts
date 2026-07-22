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
  | {
      /**
       * Hand the call to a streaming ConversationRelay session — the provider
       * runs STT + TTS + endpointing + barge-in and the per-turn loop lives on
       * the WebSocket worker, not this HTTP interface. Used instead of `gather`
       * when the streaming transport is enabled.
       */
      type: 'connect_relay'
      /** wss URL of the relay worker, already signed for this call. */
      wsUrl: string
      /** Greeting spoken at connect by the provider's TTS. */
      welcomeGreeting: string
      /** App locale (e.g. 'fr'); the provider maps it to a BCP-47 STT/TTS locale. */
      language: string
      /** Provider TTS + STT selection and the voice id to synthesize with. */
      ttsProvider: string
      sttProvider: string
      voice?: string
      /** URL the provider POSTs to when the relay session ends (transfer/hangup). */
      actionUrl: string
    }
  | { type: 'hangup' }

/** One selectable TTS voice offered to a store (from the operator's catalog). */
export interface PhoneVoiceOption {
  /** Provider voice id (e.g. ElevenLabs voice id). */
  id: string
  /** Human label shown in the picker (e.g. a first name). */
  label: string
  gender: 'male' | 'female'
}

/** Per-locale voice catalog the store picks from. Empty when unconfigured. */
export type PhoneVoiceCatalog = Record<string, PhoneVoiceOption[]>

/** A phone number available to provision, normalized across providers. */
export interface AvailableNumber {
  /** E.164 number, e.g. '+33756781234'. */
  phoneNumber: string
  /** Human label (provider friendly name), falls back to the number. */
  friendlyName: string
  /** City/locality, when the provider returns one. */
  locality: string | null
  /** Region/state, when the provider returns one. */
  region: string | null
}

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

  /**
   * Start recording the live call out-of-band (provider REST API). The
   * recording finalizes after the call ends and the provider POSTs the id +
   * duration to `statusCallbackUrl`. Best-effort: recording must never break
   * the call, so implementations swallow and log their own errors.
   */
  startCallRecording(input: {
    callId: string
    statusCallbackUrl: string
  }): Promise<void>

  /**
   * Normalize a recording status callback into the fields we persist, or null
   * when it is not a terminal event with a usable recording.
   */
  parseRecordingCallback(params: Record<string, string>): {
    callId: string
    recordingSid: string
    durationSeconds: number | null
  } | null

  /**
   * Fetch a completed recording's audio, proxying the provider credentials so
   * the media is never publicly reachable. Forwards an optional Range header
   * for seeking and returns a ready-to-send audio Response.
   */
  fetchRecordingMedia(input: {
    recordingSid: string
    range?: string | null
  }): Promise<Response>

  /**
   * Search phone numbers available to provision. `country` is an ISO-3166
   * alpha-2 code; `areaCode`/`contains` narrow the search. Throws on a provider
   * or credential error.
   */
  searchAvailableNumbers(input: {
    country: string
    areaCode?: string
    contains?: string
    limit?: number
  }): Promise<AvailableNumber[]>

  /**
   * Provision (buy) a number and point its voice webhooks at the app. Returns
   * the provider's number id (for later release) and the E.164 number. Throws
   * on failure — provisioning spends money, so callers surface the error.
   */
  provisionNumber(input: {
    phoneNumber: string
    voiceUrl: string
    statusCallbackUrl: string
  }): Promise<{ e164: string; providerNumberId: string }>

  /** Release a previously provisioned number back to the provider. */
  releaseNumber(providerNumberId: string): Promise<void>
}
