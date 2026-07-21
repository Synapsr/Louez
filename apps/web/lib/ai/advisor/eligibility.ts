import type { AiAdvisorSettings } from '@louez/types'

import { checkAdvisorCredits } from '@/lib/ai/advisor/credits'
import { isAIChatConfigured } from '@/lib/ai/provider'
import { areAiCreditsEnabled } from '@/lib/plans'
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

/**
 * Whether the advisor is actually REACHABLE for a customer right now: active
 * AND (when the credit layer is on) the store still has credits. Used on the
 * checkout path so that an out-of-credits store degrades required-mode
 * verification to fail-open — a checkout must never be blocked by an advisor
 * the customer cannot reach. (The storefront widget itself uses the cheaper
 * isAdvisorActiveForStore and shows a neutral message on exhaustion.)
 */
export async function isAdvisorReachableForStore(store: {
  id: string
  aiAdvisorSettings: AiAdvisorSettings | null
}): Promise<boolean> {
  if (!store.aiAdvisorSettings?.enabled || !isAIChatConfigured()) {
    return false
  }
  const plan = await getStorePlan(store.id)
  if (!plan.features.aiAdvisor) {
    return false
  }
  if (areAiCreditsEnabled()) {
    const check = await checkAdvisorCredits(store.id, plan)
    if (!check.allowed) {
      return false
    }
  }
  return true
}
