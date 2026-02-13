/**
 * SMS Sending Functions
 *
 * High-level functions for sending SMS messages with automatic logging.
 * Mirrors the pattern from src/lib/email/send.ts for consistency.
 */

import { db } from '@louez/db'
import { smsLogs } from '@louez/db'
import { sendSms, isSmsConfigured } from './client'
import { validateAndNormalizePhone } from './phone'
import {
  getSmsQuotaStatus,
  determineSmsSource,
  deductPrepaidSmsCredit,
} from '@/lib/plan-limits'
import { getEmailMessages, getLocaleFromCountry, type EmailLocale } from '@/lib/email/i18n'

/**
 * Localized SMS templates for customer notifications
 * Keep messages short - SMS are limited to 160 chars for single segment
 */
const SMS_TEMPLATES: Record<EmailLocale, {
  reservation_confirmation: (vars: { storeName: string; number: string; startDate: string; endDate: string }) => string
  reminder_pickup: (vars: { storeName: string; number: string; date: string }) => string
  reminder_return: (vars: { storeName: string; number: string; date: string }) => string
  request_received: (vars: { storeName: string; number: string }) => string
  request_accepted: (vars: { storeName: string; number: string }) => string
  request_rejected: (vars: { storeName: string; number: string }) => string
  instant_access: (vars: { storeName: string; number: string; url: string }) => string
  payment_request: (vars: { storeName: string; number: string; amount: string; url: string }) => string
  deposit_authorization_request: (vars: { storeName: string; number: string; amount: string; url: string }) => string
}> = {
  fr: {
    reservation_confirmation: ({ storeName, number, startDate, endDate }) =>
      `${storeName}\nRéservation #${number} confirmée\nDu ${startDate} au ${endDate}`,
    reminder_pickup: ({ storeName, number, date }) =>
      `${storeName}\nRappel: retrait réservation #${number}\nLe ${date}`,
    reminder_return: ({ storeName, number, date }) =>
      `${storeName}\nRappel: retour réservation #${number}\nLe ${date}`,
    request_received: ({ storeName, number }) =>
      `${storeName}\nDemande #${number} reçue. Confirmation sous 24h.`,
    request_accepted: ({ storeName, number }) =>
      `${storeName}\nDemande #${number} acceptée! Consultez vos emails.`,
    request_rejected: ({ storeName, number }) =>
      `${storeName}\nDemande #${number} non disponible. Contactez-nous.`,
    instant_access: ({ storeName, number, url }) =>
      `${storeName}\nVotre réservation #${number}\nAccès: ${url}`,
    payment_request: ({ storeName, number, amount, url }) =>
      `${storeName}\nPaiement de ${amount} demandé pour #${number}\n${url}`,
    deposit_authorization_request: ({ storeName, number, amount, url }) =>
      `${storeName}\nCaution de ${amount} à autoriser pour #${number}\n${url}`,
  },
  en: {
    reservation_confirmation: ({ storeName, number, startDate, endDate }) =>
      `${storeName}\nReservation #${number} confirmed\nFrom ${startDate} to ${endDate}`,
    reminder_pickup: ({ storeName, number, date }) =>
      `${storeName}\nReminder: pickup for #${number}\nOn ${date}`,
    reminder_return: ({ storeName, number, date }) =>
      `${storeName}\nReminder: return for #${number}\nOn ${date}`,
    request_received: ({ storeName, number }) =>
      `${storeName}\nRequest #${number} received. Confirmation within 24h.`,
    request_accepted: ({ storeName, number }) =>
      `${storeName}\nRequest #${number} accepted! Check your email.`,
    request_rejected: ({ storeName, number }) =>
      `${storeName}\nRequest #${number} unavailable. Contact us.`,
    instant_access: ({ storeName, number, url }) =>
      `${storeName}\nYour reservation #${number}\nAccess: ${url}`,
    payment_request: ({ storeName, number, amount, url }) =>
      `${storeName}\nPayment of ${amount} requested for #${number}\n${url}`,
    deposit_authorization_request: ({ storeName, number, amount, url }) =>
      `${storeName}\nDeposit of ${amount} to authorize for #${number}\n${url}`,
  },
  de: {
    reservation_confirmation: ({ storeName, number, startDate, endDate }) =>
      `${storeName}\nReservierung #${number} bestaetigt\nVom ${startDate} bis ${endDate}`,
    reminder_pickup: ({ storeName, number, date }) =>
      `${storeName}\nErinnerung: Abholung #${number}\nAm ${date}`,
    reminder_return: ({ storeName, number, date }) =>
      `${storeName}\nErinnerung: Rueckgabe #${number}\nAm ${date}`,
    request_received: ({ storeName, number }) =>
      `${storeName}\nAnfrage #${number} erhalten. Bestaetigung in 24h.`,
    request_accepted: ({ storeName, number }) =>
      `${storeName}\nAnfrage #${number} akzeptiert! E-Mail pruefen.`,
    request_rejected: ({ storeName, number }) =>
      `${storeName}\nAnfrage #${number} nicht verfuegbar. Kontaktieren Sie uns.`,
    instant_access: ({ storeName, number, url }) =>
      `${storeName}\nIhre Reservierung #${number}\nZugang: ${url}`,
    payment_request: ({ storeName, number, amount, url }) =>
      `${storeName}\nZahlung von ${amount} fuer #${number} angefordert\n${url}`,
    deposit_authorization_request: ({ storeName, number, amount, url }) =>
      `${storeName}\nKaution von ${amount} fuer #${number} freizugeben\n${url}`,
  },
  es: {
    reservation_confirmation: ({ storeName, number, startDate, endDate }) =>
      `${storeName}\nReserva #${number} confirmada\nDel ${startDate} al ${endDate}`,
    reminder_pickup: ({ storeName, number, date }) =>
      `${storeName}\nRecordatorio: recogida #${number}\nEl ${date}`,
    reminder_return: ({ storeName, number, date }) =>
      `${storeName}\nRecordatorio: devolucion #${number}\nEl ${date}`,
    request_received: ({ storeName, number }) =>
      `${storeName}\nSolicitud #${number} recibida. Confirmacion en 24h.`,
    request_accepted: ({ storeName, number }) =>
      `${storeName}\nSolicitud #${number} aceptada! Revisa tu email.`,
    request_rejected: ({ storeName, number }) =>
      `${storeName}\nSolicitud #${number} no disponible. Contactenos.`,
    instant_access: ({ storeName, number, url }) =>
      `${storeName}\nTu reserva #${number}\nAcceso: ${url}`,
    payment_request: ({ storeName, number, amount, url }) =>
      `${storeName}\nPago de ${amount} solicitado para #${number}\n${url}`,
    deposit_authorization_request: ({ storeName, number, amount, url }) =>
      `${storeName}\nDeposito de ${amount} a autorizar para #${number}\n${url}`,
  },
  it: {
    reservation_confirmation: ({ storeName, number, startDate, endDate }) =>
      `${storeName}\nPrenotazione #${number} confermata\nDal ${startDate} al ${endDate}`,
    reminder_pickup: ({ storeName, number, date }) =>
      `${storeName}\nPromemoria: ritiro #${number}\nIl ${date}`,
    reminder_return: ({ storeName, number, date }) =>
      `${storeName}\nPromemoria: restituzione #${number}\nIl ${date}`,
    request_received: ({ storeName, number }) =>
      `${storeName}\nRichiesta #${number} ricevuta. Conferma entro 24h.`,
    request_accepted: ({ storeName, number }) =>
      `${storeName}\nRichiesta #${number} accettata! Controlla email.`,
    request_rejected: ({ storeName, number }) =>
      `${storeName}\nRichiesta #${number} non disponibile. Contattaci.`,
    instant_access: ({ storeName, number, url }) =>
      `${storeName}\nLa tua prenotazione #${number}\nAccesso: ${url}`,
    payment_request: ({ storeName, number, amount, url }) =>
      `${storeName}\nPagamento di ${amount} richiesto per #${number}\n${url}`,
    deposit_authorization_request: ({ storeName, number, amount, url }) =>
      `${storeName}\nDeposito di ${amount} da autorizzare per #${number}\n${url}`,
  },
  nl: {
    reservation_confirmation: ({ storeName, number, startDate, endDate }) =>
      `${storeName}\nReservering #${number} bevestigd\nVan ${startDate} tot ${endDate}`,
    reminder_pickup: ({ storeName, number, date }) =>
      `${storeName}\nHerinnering: ophalen #${number}\nOp ${date}`,
    reminder_return: ({ storeName, number, date }) =>
      `${storeName}\nHerinnering: terugbrengen #${number}\nOp ${date}`,
    request_received: ({ storeName, number }) =>
      `${storeName}\nAanvraag #${number} ontvangen. Bevestiging binnen 24u.`,
    request_accepted: ({ storeName, number }) =>
      `${storeName}\nAanvraag #${number} geaccepteerd! Check je email.`,
    request_rejected: ({ storeName, number }) =>
      `${storeName}\nAanvraag #${number} niet beschikbaar. Neem contact op.`,
    instant_access: ({ storeName, number, url }) =>
      `${storeName}\nUw reservering #${number}\nToegang: ${url}`,
    payment_request: ({ storeName, number, amount, url }) =>
      `${storeName}\nBetaling van ${amount} gevraagd voor #${number}\n${url}`,
    deposit_authorization_request: ({ storeName, number, amount, url }) =>
      `${storeName}\nBorg van ${amount} te autoriseren voor #${number}\n${url}`,
  },
  pl: {
    reservation_confirmation: ({ storeName, number, startDate, endDate }) =>
      `${storeName}\nRezerwacja #${number} potwierdzona\nOd ${startDate} do ${endDate}`,
    reminder_pickup: ({ storeName, number, date }) =>
      `${storeName}\nPrzypomnienie: odbior #${number}\nDnia ${date}`,
    reminder_return: ({ storeName, number, date }) =>
      `${storeName}\nPrzypomnienie: zwrot #${number}\nDnia ${date}`,
    request_received: ({ storeName, number }) =>
      `${storeName}\nZamowienie #${number} otrzymane. Potwierdzenie w 24h.`,
    request_accepted: ({ storeName, number }) =>
      `${storeName}\nZamowienie #${number} zaakceptowane! Sprawdz email.`,
    request_rejected: ({ storeName, number }) =>
      `${storeName}\nZamowienie #${number} niedostepne. Skontaktuj sie.`,
    instant_access: ({ storeName, number, url }) =>
      `${storeName}\nTwoja rezerwacja #${number}\nDostep: ${url}`,
    payment_request: ({ storeName, number, amount, url }) =>
      `${storeName}\nPlatnosc ${amount} wymagana dla #${number}\n${url}`,
    deposit_authorization_request: ({ storeName, number, amount, url }) =>
      `${storeName}\nKaucja ${amount} do autoryzacji dla #${number}\n${url}`,
  },
  pt: {
    reservation_confirmation: ({ storeName, number, startDate, endDate }) =>
      `${storeName}\nReserva #${number} confirmada\nDe ${startDate} a ${endDate}`,
    reminder_pickup: ({ storeName, number, date }) =>
      `${storeName}\nLembrete: retirada #${number}\nEm ${date}`,
    reminder_return: ({ storeName, number, date }) =>
      `${storeName}\nLembrete: devolucao #${number}\nEm ${date}`,
    request_received: ({ storeName, number }) =>
      `${storeName}\nPedido #${number} recebido. Confirmacao em 24h.`,
    request_accepted: ({ storeName, number }) =>
      `${storeName}\nPedido #${number} aceito! Verifique seu email.`,
    request_rejected: ({ storeName, number }) =>
      `${storeName}\nPedido #${number} indisponivel. Entre em contato.`,
    instant_access: ({ storeName, number, url }) =>
      `${storeName}\nSua reserva #${number}\nAcesso: ${url}`,
    payment_request: ({ storeName, number, amount, url }) =>
      `${storeName}\nPagamento de ${amount} solicitado para #${number}\n${url}`,
    deposit_authorization_request: ({ storeName, number, amount, url }) =>
      `${storeName}\nDeposito de ${amount} a autorizar para #${number}\n${url}`,
  },
}

/**
 * Get SMS template for a specific locale, falling back to English
 */
function getSmsTemplate(locale: EmailLocale = 'en') {
  return SMS_TEMPLATES[locale] || SMS_TEMPLATES.en
}

/**
 * Format date for SMS based on locale
 */
function formatSmsDate(date: Date, locale: EmailLocale): string {
  const localeMap: Record<EmailLocale, string> = {
    fr: 'fr-FR',
    en: 'en-US',
    de: 'de-DE',
    es: 'es-ES',
    it: 'it-IT',
    nl: 'nl-NL',
    pl: 'pl-PL',
    pt: 'pt-BR',
  }

  return date.toLocaleDateString(localeMap[locale] || 'en-US', {
    day: '2-digit',
    month: '2-digit',
  })
}

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
  settings?: {
    country?: string
  } | null
}

interface Customer {
  firstName: string
  lastName: string
  phone?: string | null
}

/**
 * Log SMS in database with credit source tracking
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
  creditSource = 'plan',
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
  creditSource?: 'plan' | 'topup'
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
      creditSource,
    })
  } catch (e) {
    console.error('Failed to log SMS:', e)
  }
}

/**
 * Check SMS quota and determine credit source
 * Returns error result if quota exceeded
 */
async function checkSmsQuotaAndSource(storeId: string): Promise<{
  allowed: boolean
  creditSource: 'plan' | 'topup'
  error?: SmsSendResult
}> {
  const quota = await getSmsQuotaStatus(storeId)

  if (!quota.allowed) {
    return {
      allowed: false,
      creditSource: 'plan',
      error: {
        success: false,
        error: 'SMS limit reached',
        limitReached: true,
        limitInfo: {
          current: quota.current,
          limit: quota.planLimit ?? 0,
          planSlug: quota.planSlug,
        },
      },
    }
  }

  const creditSource = await determineSmsSource(storeId)
  return { allowed: true, creditSource }
}

/**
 * Handle post-send operations (deduct prepaid credit if needed)
 */
async function handlePostSend(storeId: string, creditSource: 'plan' | 'topup', success: boolean) {
  if (success && creditSource === 'topup') {
    await deductPrepaidSmsCredit(storeId)
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

  // Check SMS quota (includes plan limit + prepaid credits)
  const quotaCheck = await checkSmsQuotaAndSource(store.id)
  if (!quotaCheck.allowed) {
    return quotaCheck.error!
  }
  const { creditSource } = quotaCheck

  // Validate and normalize phone number
  const phoneValidation = validateAndNormalizePhone(customer.phone)
  if (!phoneValidation.valid || !phoneValidation.normalized) {
    return { success: false, error: phoneValidation.error || 'Invalid phone number format' }
  }
  const normalizedPhone = phoneValidation.normalized

  // Get locale from store country
  const locale = getLocaleFromCountry(store.settings?.country)
  const templates = getSmsTemplate(locale)

  // Build localized message (SMS are limited to 160 chars for single segment)
  const message = templates.instant_access({
    storeName: store.name,
    number: reservation.number,
    url: accessUrl,
  })

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
      creditSource,
    })

    // Deduct prepaid credit if needed
    await handlePostSend(store.id, creditSource, result.success)

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
      creditSource,
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

  // Check SMS quota (includes plan limit + prepaid credits)
  const quotaCheck = await checkSmsQuotaAndSource(store.id)
  if (!quotaCheck.allowed) {
    return quotaCheck.error!
  }
  const { creditSource } = quotaCheck

  // Validate and normalize phone number
  const phoneValidation = validateAndNormalizePhone(customer.phone)
  if (!phoneValidation.valid || !phoneValidation.normalized) {
    return { success: false, error: phoneValidation.error || 'Invalid phone number format' }
  }
  const normalizedPhone = phoneValidation.normalized

  // Get locale from store country
  const locale = getLocaleFromCountry(store.settings?.country)
  const templates = getSmsTemplate(locale)

  // Format dates for locale
  const startDateStr = formatSmsDate(reservation.startDate, locale)
  const endDateStr = formatSmsDate(reservation.endDate, locale)

  const message = templates.reservation_confirmation({
    storeName: store.name,
    number: reservation.number,
    startDate: startDateStr,
    endDate: endDateStr,
  })

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
      creditSource,
    })

    // Deduct prepaid credit if needed
    await handlePostSend(store.id, creditSource, result.success)

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
      creditSource,
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

  // Check SMS quota (includes plan limit + prepaid credits)
  const quotaCheck = await checkSmsQuotaAndSource(store.id)
  if (!quotaCheck.allowed) {
    return quotaCheck.error!
  }
  const { creditSource } = quotaCheck

  // Validate and normalize phone number
  const phoneValidation = validateAndNormalizePhone(customer.phone)
  if (!phoneValidation.valid || !phoneValidation.normalized) {
    return { success: false, error: phoneValidation.error || 'Invalid phone number format' }
  }
  const normalizedPhone = phoneValidation.normalized

  // Get locale from store country
  const locale = getLocaleFromCountry(store.settings?.country)
  const templates = getSmsTemplate(locale)

  // Format date for locale (with weekday for reminders)
  const startDateStr = reservation.startDate.toLocaleDateString(
    locale === 'fr' ? 'fr-FR' : locale === 'de' ? 'de-DE' : locale === 'es' ? 'es-ES' :
    locale === 'it' ? 'it-IT' : locale === 'nl' ? 'nl-NL' : locale === 'pl' ? 'pl-PL' :
    locale === 'pt' ? 'pt-BR' : 'en-US',
    { weekday: 'short', day: '2-digit', month: '2-digit' }
  )

  const message = templates.reminder_pickup({
    storeName: store.name,
    number: reservation.number,
    date: startDateStr,
  })

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
      creditSource,
    })

    // Deduct prepaid credit if needed
    await handlePostSend(store.id, creditSource, result.success)

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
      creditSource,
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

  // Check SMS quota (includes plan limit + prepaid credits)
  const quotaCheck = await checkSmsQuotaAndSource(store.id)
  if (!quotaCheck.allowed) {
    return quotaCheck.error!
  }
  const { creditSource } = quotaCheck

  // Validate and normalize phone number
  const phoneValidation = validateAndNormalizePhone(customer.phone)
  if (!phoneValidation.valid || !phoneValidation.normalized) {
    return { success: false, error: phoneValidation.error || 'Invalid phone number format' }
  }
  const normalizedPhone = phoneValidation.normalized

  // Get locale from store country
  const locale = getLocaleFromCountry(store.settings?.country)
  const templates = getSmsTemplate(locale)

  // Format date for locale (with weekday for reminders)
  const endDateStr = reservation.endDate.toLocaleDateString(
    locale === 'fr' ? 'fr-FR' : locale === 'de' ? 'de-DE' : locale === 'es' ? 'es-ES' :
    locale === 'it' ? 'it-IT' : locale === 'nl' ? 'nl-NL' : locale === 'pl' ? 'pl-PL' :
    locale === 'pt' ? 'pt-BR' : 'en-US',
    { weekday: 'short', day: '2-digit', month: '2-digit' }
  )

  const message = templates.reminder_return({
    storeName: store.name,
    number: reservation.number,
    date: endDateStr,
  })

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
      creditSource,
    })

    // Deduct prepaid credit if needed
    await handlePostSend(store.id, creditSource, result.success)

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
      creditSource,
    })

    return { success: false, error: errorMessage }
  }
}

/**
 * Send request received SMS to customer
 */
export async function sendRequestReceivedSms({
  store,
  customer,
  reservation,
}: {
  store: Store
  customer: Customer & { id: string }
  reservation: {
    id: string
    number: string
  }
}): Promise<SmsSendResult> {
  if (!customer.phone) {
    return { success: false, error: 'Customer has no phone number' }
  }

  if (!isSmsConfigured()) {
    return { success: false, error: 'SMS not configured' }
  }

  // Check SMS quota
  const quotaCheck = await checkSmsQuotaAndSource(store.id)
  if (!quotaCheck.allowed) {
    return quotaCheck.error!
  }
  const { creditSource } = quotaCheck

  // Validate and normalize phone number
  const phoneValidation = validateAndNormalizePhone(customer.phone)
  if (!phoneValidation.valid || !phoneValidation.normalized) {
    return { success: false, error: phoneValidation.error || 'Invalid phone number format' }
  }
  const normalizedPhone = phoneValidation.normalized

  // Get locale from store country
  const locale = getLocaleFromCountry(store.settings?.country)
  const templates = getSmsTemplate(locale)

  const message = templates.request_received({
    storeName: store.name,
    number: reservation.number,
  })

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
      templateType: 'request_received',
      status: result.success ? 'sent' : 'failed',
      messageId: result.messageId,
      error: result.error,
      creditSource,
    })

    await handlePostSend(store.id, creditSource, result.success)

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
      templateType: 'request_received',
      status: 'failed',
      error: errorMessage,
      creditSource,
    })

    return { success: false, error: errorMessage }
  }
}

/**
 * Send request accepted SMS to customer
 */
export async function sendRequestAcceptedSms({
  store,
  customer,
  reservation,
}: {
  store: Store
  customer: Customer & { id: string }
  reservation: {
    id: string
    number: string
  }
}): Promise<SmsSendResult> {
  if (!customer.phone) {
    return { success: false, error: 'Customer has no phone number' }
  }

  if (!isSmsConfigured()) {
    return { success: false, error: 'SMS not configured' }
  }

  // Check SMS quota
  const quotaCheck = await checkSmsQuotaAndSource(store.id)
  if (!quotaCheck.allowed) {
    return quotaCheck.error!
  }
  const { creditSource } = quotaCheck

  // Validate and normalize phone number
  const phoneValidation = validateAndNormalizePhone(customer.phone)
  if (!phoneValidation.valid || !phoneValidation.normalized) {
    return { success: false, error: phoneValidation.error || 'Invalid phone number format' }
  }
  const normalizedPhone = phoneValidation.normalized

  // Get locale from store country
  const locale = getLocaleFromCountry(store.settings?.country)
  const templates = getSmsTemplate(locale)

  const message = templates.request_accepted({
    storeName: store.name,
    number: reservation.number,
  })

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
      templateType: 'request_accepted',
      status: result.success ? 'sent' : 'failed',
      messageId: result.messageId,
      error: result.error,
      creditSource,
    })

    await handlePostSend(store.id, creditSource, result.success)

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
      templateType: 'request_accepted',
      status: 'failed',
      error: errorMessage,
      creditSource,
    })

    return { success: false, error: errorMessage }
  }
}

/**
 * Send request rejected SMS to customer
 */
export async function sendRequestRejectedSms({
  store,
  customer,
  reservation,
}: {
  store: Store
  customer: Customer & { id: string }
  reservation: {
    id: string
    number: string
  }
}): Promise<SmsSendResult> {
  if (!customer.phone) {
    return { success: false, error: 'Customer has no phone number' }
  }

  if (!isSmsConfigured()) {
    return { success: false, error: 'SMS not configured' }
  }

  // Check SMS quota
  const quotaCheck = await checkSmsQuotaAndSource(store.id)
  if (!quotaCheck.allowed) {
    return quotaCheck.error!
  }
  const { creditSource } = quotaCheck

  // Validate and normalize phone number
  const phoneValidation = validateAndNormalizePhone(customer.phone)
  if (!phoneValidation.valid || !phoneValidation.normalized) {
    return { success: false, error: phoneValidation.error || 'Invalid phone number format' }
  }
  const normalizedPhone = phoneValidation.normalized

  // Get locale from store country
  const locale = getLocaleFromCountry(store.settings?.country)
  const templates = getSmsTemplate(locale)

  const message = templates.request_rejected({
    storeName: store.name,
    number: reservation.number,
  })

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
      templateType: 'request_rejected',
      status: result.success ? 'sent' : 'failed',
      messageId: result.messageId,
      error: result.error,
      creditSource,
    })

    await handlePostSend(store.id, creditSource, result.success)

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
      templateType: 'request_rejected',
      status: 'failed',
      error: errorMessage,
      creditSource,
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

  // Check SMS quota (includes plan limit + prepaid credits)
  const quotaCheck = await checkSmsQuotaAndSource(store.id)
  if (!quotaCheck.allowed) {
    return quotaCheck.error!
  }
  const { creditSource } = quotaCheck

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
      creditSource,
    })

    // Deduct prepaid credit if needed
    await handlePostSend(store.id, creditSource, result.success)

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
      creditSource,
    })

    return { success: false, error: errorMessage }
  }
}

/**
 * Send thank you review SMS with Google review link
 */
export async function sendThankYouReviewSms({
  store,
  customer,
  reservation,
  reviewUrl,
  locale = 'fr',
}: {
  store: Store
  customer: Customer & { id: string }
  reservation: {
    id: string
    number: string
  }
  reviewUrl: string
  locale?: EmailLocale
}): Promise<SmsSendResult> {
  if (!customer.phone) {
    return { success: false, error: 'Customer has no phone number' }
  }

  if (!isSmsConfigured()) {
    return { success: false, error: 'SMS not configured' }
  }

  // Check SMS quota (includes plan limit + prepaid credits)
  const quotaCheck = await checkSmsQuotaAndSource(store.id)
  if (!quotaCheck.allowed) {
    return quotaCheck.error!
  }
  const { creditSource } = quotaCheck

  // Validate and normalize phone number
  const phoneValidation = validateAndNormalizePhone(customer.phone)
  if (!phoneValidation.valid || !phoneValidation.normalized) {
    return { success: false, error: phoneValidation.error || 'Invalid phone number format' }
  }
  const normalizedPhone = phoneValidation.normalized

  // Get localized messages
  const messages = getEmailMessages(locale)
  const smsThankYou = messages.emails.thankYouReview.smsThankYou
  const smsReview = messages.emails.thankYouReview.smsReview

  // Keep message short - SMS are limited to 160 chars
  const message = buildSmsMessage([
    `${store.name}`,
    smsThankYou,
    `${smsReview} ${reviewUrl}`,
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
      templateType: 'thank_you_review',
      status: result.success ? 'sent' : 'failed',
      messageId: result.messageId,
      error: result.error,
      creditSource,
    })

    // Deduct prepaid credit if needed
    await handlePostSend(store.id, creditSource, result.success)

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
      templateType: 'thank_you_review',
      status: 'failed',
      error: errorMessage,
      creditSource,
    })

    return { success: false, error: errorMessage }
  }
}

/**
 * Send payment request SMS
 */
export async function sendPaymentRequestSms({
  store,
  customer,
  reservation,
  amount,
  paymentUrl,
  currency = 'EUR',
}: {
  store: Store
  customer: Customer & { id: string }
  reservation: {
    id: string
    number: string
  }
  amount: number
  paymentUrl: string
  currency?: string
}): Promise<SmsSendResult> {
  if (!customer.phone) {
    return { success: false, error: 'Customer has no phone number' }
  }

  if (!isSmsConfigured()) {
    return { success: false, error: 'SMS not configured' }
  }

  // Check SMS quota
  const quotaCheck = await checkSmsQuotaAndSource(store.id)
  if (!quotaCheck.allowed) {
    return quotaCheck.error!
  }
  const { creditSource } = quotaCheck

  // Validate and normalize phone number
  const phoneValidation = validateAndNormalizePhone(customer.phone)
  if (!phoneValidation.valid || !phoneValidation.normalized) {
    return { success: false, error: phoneValidation.error || 'Invalid phone number format' }
  }
  const normalizedPhone = phoneValidation.normalized

  // Get locale from store country
  const locale = getLocaleFromCountry(store.settings?.country)
  const templates = getSmsTemplate(locale)

  // Format amount
  const formattedAmount = new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-US', {
    style: 'currency',
    currency,
  }).format(amount)

  const message = templates.payment_request({
    storeName: store.name,
    number: reservation.number,
    amount: formattedAmount,
    url: paymentUrl,
  })

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
      templateType: 'payment_request',
      status: result.success ? 'sent' : 'failed',
      messageId: result.messageId,
      error: result.error,
      creditSource,
    })

    await handlePostSend(store.id, creditSource, result.success)

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
      templateType: 'payment_request',
      status: 'failed',
      error: errorMessage,
      creditSource,
    })

    return { success: false, error: errorMessage }
  }
}

/**
 * Send deposit authorization request SMS
 */
export async function sendDepositAuthorizationRequestSms({
  store,
  customer,
  reservation,
  depositAmount,
  authorizationUrl,
  currency = 'EUR',
}: {
  store: Store
  customer: Customer & { id: string }
  reservation: {
    id: string
    number: string
  }
  depositAmount: number
  authorizationUrl: string
  currency?: string
}): Promise<SmsSendResult> {
  if (!customer.phone) {
    return { success: false, error: 'Customer has no phone number' }
  }

  if (!isSmsConfigured()) {
    return { success: false, error: 'SMS not configured' }
  }

  // Check SMS quota
  const quotaCheck = await checkSmsQuotaAndSource(store.id)
  if (!quotaCheck.allowed) {
    return quotaCheck.error!
  }
  const { creditSource } = quotaCheck

  // Validate and normalize phone number
  const phoneValidation = validateAndNormalizePhone(customer.phone)
  if (!phoneValidation.valid || !phoneValidation.normalized) {
    return { success: false, error: phoneValidation.error || 'Invalid phone number format' }
  }
  const normalizedPhone = phoneValidation.normalized

  // Get locale from store country
  const locale = getLocaleFromCountry(store.settings?.country)
  const templates = getSmsTemplate(locale)

  // Format amount
  const formattedAmount = new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-US', {
    style: 'currency',
    currency,
  }).format(depositAmount)

  const message = templates.deposit_authorization_request({
    storeName: store.name,
    number: reservation.number,
    amount: formattedAmount,
    url: authorizationUrl,
  })

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
      templateType: 'deposit_authorization_request',
      status: result.success ? 'sent' : 'failed',
      messageId: result.messageId,
      error: result.error,
      creditSource,
    })

    await handlePostSend(store.id, creditSource, result.success)

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
      templateType: 'deposit_authorization_request',
      status: 'failed',
      error: errorMessage,
      creditSource,
    })

    return { success: false, error: errorMessage }
  }
}

// Re-export client functions for convenience
export { isSmsConfigured, getSmsConfigStatus } from './client'
