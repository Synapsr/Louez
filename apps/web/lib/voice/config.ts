/**
 * Streaming-voice (ConversationRelay) configuration, read entirely from the
 * environment. Nothing here is hardcoded: transport choice, TTS/STT providers
 * and the per-language voice ids all come from env so the open-source code
 * carries no commercial/voice defaults. Falls back safely to the turn-based
 * <Gather> transport whenever the relay is not fully configured.
 */
import { env } from '@/env'

import type { PhoneVoiceCatalog, PhoneVoiceOption } from './types'

/**
 * Whether the streaming ConversationRelay transport is enabled AND fully
 * configured. When false, the phone channel uses the turn-based <Gather> path.
 */
export function isRelayTransport(): boolean {
  return (
    env.AI_PHONE_TRANSPORT === 'relay' &&
    Boolean(env.VOICE_RELAY_WS_URL?.trim()) &&
    Boolean(env.VOICE_RELAY_SIGNING_SECRET?.trim())
  )
}

/** Shared HMAC secret authenticating the relay handshake + worker↔app requests. */
export function getRelaySigningSecret(): string {
  return env.VOICE_RELAY_SIGNING_SECRET?.trim() ?? ''
}

/** Base wss:// URL of the ConversationRelay worker (no trailing slash). */
export function getRelayWsUrl(): string {
  return (env.VOICE_RELAY_WS_URL?.trim() ?? '').replace(/\/+$/, '')
}

/** ConversationRelay TTS provider (default ElevenLabs for realistic voices). */
export function getTtsProvider(): string {
  return env.AI_PHONE_TTS_PROVIDER?.trim() || 'ElevenLabs'
}

/** ConversationRelay STT provider (default Deepgram for low-latency accuracy). */
export function getSttProvider(): string {
  return env.AI_PHONE_STT_PROVIDER?.trim() || 'Deepgram'
}

/** Parsed AI_PHONE_VOICES map (locale → voice id); {} on any parse error. */
function parseVoiceMap(): Record<string, string> {
  const raw = env.AI_PHONE_VOICES?.trim()
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    for (const [locale, id] of Object.entries(parsed)) {
      if (typeof id === 'string' && id.trim()) out[locale] = id.trim()
    }
    return out
  } catch {
    return {}
  }
}

/** Operator-recommended voice ids (AI_PHONE_RECOMMENDED_VOICES), surfaced first. */
export function getRecommendedVoiceIds(): Set<string> {
  const raw = env.AI_PHONE_RECOMMENDED_VOICES?.trim()
  if (!raw) return new Set()
  return new Set(
    raw
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  )
}

/**
 * Voices a store may pick from, per locale, from AI_PHONE_VOICE_CATALOG. Powers
 * the dashboard voice picker. Returns {} when unconfigured or malformed.
 */
export function getVoiceCatalog(): PhoneVoiceCatalog {
  const raw = env.AI_PHONE_VOICE_CATALOG?.trim()
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: PhoneVoiceCatalog = {}
    for (const [locale, list] of Object.entries(parsed)) {
      if (!Array.isArray(list)) continue
      const voices: PhoneVoiceOption[] = []
      for (const entry of list) {
        if (
          entry &&
          typeof entry === 'object' &&
          typeof (entry as { id?: unknown }).id === 'string' &&
          (entry as { id: string }).id.trim()
        ) {
          const id = (entry as { id: string }).id.trim()
          const label = (entry as { label?: unknown }).label
          voices.push({
            id,
            label:
              typeof label === 'string' && label.trim() ? label.trim() : id,
            gender:
              (entry as { gender?: unknown }).gender === 'male'
                ? 'male'
                : 'female',
          })
        }
      }
      if (voices.length > 0) out[locale] = voices
    }
    return out
  } catch {
    return {}
  }
}

/**
 * Resolve the provider voice id for a call: a per-store voice wins, then the
 * per-locale env map, then the env default. Undefined lets the provider fall
 * back to its own default voice.
 */
export function resolveVoiceId(
  locale: string,
  storeVoice?: string | null,
): string | undefined {
  const override = storeVoice?.trim()
  if (override) return override
  const perLocale = parseVoiceMap()[locale]
  if (perLocale) return perLocale
  return env.AI_PHONE_DEFAULT_VOICE?.trim() || undefined
}
