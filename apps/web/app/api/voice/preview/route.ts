import { getStorePlan } from '@/lib/plan-limits'
import { getCurrentStore } from '@/lib/store-context'
import { fetchVoicePreview } from '@/lib/voice/elevenlabs'

// Dashboard-only: streams a spoken sample of a voice (in the chosen language,
// cached; free static fallback) so the store can hear it before choosing.
// Session-authenticated and gated by the aiPhone plan; the key stays server-side.

export async function GET(req: Request) {
  const store = await getCurrentStore()
  if (!store) return new Response('Unauthorized', { status: 401 })

  const plan = await getStorePlan(store.id)
  if (!plan.features.aiPhone) {
    return new Response('Forbidden', { status: 403 })
  }

  const params = new URL(req.url).searchParams
  const voiceId = (params.get('voiceId') ?? '').trim()
  const language = (params.get('language') ?? 'en').trim().slice(0, 5)
  if (!voiceId || voiceId.length > 80) {
    return new Response('Bad request', { status: 400 })
  }

  return fetchVoicePreview(voiceId, language)
}
