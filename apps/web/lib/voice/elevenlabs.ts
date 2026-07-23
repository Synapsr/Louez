/**
 * Direct ElevenLabs API helpers for the DASHBOARD voice picker only (voice
 * listing + preview). Live calls still go through Twilio ConversationRelay — the
 * key here is optional and used solely to populate the picker and let a store
 * hear a voice before choosing it.
 */
import { env } from '@/env'

import type { PhoneVoiceOption } from './types'

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1'

/** Whether preview + auto voice listing are available (API key configured). */
export function isVoicePreviewEnabled(): boolean {
  return Boolean(env.ELEVENLABS_API_KEY?.trim())
}

/** A provider voice id may carry a "-model-settings" suffix; the API wants the bare id. */
function bareVoiceId(voiceId: string): string {
  return voiceId.split('-')[0]
}

/**
 * List the account's voices for the picker. Returns [] when no key or on error
 * (the picker then falls back to the env catalog).
 */
export async function listElevenLabsVoices(): Promise<PhoneVoiceOption[]> {
  const key = env.ELEVENLABS_API_KEY?.trim()
  if (!key) return []
  let res: Response
  try {
    res = await fetch(`${ELEVENLABS_BASE}/voices`, {
      headers: { 'xi-api-key': key },
    })
  } catch {
    return []
  }
  if (!res.ok) return []
  const data = (await res.json()) as {
    voices?: Array<{
      voice_id?: string
      name?: string
      labels?: Record<string, string> | null
    }>
  }
  const out: PhoneVoiceOption[] = []
  for (const v of data.voices ?? []) {
    if (typeof v.voice_id !== 'string' || !v.voice_id) continue
    out.push({
      id: v.voice_id,
      label: v.name?.trim() || v.voice_id,
      gender: v.labels?.gender === 'male' ? 'male' : 'female',
    })
  }
  return out
}

/** Fetch a single voice (name + gender), or null if unavailable to the account. */
export async function fetchVoiceById(
  voiceId: string,
): Promise<PhoneVoiceOption | null> {
  const key = env.ELEVENLABS_API_KEY?.trim()
  if (!key) return null
  let res: Response
  try {
    res = await fetch(
      `${ELEVENLABS_BASE}/voices/${encodeURIComponent(bareVoiceId(voiceId))}`,
      { headers: { 'xi-api-key': key } },
    )
  } catch {
    return null
  }
  if (!res.ok) return null
  const v = (await res.json()) as {
    voice_id?: string
    name?: string
    labels?: Record<string, string> | null
  }
  if (typeof v.voice_id !== 'string' || !v.voice_id) return null
  return {
    id: v.voice_id,
    label: v.name?.trim() || v.voice_id,
    gender: v.labels?.gender === 'male' ? 'male' : 'female',
  }
}

// Short sample the store hears, in the agent's language.
const VOICE_SAMPLES: Record<string, string> = {
  fr: "Bonjour, je suis l'assistant vocal de votre boutique. Comment puis-je vous aider aujourd'hui ?",
  en: "Hi, I'm your store's voice assistant. How can I help you today?",
  de: 'Hallo, ich bin der Sprachassistent Ihres Geschäfts. Wie kann ich Ihnen heute helfen?',
  es: 'Hola, soy el asistente de voz de tu tienda. ¿En qué puedo ayudarte hoy?',
  it: 'Ciao, sono l’assistente vocale del tuo negozio. Come posso aiutarti oggi?',
  nl: 'Hallo, ik ben de spraakassistent van je winkel. Hoe kan ik je vandaag helpen?',
  pt: 'Olá, sou o assistente de voz da sua loja. Como posso ajudar hoje?',
  pl: 'Dzień dobry, jestem asystentem głosowym Twojego sklepu. W czym mogę pomóc?',
}

// Cache generated samples so a voice+language is synthesized at most once per
// server instance — a preview then costs no further TTS credits.
const sampleCache = new Map<string, ArrayBuffer>()
const SAMPLE_CACHE_MAX = 200

function audioResponse(body: ArrayBuffer | ReadableStream): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'audio/mpeg',
      'cache-control': 'private, max-age=86400',
    },
  })
}

/** The voice's static preview_url (free, "Voices" read only, voice's own demo language). */
async function fetchStaticPreview(id: string, key: string): Promise<Response> {
  let voiceRes: Response
  try {
    voiceRes = await fetch(`${ELEVENLABS_BASE}/voices/${encodeURIComponent(id)}`, {
      headers: { 'xi-api-key': key },
    })
  } catch {
    return new Response('Preview failed', { status: 502 })
  }
  if (!voiceRes.ok) {
    return new Response('Preview failed', {
      status: voiceRes.status === 401 ? 401 : 502,
    })
  }
  const data = (await voiceRes.json()) as { preview_url?: string }
  if (!data.preview_url) return new Response('No preview', { status: 404 })
  let audioRes: Response
  try {
    audioRes = await fetch(data.preview_url)
  } catch {
    return new Response('Preview failed', { status: 502 })
  }
  if (!audioRes.ok || !audioRes.body) {
    return new Response('Preview failed', { status: 502 })
  }
  return audioResponse(audioRes.body)
}

/**
 * Stream a spoken sample of a voice. Generates it in the requested language and
 * caches it (so each voice+language is synthesized once); falls back to the
 * voice's free static preview when the key lacks the Text to Speech permission.
 * Proxied same-origin so the CSP (media-src 'self') allows playback.
 */
export async function fetchVoicePreview(
  voiceId: string,
  language: string,
): Promise<Response> {
  const key = env.ELEVENLABS_API_KEY?.trim()
  if (!key) return new Response('Preview unavailable', { status: 503 })
  const id = bareVoiceId(voiceId)

  const cacheKey = `${id}:${language}`
  const cached = sampleCache.get(cacheKey)
  if (cached) return audioResponse(cached.slice(0))

  const text = VOICE_SAMPLES[language] ?? VOICE_SAMPLES.en
  try {
    const ttsRes = await fetch(
      `${ELEVENLABS_BASE}/text-to-speech/${encodeURIComponent(
        id,
      )}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'xi-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5' }),
      },
    )
    if (ttsRes.ok) {
      const buffer = await ttsRes.arrayBuffer()
      sampleCache.set(cacheKey, buffer)
      if (sampleCache.size > SAMPLE_CACHE_MAX) {
        const oldest = sampleCache.keys().next().value
        if (oldest) sampleCache.delete(oldest)
      }
      return audioResponse(buffer.slice(0))
    }
  } catch {
    // fall through to the free static preview
  }

  // TTS not permitted (or failed): free static preview instead.
  return fetchStaticPreview(id, key)
}
