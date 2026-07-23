/**
 * Voice Client
 *
 * Main entry point for the telephony layer. The provider is selected via the
 * VOICE_PROVIDER environment variable. Mirrors src/lib/sms/client.ts.
 *
 * Environment variables:
 *   VOICE_PROVIDER: 'twilio' (default: 'twilio')
 *   Twilio: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
 */

import { env } from '@/env'

import { TwilioVoiceProvider } from './providers'
import type { VoiceProvider, VoiceProviderType } from './types'

let providerInstance: VoiceProvider | null = null

function getProviderType(): VoiceProviderType {
  return env.VOICE_PROVIDER ?? 'twilio'
}

function createProvider(type: VoiceProviderType): VoiceProvider {
  switch (type) {
    case 'twilio':
      return new TwilioVoiceProvider()
    default:
      return new TwilioVoiceProvider()
  }
}

/** Configured voice provider instance (lazy-loaded singleton). */
export function getVoiceProvider(): VoiceProvider {
  if (!providerInstance) {
    providerInstance = createProvider(getProviderType())
  }
  return providerInstance
}

/**
 * Whether the telephony layer is usable: the operator flipped AI_PHONE_ENABLED
 * on AND the selected provider has its credentials. This does NOT check the AI
 * layer — see isVoiceAgentConfigured() in lib/ai/phone/eligibility.ts
 * for the full gate.
 */
export function isVoiceConfigured(): boolean {
  if (env.AI_PHONE_ENABLED !== 'true' && env.AI_PHONE_ENABLED !== '1') {
    return false
  }
  return getVoiceProvider().isConfigured()
}

export function getVoiceConfigStatus(): {
  enabled: boolean
  provider: VoiceProviderType
  configured: boolean
  missingVars?: string[]
} {
  const provider = getVoiceProvider()
  return {
    enabled: isVoiceConfigured(),
    provider: provider.name,
    ...provider.getConfigStatus(),
  }
}
