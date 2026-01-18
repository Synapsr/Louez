/**
 * SMS Partner Provider Implementation
 *
 * SMS Partner is a French SMS API service.
 * Documentation: https://docpartner.dev/api/sms-partner
 *
 * Environment variables required:
 * - SMS_PARTNER_API_KEY: Your SMS Partner API key
 */

import type { SmsProvider, SendSmsOptions, SendSmsResult } from '../types'
import { validateAndNormalizePhone } from '../phone'

const API_ENDPOINT = 'https://api.smspartner.fr/v1/send'

/**
 * GSM 7-bit character set (basic + extended)
 * Characters outside this set require Unicode encoding
 */
const GSM_BASIC_CHARS = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
const GSM_EXTENDED_CHARS = '^{}\\[~]|€'

/**
 * Check if message contains characters that require Unicode encoding
 */
function requiresUnicode(message: string): boolean {
  const allGsmChars = GSM_BASIC_CHARS + GSM_EXTENDED_CHARS
  for (const char of message) {
    if (!allGsmChars.includes(char)) {
      return true
    }
  }
  return false
}

interface SmsPartnerResponse {
  success: boolean
  code: number
  message_id?: number
  nb_sms?: number
  cost?: number
  currency?: string
  error?: string
}

export class SmsPartnerProvider implements SmsProvider {
  readonly name = 'smspartner' as const

  private getApiKey(): string | undefined {
    return process.env.SMS_PARTNER_API_KEY
  }

  isConfigured(): boolean {
    return !!this.getApiKey()
  }

  getConfigStatus(): { configured: boolean; missingVars?: string[] } {
    const missingVars: string[] = []

    if (!process.env.SMS_PARTNER_API_KEY) {
      missingVars.push('SMS_PARTNER_API_KEY')
    }

    return {
      configured: missingVars.length === 0,
      missingVars: missingVars.length > 0 ? missingVars : undefined,
    }
  }

  async send(options: SendSmsOptions): Promise<SendSmsResult> {
    const apiKey = this.getApiKey()

    if (!apiKey) {
      return {
        success: false,
        error: 'SMS Partner API key not configured',
        errorCode: -1,
      }
    }

    // Validate and normalize phone number
    const phoneValidation = validateAndNormalizePhone(options.to)
    if (!phoneValidation.valid || !phoneValidation.normalized) {
      return {
        success: false,
        error: phoneValidation.error || 'Invalid phone number',
        errorCode: 12, // Same as SMS Partner's invalid phone code
      }
    }
    const phoneNumber = phoneValidation.normalized

    // Build request payload
    const payload: Record<string, unknown> = {
      apiKey,
      phoneNumbers: phoneNumber,
      message: options.message,
    }

    // Add sender if provided
    const sender = options.sender || process.env.SMS_DEFAULT_SENDER
    if (sender) {
      // SMS Partner requires sender to be 3-11 alphanumeric characters
      const sanitizedSender = sender.replace(/[^a-zA-Z0-9]/g, '').slice(0, 11)
      if (sanitizedSender.length >= 3) {
        payload.sender = sanitizedSender
      }
    }

    // Add STOP mention for commercial SMS (required in France)
    if (options.isCommercial) {
      payload.isStopSms = 1
    }

    // Enable sandbox mode for testing
    if (options.sandbox) {
      payload.sandbox = 1
    }

    // Enable Unicode for messages with special characters (€, accents, etc.)
    // Unicode SMS are limited to 70 chars (vs 160 for GSM-7)
    if (requiresUnicode(options.message)) {
      payload.isUnicode = 1
    }

    try {
      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(payload),
      })

      const data: SmsPartnerResponse = await response.json()

      if (data.success && data.code === 200) {
        return {
          success: true,
          messageId: data.message_id?.toString(),
          smsCount: data.nb_sms,
          cost: data.cost,
          currency: data.currency,
        }
      }

      // Handle specific error codes
      const errorMessage = this.getErrorMessage(data.code, data.error)

      return {
        success: false,
        error: errorMessage,
        errorCode: data.code,
      }
    } catch (error) {
      console.error('SMS Partner API error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorCode: -1,
      }
    }
  }

  /**
   * Get human-readable error message from SMS Partner error codes
   */
  private getErrorMessage(code: number, fallback?: string): string {
    const errorMessages: Record<number, string> = {
      10: 'Invalid API key',
      11: 'Insufficient credits',
      12: 'Invalid phone number',
      13: 'Message too long',
      14: 'Invalid sender',
      15: 'Sending not allowed at this time (commercial SMS: 8h-20h)',
      16: 'Phone number blacklisted',
      17: 'Invalid scheduled date',
      18: 'Duplicate message detected',
      19: 'Rate limit exceeded',
      20: 'Account suspended',
    }

    return errorMessages[code] || fallback || `SMS Partner error (code: ${code})`
  }
}
