/**
 * SMS Module - Main Entry Point
 *
 * Export all SMS-related functionality from this file.
 *
 * Usage:
 *   import { sendAccessLinkSms, isSmsConfigured } from '@/lib/sms'
 */

// Client functions
export { sendSms, isSmsConfigured, getSmsConfigStatus, getSmsConfig } from './client'

// High-level send functions
export {
  sendAccessLinkSms,
  sendReservationConfirmationSms,
  sendReminderPickupSms,
  sendReminderReturnSms,
  sendCustomSms,
} from './send'

// Phone validation utilities
export {
  validateAndNormalizePhone,
  isValidPhoneFormat,
  formatPhoneForDisplay,
} from './phone'

// Types
export type { SendSmsOptions, SendSmsResult, SmsProviderType, SmsConfig } from './types'
export type { PhoneValidationResult } from './phone'
export type { SmsSendResult } from './send'
