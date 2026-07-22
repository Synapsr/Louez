'use server'

import { getStorePlan } from '@/lib/plan-limits'
import { getCurrentStore } from '@/lib/store-context'
import { getRecommendedVoiceIds, getVoiceCatalog } from '@/lib/voice/config'
import {
  fetchVoiceById,
  isVoicePreviewEnabled,
  listElevenLabsVoices,
} from '@/lib/voice/elevenlabs'
import type { PhoneVoiceOption } from '@/lib/voice/types'

/**
 * Voices the store can choose from for its agent, plus whether audio preview is
 * available. Sourced from the ElevenLabs account when an API key is set,
 * otherwise from the operator's env catalog (flattened — the voice is a single,
 * language-independent choice since the TTS model is multilingual).
 */
export async function listVoiceOptions(): Promise<
  { voices: PhoneVoiceOption[]; previewEnabled: boolean } | { error: string }
> {
  const store = await getCurrentStore()
  if (!store) return { error: 'errors.unauthorized' }

  const plan = await getStorePlan(store.id)
  if (!plan.features.aiPhone) return { error: 'errors.featureNotAvailable' }

  const recommendedIds = getRecommendedVoiceIds()
  const previewEnabled = isVoicePreviewEnabled()

  let voices: PhoneVoiceOption[] = []
  if (previewEnabled) {
    voices = await listElevenLabsVoices()
    // Ensure every recommended voice appears, even if it isn't in the main list.
    const present = new Set(voices.map((v) => v.id))
    const missing = [...recommendedIds].filter((id) => !present.has(id))
    if (missing.length > 0) {
      const extra = await Promise.all(missing.map((id) => fetchVoiceById(id)))
      for (const voice of extra) if (voice) voices.push(voice)
    }
  }

  if (voices.length === 0) {
    const catalog = getVoiceCatalog()
    const seen = new Set<string>()
    for (const list of Object.values(catalog)) {
      for (const voice of list) {
        if (!seen.has(voice.id)) {
          seen.add(voice.id)
          voices.push(voice)
        }
      }
    }
  }

  // Mark recommended voices and float them to the top.
  const marked = voices.map((voice) => ({
    ...voice,
    recommended: recommendedIds.has(voice.id),
  }))
  marked.sort((a, b) => Number(b.recommended) - Number(a.recommended))

  return { voices: marked, previewEnabled }
}
