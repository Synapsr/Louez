'use server'

import { getStorePlan } from '@/lib/plan-limits'
import { getCurrentStore } from '@/lib/store-context'
import { getVoiceCatalog } from '@/lib/voice/config'
import {
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

  const previewEnabled = isVoicePreviewEnabled()
  if (previewEnabled) {
    const voices = await listElevenLabsVoices()
    if (voices.length > 0) return { voices, previewEnabled: true }
  }

  const catalog = getVoiceCatalog()
  const seen = new Set<string>()
  const voices: PhoneVoiceOption[] = []
  for (const list of Object.values(catalog)) {
    for (const voice of list) {
      if (!seen.has(voice.id)) {
        seen.add(voice.id)
        voices.push(voice)
      }
    }
  }
  return { voices, previewEnabled }
}
