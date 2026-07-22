/**
 * Direct ElevenLabs API helpers for the DASHBOARD voice picker only (voice
 * listing + preview). Live calls still go through Twilio ConversationRelay — the
 * key here is optional and used solely to populate the picker and let a store
 * hear a voice before choosing it.
 */
import { env } from '@/env'

import type { PhoneVoiceOption } from './types'

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1'

// Short sample the store hears, in the agent's language. Kept warm and neutral.
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

/**
 * Generate a short spoken sample of `voiceId` in `language`, as an audio
 * response ready to stream to the browser. Uses the real-time model so the
 * preview matches what callers hear.
 */
export async function generateVoiceSample(
  voiceId: string,
  language: string,
): Promise<Response> {
  const key = env.ELEVENLABS_API_KEY?.trim()
  if (!key) return new Response('Preview unavailable', { status: 503 })

  const text = VOICE_SAMPLES[language] ?? VOICE_SAMPLES.en
  const url = `${ELEVENLABS_BASE}/text-to-speech/${encodeURIComponent(
    bareVoiceId(voiceId),
  )}?output_format=mp3_44100_128`

  let upstream: Response
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5' }),
    })
  } catch {
    return new Response('Preview failed', { status: 502 })
  }
  if (!upstream.ok) {
    return new Response('Preview failed', {
      status: upstream.status === 401 ? 401 : 502,
    })
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': 'audio/mpeg',
      'cache-control': 'private, max-age=3600',
    },
  })
}
