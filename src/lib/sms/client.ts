/**
 * SMS Client
 *
 * This module provides the main interface for sending SMS messages.
 * The provider is selected via the SMS_PROVIDER environment variable.
 *
 * Usage:
 *   import { sendSms, isSmsConfigured } from '@/lib/sms/client'
 *
 *   if (isSmsConfigured()) {
 *     const result = await sendSms({
 *       to: '+33612345678',
 *       message: 'Hello!',
 *     })
 *   }
 *
 * Environment variables:
 *   SMS_PROVIDER: 'smspartner' | 'twilio' | 'vonage' (default: 'smspartner')
 *   SMS_DEFAULT_SENDER: Default sender name (optional)
 *
 * Provider-specific variables:
 *   SMS Partner: SMS_PARTNER_API_KEY
 *   Twilio: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
 *   Vonage: VONAGE_API_KEY, VONAGE_API_SECRET
 */

import type { SmsProvider, SmsProviderType, SendSmsOptions, SendSmsResult, SmsConfig } from './types'
import { SmsPartnerProvider } from './providers'

// Provider instances cache
let providerInstance: SmsProvider | null = null

/**
 * Get the configured SMS provider type
 */
function getProviderType(): SmsProviderType {
  const provider = process.env.SMS_PROVIDER?.toLowerCase() as SmsProviderType | undefined
  return provider || 'smspartner'
}

/**
 * Create an SMS provider instance based on the configured type
 */
function createProvider(type: SmsProviderType): SmsProvider {
  switch (type) {
    case 'smspartner':
      return new SmsPartnerProvider()

    // Add new providers here:
    // case 'twilio':
    //   return new TwilioProvider()
    // case 'vonage':
    //   return new VonageProvider()

    default:
      console.warn(`Unknown SMS provider: ${type}, falling back to smspartner`)
      return new SmsPartnerProvider()
  }
}

/**
 * Get the configured SMS provider instance (lazy-loaded singleton)
 */
function getProvider(): SmsProvider {
  if (!providerInstance) {
    const type = getProviderType()
    providerInstance = createProvider(type)
  }
  return providerInstance
}

/**
 * Check if SMS is properly configured and ready to use
 */
export function isSmsConfigured(): boolean {
  const provider = getProvider()
  return provider.isConfigured()
}

/**
 * Get SMS configuration status for diagnostics
 */
export function getSmsConfigStatus(): {
  enabled: boolean
  provider: SmsProviderType
  configured: boolean
  missingVars?: string[]
} {
  const provider = getProvider()
  const status = provider.getConfigStatus()

  return {
    enabled: isSmsConfigured(),
    provider: provider.name,
    ...status,
  }
}

/**
 * Get SMS configuration
 */
export function getSmsConfig(): SmsConfig {
  return {
    provider: getProviderType(),
    enabled: isSmsConfigured(),
    defaultSender: process.env.SMS_DEFAULT_SENDER,
  }
}

/**
 * Send an SMS message using the configured provider
 *
 * @param options - SMS sending options
 * @returns Result of the send operation
 *
 * @example
 * const result = await sendSms({
 *   to: '+33612345678',
 *   message: 'Your reservation is confirmed!',
 *   sender: 'MyStore',
 * })
 *
 * if (result.success) {
 *   console.log('SMS sent:', result.messageId)
 * } else {
 *   console.error('SMS failed:', result.error)
 * }
 */
export async function sendSms(options: SendSmsOptions): Promise<SendSmsResult> {
  const provider = getProvider()

  if (!provider.isConfigured()) {
    return {
      success: false,
      error: `SMS provider '${provider.name}' is not configured`,
      errorCode: -1,
    }
  }

  return provider.send(options)
}

/**
 * Re-export types for convenience
 */
export type { SendSmsOptions, SendSmsResult, SmsProviderType, SmsConfig }
