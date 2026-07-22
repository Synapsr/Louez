import type { AiPhoneSettings } from '@louez/types'

import { isAIChatConfigured } from '@/lib/ai/provider'
import { getStorePlan } from '@/lib/plan-limits'
import { isVoiceConfigured } from '@/lib/voice/client'

/**
 * Whether the AI voice agent is usable at the PLATFORM level: the operator
 * enabled the feature and configured both a telephony provider (voice) and the
 * AI provider. When false, the whole feature is invisible and the webhooks 404.
 */
export function isVoiceAgentConfigured(): boolean {
  return isVoiceConfigured() && isAIChatConfigured()
}

/**
 * Single source of truth for whether the AI voice agent is active for a store:
 * the platform is configured, the store opted in, and the plan includes the
 * feature. Used by the settings page and the inbound webhook.
 */
export async function isVoiceAgentActiveForStore(store: {
  id: string
  aiPhoneSettings: AiPhoneSettings | null
}): Promise<boolean> {
  if (!store.aiPhoneSettings?.enabled || !isVoiceAgentConfigured()) {
    return false
  }
  return (await getStorePlan(store.id)).features.aiPhone
}
