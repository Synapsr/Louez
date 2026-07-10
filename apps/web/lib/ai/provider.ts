import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'

import { env } from '@/env'

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  google: 'gemini-2.0-flash',
}

function createModel(
  provider: string,
  apiKey: string,
  modelId: string,
): LanguageModel {
  switch (provider) {
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey })
      return anthropic(modelId)
    }
    case 'openai': {
      const openai = createOpenAI({ apiKey })
      return openai(modelId)
    }
    case 'google': {
      const google = createGoogleGenerativeAI({ apiKey })
      return google(modelId)
    }
    default:
      throw new Error(`Unsupported AI provider: ${provider}`)
  }
}

function requireProviderConfig(): { provider: string; apiKey: string } {
  const provider = env.AI_PROVIDER
  const apiKey = env.AI_API_KEY

  if (!provider || !apiKey) {
    throw new Error(
      'AI chat requires AI_PROVIDER and AI_API_KEY environment variables.',
    )
  }

  return { provider, apiKey }
}

/**
 * Create an AI language model from environment variables.
 *
 * Required env vars:
 * - AI_PROVIDER: 'anthropic' | 'openai' | 'google'
 * - AI_API_KEY: The provider's API key
 * - AI_MODEL (optional): Override the default model
 */
export function getAIModel(): LanguageModel {
  const { provider, apiKey } = requireProviderConfig()
  return createModel(provider, apiKey, env.AI_MODEL || DEFAULT_MODELS[provider])
}

/**
 * Model for the storefront AI advisor. Same provider and API key as the
 * dashboard assistant, but the model can be overridden separately
 * (AI_ADVISOR_MODEL) — public traffic usually warrants a cheaper model.
 */
export function getAdvisorAIModel(): LanguageModel {
  const { provider, apiKey } = requireProviderConfig()
  return createModel(
    provider,
    apiKey,
    env.AI_ADVISOR_MODEL || env.AI_MODEL || DEFAULT_MODELS[provider],
  )
}

/**
 * Check if AI chat is configured (all required env vars are set).
 */
export function isAIChatConfigured(): boolean {
  return !!(env.AI_PROVIDER && env.AI_API_KEY)
}
