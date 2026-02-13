/**
 * SMS Provider System Types
 *
 * This module defines the types and interfaces for the SMS provider system.
 * The architecture is designed to be extensible, allowing easy addition of
 * new providers (Twilio, Vonage, etc.) via environment variable configuration.
 */

/**
 * Supported SMS provider identifiers
 * Add new providers here as they are implemented
 */
export type SmsProviderType = 'smspartner' | 'twilio' | 'vonage'

/**
 * Options for sending an SMS
 */
export interface SendSmsOptions {
  /** Recipient phone number (international format preferred: +33612345678) */
  to: string
  /** SMS message content */
  message: string
  /** Optional sender name (3-11 characters, alphanumeric only) */
  sender?: string
  /** Whether to append STOP mention for commercial SMS (required in France) */
  isCommercial?: boolean
  /** Test mode - message won't be sent, no charges */
  sandbox?: boolean
}

/**
 * Result of an SMS send operation
 */
export interface SendSmsResult {
  success: boolean
  /** Provider-specific message ID for tracking */
  messageId?: string
  /** Number of SMS segments used */
  smsCount?: number
  /** Cost in provider's currency */
  cost?: number
  /** Currency code (EUR, USD, etc.) */
  currency?: string
  /** Error message if failed */
  error?: string
  /** Provider-specific error code */
  errorCode?: number
}

/**
 * SMS Provider interface
 *
 * All SMS providers must implement this interface.
 * This allows for easy swapping of providers via configuration.
 *
 * To add a new provider:
 * 1. Create a new file in src/lib/sms/providers/ (e.g., twilio.ts)
 * 2. Implement this interface
 * 3. Add the provider to the factory in src/lib/sms/client.ts
 * 4. Add required env vars to .env.example
 */
export interface SmsProvider {
  /** Provider identifier */
  readonly name: SmsProviderType

  /**
   * Send an SMS message
   * @param options - SMS sending options
   * @returns Result of the send operation
   */
  send(options: SendSmsOptions): Promise<SendSmsResult>

  /**
   * Check if the provider is properly configured
   * @returns true if all required environment variables are set
   */
  isConfigured(): boolean

  /**
   * Get the provider's configuration status for diagnostics
   * @returns Object with configuration details (without sensitive data)
   */
  getConfigStatus(): {
    configured: boolean
    missingVars?: string[]
  }
}

/**
 * SMS configuration from environment variables
 */
export interface SmsConfig {
  /** Selected provider type */
  provider: SmsProviderType
  /** Whether SMS is enabled */
  enabled: boolean
  /** Default sender name */
  defaultSender?: string
}
