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

/**
 * Stream a voice's STATIC preview sample (its pre-generated `preview_url`). This
 * consumes NO text-to-speech credits and needs only the "Voices" read
 * permission — unlike generating fresh speech. Proxied same-origin so the CSP
 * (media-src 'self') allows playback. The sample is in the voice's own demo
 * language, not necessarily the store's.
 */
export async function fetchVoicePreview(voiceId: string): Promise<Response> {
  const key = env.ELEVENLABS_API_KEY?.trim()
  if (!key) return new Response('Preview unavailable', { status: 503 })

  let voiceRes: Response
  try {
    voiceRes = await fetch(
      `${ELEVENLABS_BASE}/voices/${encodeURIComponent(bareVoiceId(voiceId))}`,
      { headers: { 'xi-api-key': key } },
    )
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
  if (!audioRes.ok) return new Response('Preview failed', { status: 502 })

  return new Response(audioRes.body, {
    status: 200,
    headers: {
      'content-type': 'audio/mpeg',
      'cache-control': 'private, max-age=86400',
    },
  })
}
