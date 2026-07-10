import type { AiAdvisorSettings } from '@louez/types'

import { isAIChatConfigured } from '@/lib/ai/provider'
import { getStorePlan } from '@/lib/plan-limits'

/**
 * Single source of truth for whether the AI advisor is active for a store:
 * the store opted in, the platform AI is configured, and the plan includes
 * the feature. Used by the storefront layout, the checkout page/action and
 * the chat route — a checkout must never be blocked by an inactive advisor.
 */
export async function isAdvisorActiveForStore(store: {
  id: string
  aiAdvisorSettings: AiAdvisorSettings | null
}): Promise<boolean> {
  if (!store.aiAdvisorSettings?.enabled || !isAIChatConfigured()) {
    return false
  }
  return (await getStorePlan(store.id)).features.aiAdvisor
}
