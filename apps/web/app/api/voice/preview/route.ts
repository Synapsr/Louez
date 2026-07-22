import { getStorePlan } from '@/lib/plan-limits'
import { getCurrentStore } from '@/lib/store-context'
import { generateVoiceSample } from '@/lib/voice/elevenlabs'

// Dashboard-only: streams a short spoken sample of a voice in a language, so the
// store can hear a voice before choosing it. Session-authenticated and gated by
// the aiPhone plan; the ElevenLabs key stays server-side.

export async function GET(req: Request) {
  const store = await getCurrentStore()
  if (!store) return new Response('Unauthorized', { status: 401 })

  const plan = await getStorePlan(store.id)
  if (!plan.features.aiPhone) {
    return new Response('Forbidden', { status: 403 })
  }

  const url = new URL(req.url)
  const voiceId = (url.searchParams.get('voiceId') ?? '').trim()
  const language = (url.searchParams.get('language') ?? 'en').trim()
  if (!voiceId || voiceId.length > 80) {
    return new Response('Bad request', { status: 400 })
  }

  return generateVoiceSample(voiceId, language)
}
