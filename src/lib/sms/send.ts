/**
 * SMS Sending Functions
 *
 * High-level functions for sending SMS messages with automatic logging.
 * Mirrors the pattern from src/lib/email/send.ts for consistency.
 */

import { db } from '@/lib/db'
import { smsLogs } from '@/lib/db/schema'
import { sendSms, isSmsConfigured } from './client'
import { validateAndNormalizePhone } from './phone'
import { canSendSms } from '@/lib/plan-limits'

/**
 * SMS send result with optional limit info for UI handling
 */
export interface SmsSendResult {
  success: boolean
  error?: string
  limitReached?: boolean
  limitInfo?: {
    current: number
    limit: number
    planSlug: string
  }
}

interface Store {
  id: string
  name: string
}

interface Customer {
  firstName: string
  lastName: string
  phone?: string | null
}

/**
 * Log SMS in database
 */
async function logSms({
  storeId,
  reservationId,
  customerId,
  to,
  message,
  templateType,
  status,
  messageId,
  error,
}: {
  storeId: string
  reservationId?: string
  customerId?: string
  to: string
  message: string
  templateType: string
  status: 'sent' | 'failed'
  messageId?: string
  error?: string
}) {
  try {
    await db.insert(smsLogs).values({
      storeId,
      reservationId: reservationId || null,
      customerId: customerId || null,
      to,
      message,
      templateType,
      status,
      messageId: messageId || null,
      error: error || null,
    })
  } catch (e) {
    console.error('Failed to log SMS:', e)
  }
}

/**
 * Build SMS message with character limit awareness
 * Standard SMS: 160 chars, concatenated SMS: 153 chars per segment
 */
function buildSmsMessage(lines: string[]): string {
  return lines.filter(Boolean).join('\n')
}

/**
 * Send instant access link SMS to customer
 *
 * Sends a short SMS with a direct link to access the reservation.
 */
export async function sendAccessLinkSms({
  store,
  customer,
  reservation,
  accessUrl,
}: {
  store: Store
  customer: Customer & { id: string }
  reservation: {
    id: string
    number: string
  }
  accessUrl: string
}): Promise<SmsSendResult> {
  if (!customer.phone) {
    return { success: false, error: 'Customer has no phone number' }
  }

  if (!isSmsConfigured()) {
    return { success: false, error: 'SMS not configured' }
  }

  // Check SMS limit for the store's plan
  const smsLimit = await canSendSms(store.id)
  if (!smsLimit.allowed) {
    return {
      success: false,
      error: 'SMS limit reached',
      limitReached: true,
      limitInfo: {
        current: smsLimit.current,
        limit: smsLimit.limit!,
        planSlug: smsLimit.planSlug,
      },
    }
  }

  // Validate and normalize phone number
  const phoneValidation = validateAndNormalizePhone(customer.phone)
  if (!phoneValidation.valid || !phoneValidation.normalized) {
    return { success: false, error: phoneValidation.error || 'Invalid phone number format' }
  }
  const normalizedPhone = phoneValidation.normalized

  // Build short message (SMS are limited to 160 chars for single segment)
  const message = buildSmsMessage([
    `${store.name}`,
    `Votre reservation #${reservation.number}`,
    `Acces: ${accessUrl}`,
  ])

  try {
    const result = await sendSms({
      to: normalizedPhone,
      message,
      sender: 'Louez',
    })

    await logSms({
      storeId: store.id,
      reservationId: reservation.id,
      customerId: customer.id,
      to: normalizedPhone,
      message,
      templateType: 'instant_access',
      status: result.success ? 'sent' : 'failed',
      messageId: result.messageId,
      error: result.error,
    })

    if (!result.success) {
      return { success: false, error: result.error }
    }

    return { success: true }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    await logSms({
      storeId: store.id,
      reservationId: reservation.id,
      customerId: customer.id,
      to: normalizedPhone,
      message,
      templateType: 'instant_access',
      status: 'failed',
      error: errorMessage,
    })

    return { success: false, error: errorMessage }
  }
}

/**
 * Send reservation confirmation SMS
 */
export async function sendReservationConfirmationSms({
  store,
  customer,
  reservation,
}: {
  store: Store
  customer: Customer & { id: string }
  reservation: {
    id: string
    number: string
    startDate: Date
    endDate: Date
  }
}): Promise<SmsSendResult> {
  if (!customer.phone) {
    return { success: false, error: 'Customer has no phone number' }
  }

  if (!isSmsConfigured()) {
    return { success: false, error: 'SMS not configured' }
  }

  // Check SMS limit for the store's plan
  const smsLimit = await canSendSms(store.id)
  if (!smsLimit.allowed) {
    return {
      success: false,
      error: 'SMS limit reached',
      limitReached: true,
      limitInfo: {
        current: smsLimit.current,
        limit: smsLimit.limit!,
        planSlug: smsLimit.planSlug,
      },
    }
  }

  // Validate and normalize phone number
  const phoneValidation = validateAndNormalizePhone(customer.phone)
  if (!phoneValidation.valid || !phoneValidation.normalized) {
    return { success: false, error: phoneValidation.error || 'Invalid phone number format' }
  }
  const normalizedPhone = phoneValidation.normalized

  // Format dates
  const startDateStr = reservation.startDate.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
  })
  const endDateStr = reservation.endDate.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
  })

  const message = buildSmsMessage([
    `${store.name}`,
    `Reservation #${reservation.number} confirmee`,
    `Du ${startDateStr} au ${endDateStr}`,
  ])

  try {
    const result = await sendSms({
      to: normalizedPhone,
      message,
      sender: 'Louez',
    })

    await logSms({
      storeId: store.id,
      reservationId: reservation.id,
      customerId: customer.id,
      to: normalizedPhone,
      message,
      templateType: 'reservation_confirmation',
      status: result.success ? 'sent' : 'failed',
      messageId: result.messageId,
      error: result.error,
    })

    if (!result.success) {
      return { success: false, error: result.error }
    }

    return { success: true }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    await logSms({
      storeId: store.id,
      reservationId: reservation.id,
      customerId: customer.id,
      to: normalizedPhone,
      message,
      templateType: 'reservation_confirmation',
      status: 'failed',
      error: errorMessage,
    })

    return { success: false, error: errorMessage }
  }
}

/**
 * Send pickup reminder SMS
 */
export async function sendReminderPickupSms({
  store,
  customer,
  reservation,
}: {
  store: Store
  customer: Customer & { id: string }
  reservation: {
    id: string
    number: string
    startDate: Date
  }
}): Promise<SmsSendResult> {
  if (!customer.phone) {
    return { success: false, error: 'Customer has no phone number' }
  }

  if (!isSmsConfigured()) {
    return { success: false, error: 'SMS not configured' }
  }

  // Check SMS limit for the store's plan
  const smsLimit = await canSendSms(store.id)
  if (!smsLimit.allowed) {
    return {
      success: false,
      error: 'SMS limit reached',
      limitReached: true,
      limitInfo: {
        current: smsLimit.current,
        limit: smsLimit.limit!,
        planSlug: smsLimit.planSlug,
      },
    }
  }

  // Validate and normalize phone number
  const phoneValidation = validateAndNormalizePhone(customer.phone)
  if (!phoneValidation.valid || !phoneValidation.normalized) {
    return { success: false, error: phoneValidation.error || 'Invalid phone number format' }
  }
  const normalizedPhone = phoneValidation.normalized

  const startDateStr = reservation.startDate.toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  })

  const message = buildSmsMessage([
    `${store.name}`,
    `Rappel: retrait reservation #${reservation.number}`,
    `Le ${startDateStr}`,
  ])

  try {
    const result = await sendSms({
      to: normalizedPhone,
      message,
      sender: 'Louez',
    })

    await logSms({
      storeId: store.id,
      reservationId: reservation.id,
      customerId: customer.id,
      to: normalizedPhone,
      message,
      templateType: 'reminder_pickup',
      status: result.success ? 'sent' : 'failed',
      messageId: result.messageId,
      error: result.error,
    })

    if (!result.success) {
      return { success: false, error: result.error }
    }

    return { success: true }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    await logSms({
      storeId: store.id,
      reservationId: reservation.id,
      customerId: customer.id,
      to: normalizedPhone,
      message,
      templateType: 'reminder_pickup',
      status: 'failed',
      error: errorMessage,
    })

    return { success: false, error: errorMessage }
  }
}

/**
 * Send return reminder SMS
 */
export async function sendReminderReturnSms({
  store,
  customer,
  reservation,
}: {
  store: Store
  customer: Customer & { id: string }
  reservation: {
    id: string
    number: string
    endDate: Date
  }
}): Promise<SmsSendResult> {
  if (!customer.phone) {
    return { success: false, error: 'Customer has no phone number' }
  }

  if (!isSmsConfigured()) {
    return { success: false, error: 'SMS not configured' }
  }

  // Check SMS limit for the store's plan
  const smsLimit = await canSendSms(store.id)
  if (!smsLimit.allowed) {
    return {
      success: false,
      error: 'SMS limit reached',
      limitReached: true,
      limitInfo: {
        current: smsLimit.current,
        limit: smsLimit.limit!,
        planSlug: smsLimit.planSlug,
      },
    }
  }

  // Validate and normalize phone number
  const phoneValidation = validateAndNormalizePhone(customer.phone)
  if (!phoneValidation.valid || !phoneValidation.normalized) {
    return { success: false, error: phoneValidation.error || 'Invalid phone number format' }
  }
  const normalizedPhone = phoneValidation.normalized

  const endDateStr = reservation.endDate.toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  })

  const message = buildSmsMessage([
    `${store.name}`,
    `Rappel: retour reservation #${reservation.number}`,
    `Le ${endDateStr}`,
  ])

  try {
    const result = await sendSms({
      to: normalizedPhone,
      message,
      sender: 'Louez',
    })

    await logSms({
      storeId: store.id,
      reservationId: reservation.id,
      customerId: customer.id,
      to: normalizedPhone,
      message,
      templateType: 'reminder_return',
      status: result.success ? 'sent' : 'failed',
      messageId: result.messageId,
      error: result.error,
    })

    if (!result.success) {
      return { success: false, error: result.error }
    }

    return { success: true }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    await logSms({
      storeId: store.id,
      reservationId: reservation.id,
      customerId: customer.id,
      to: normalizedPhone,
      message,
      templateType: 'reminder_return',
      status: 'failed',
      error: errorMessage,
    })

    return { success: false, error: errorMessage }
  }
}

/**
 * Send custom SMS message
 */
export async function sendCustomSms({
  store,
  customer,
  reservation,
  message: customMessage,
}: {
  store: Store
  customer: Customer & { id: string }
  reservation?: {
    id: string
    number: string
  }
  message: string
}): Promise<SmsSendResult> {
  if (!customer.phone) {
    return { success: false, error: 'Customer has no phone number' }
  }

  if (!isSmsConfigured()) {
    return { success: false, error: 'SMS not configured' }
  }

  // Check SMS limit for the store's plan
  const smsLimit = await canSendSms(store.id)
  if (!smsLimit.allowed) {
    return {
      success: false,
      error: 'SMS limit reached',
      limitReached: true,
      limitInfo: {
        current: smsLimit.current,
        limit: smsLimit.limit!,
        planSlug: smsLimit.planSlug,
      },
    }
  }

  // Validate and normalize phone number
  const phoneValidation = validateAndNormalizePhone(customer.phone)
  if (!phoneValidation.valid || !phoneValidation.normalized) {
    return { success: false, error: phoneValidation.error || 'Invalid phone number format' }
  }
  const normalizedPhone = phoneValidation.normalized

  const message = buildSmsMessage([`${store.name}`, customMessage])

  try {
    const result = await sendSms({
      to: normalizedPhone,
      message,
      sender: 'Louez',
    })

    await logSms({
      storeId: store.id,
      reservationId: reservation?.id,
      customerId: customer.id,
      to: normalizedPhone,
      message,
      templateType: 'custom',
      status: result.success ? 'sent' : 'failed',
      messageId: result.messageId,
      error: result.error,
    })

    if (!result.success) {
      return { success: false, error: result.error }
    }

    return { success: true }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    await logSms({
      storeId: store.id,
      reservationId: reservation?.id,
      customerId: customer.id,
      to: normalizedPhone,
      message,
      templateType: 'custom',
      status: 'failed',
      error: errorMessage,
    })

    return { success: false, error: errorMessage }
  }
}

// Re-export client functions for convenience
export { isSmsConfigured, getSmsConfigStatus } from './client'
