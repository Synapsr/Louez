import { getStorePlan } from '@/lib/plan-limits'
import { getCurrentStore } from '@/lib/store-context'
import { fetchVoicePreview } from '@/lib/voice/elevenlabs'

// Dashboard-only: streams a voice's static preview sample so the store can hear
// it before choosing. Uses no TTS credits (proxies the voice's preview_url).
// Session-authenticated and gated by the aiPhone plan; the key stays server-side.

export async function GET(req: Request) {
  const store = await getCurrentStore()
  if (!store) return new Response('Unauthorized', { status: 401 })

  const plan = await getStorePlan(store.id)
  if (!plan.features.aiPhone) {
    return new Response('Forbidden', { status: 403 })
  }

  const voiceId = (new URL(req.url).searchParams.get('voiceId') ?? '').trim()
  if (!voiceId || voiceId.length > 80) {
    return new Response('Bad request', { status: 400 })
  }

  return fetchVoicePreview(voiceId)
}
