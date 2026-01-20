/**
 * Admin Notification Dispatcher
 *
 * Handles sending notifications to store owners (admins) via multiple channels:
 * - Email (handled separately via existing email functions)
 * - SMS (to owner phone with full i18n support - 8 languages)
 * - Discord (via webhooks)
 *
 * Supports: fr, en, de, es, it, nl, pl, pt
 */

import { db } from '@/lib/db'
import { stores, smsLogs } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getSmsQuotaStatus, determineSmsSource, deductPrepaidSmsCredit } from '@/lib/plan-limits'
import { sendSms, isSmsConfigured } from '@/lib/sms/client'
import { validateAndNormalizePhone } from '@/lib/sms/phone'
import { formatCurrencyForSms } from '@/lib/utils'
import { getLocaleFromCountry, type EmailLocale } from '@/lib/email/i18n'
import {
  sendNewReservationDiscord,
  sendReservationConfirmedDiscord,
  sendReservationRejectedDiscord,
  sendReservationCancelledDiscord,
  sendReservationPickedUpDiscord,
  sendReservationCompletedDiscord,
  sendPaymentReceivedDiscord,
  sendPaymentFailedDiscord,
} from '@/lib/discord/notifications'
import type { NotificationEventType, NotificationSettings } from '@/types/store'

// ============================================================================
// Types
// ============================================================================

export interface NotificationContext {
  store: {
    id: string
    name: string
    email?: string | null
    discordWebhookUrl?: string | null
    ownerPhone?: string | null
    notificationSettings?: NotificationSettings | null
    settings?: {
      currency?: string
      country?: string
    } | null
  }
  reservation?: {
    id: string
    number: string
    startDate: Date
    endDate: Date
    totalAmount: number
  }
  customer?: {
    firstName: string
    lastName: string
    email: string
    phone?: string | null
  }
  payment?: {
    amount: number
  }
}

export interface NotificationResult {
  email: { sent: boolean; error?: string }
  sms: { sent: boolean; error?: string; limitReached?: boolean }
  discord: { sent: boolean; error?: string }
}

// ============================================================================
// Default Settings
// ============================================================================

const DEFAULT_SETTINGS: NotificationSettings = {
  reservation_new: { email: true, sms: false, discord: false },
  reservation_confirmed: { email: true, sms: false, discord: false },
  reservation_rejected: { email: true, sms: false, discord: false },
  reservation_cancelled: { email: true, sms: false, discord: false },
  reservation_picked_up: { email: false, sms: false, discord: false },
  reservation_completed: { email: false, sms: false, discord: false },
  payment_received: { email: true, sms: false, discord: false },
  payment_failed: { email: true, sms: false, discord: false },
}

// ============================================================================
// Admin SMS Templates (i18n - 8 languages)
// ============================================================================

interface AdminSmsTemplateVars {
  storeName: string
  number: string
  customerName: string
  amount: string
}

type AdminSmsTemplates = {
  reservation_new: (vars: AdminSmsTemplateVars) => string
  reservation_confirmed: (vars: AdminSmsTemplateVars) => string
  reservation_rejected: (vars: AdminSmsTemplateVars) => string
  reservation_cancelled: (vars: AdminSmsTemplateVars) => string
  reservation_picked_up: (vars: AdminSmsTemplateVars) => string
  reservation_completed: (vars: AdminSmsTemplateVars) => string
  payment_received: (vars: AdminSmsTemplateVars) => string
  payment_failed: (vars: AdminSmsTemplateVars) => string
}

const ADMIN_SMS_TEMPLATES: Record<EmailLocale, AdminSmsTemplates> = {
  fr: {
    reservation_new: ({ storeName, number, customerName, amount }) =>
      `[${storeName}] Nouvelle demande #${number} de ${customerName}. Montant: ${amount}`,
    reservation_confirmed: ({ storeName, number, customerName }) =>
      `[${storeName}] Réservation #${number} confirmée pour ${customerName}`,
    reservation_rejected: ({ storeName, number }) =>
      `[${storeName}] Réservation #${number} rejetée`,
    reservation_cancelled: ({ storeName, number }) =>
      `[${storeName}] Réservation #${number} annulée`,
    reservation_picked_up: ({ storeName, number }) =>
      `[${storeName}] Équipement récupéré pour #${number}`,
    reservation_completed: ({ storeName, number, amount }) =>
      `[${storeName}] Réservation #${number} terminée. ${amount}`,
    payment_received: ({ storeName, number, amount }) =>
      `[${storeName}] Paiement reçu #${number}: ${amount}`,
    payment_failed: ({ storeName, number }) =>
      `[${storeName}] Échec paiement #${number}`,
  },
  en: {
    reservation_new: ({ storeName, number, customerName, amount }) =>
      `[${storeName}] New request #${number} from ${customerName}. Amount: ${amount}`,
    reservation_confirmed: ({ storeName, number, customerName }) =>
      `[${storeName}] Reservation #${number} confirmed for ${customerName}`,
    reservation_rejected: ({ storeName, number }) =>
      `[${storeName}] Reservation #${number} rejected`,
    reservation_cancelled: ({ storeName, number }) =>
      `[${storeName}] Reservation #${number} cancelled`,
    reservation_picked_up: ({ storeName, number }) =>
      `[${storeName}] Equipment picked up for #${number}`,
    reservation_completed: ({ storeName, number, amount }) =>
      `[${storeName}] Reservation #${number} completed. ${amount}`,
    payment_received: ({ storeName, number, amount }) =>
      `[${storeName}] Payment received #${number}: ${amount}`,
    payment_failed: ({ storeName, number }) =>
      `[${storeName}] Payment failed #${number}`,
  },
  de: {
    reservation_new: ({ storeName, number, customerName, amount }) =>
      `[${storeName}] Neue Anfrage #${number} von ${customerName}. Betrag: ${amount}`,
    reservation_confirmed: ({ storeName, number, customerName }) =>
      `[${storeName}] Reservierung #${number} bestaetigt fuer ${customerName}`,
    reservation_rejected: ({ storeName, number }) =>
      `[${storeName}] Reservierung #${number} abgelehnt`,
    reservation_cancelled: ({ storeName, number }) =>
      `[${storeName}] Reservierung #${number} storniert`,
    reservation_picked_up: ({ storeName, number }) =>
      `[${storeName}] Ausruestung abgeholt fuer #${number}`,
    reservation_completed: ({ storeName, number, amount }) =>
      `[${storeName}] Reservierung #${number} abgeschlossen. ${amount}`,
    payment_received: ({ storeName, number, amount }) =>
      `[${storeName}] Zahlung erhalten #${number}: ${amount}`,
    payment_failed: ({ storeName, number }) =>
      `[${storeName}] Zahlung fehlgeschlagen #${number}`,
  },
  es: {
    reservation_new: ({ storeName, number, customerName, amount }) =>
      `[${storeName}] Nueva solicitud #${number} de ${customerName}. Monto: ${amount}`,
    reservation_confirmed: ({ storeName, number, customerName }) =>
      `[${storeName}] Reserva #${number} confirmada para ${customerName}`,
    reservation_rejected: ({ storeName, number }) =>
      `[${storeName}] Reserva #${number} rechazada`,
    reservation_cancelled: ({ storeName, number }) =>
      `[${storeName}] Reserva #${number} cancelada`,
    reservation_picked_up: ({ storeName, number }) =>
      `[${storeName}] Equipo recogido para #${number}`,
    reservation_completed: ({ storeName, number, amount }) =>
      `[${storeName}] Reserva #${number} completada. ${amount}`,
    payment_received: ({ storeName, number, amount }) =>
      `[${storeName}] Pago recibido #${number}: ${amount}`,
    payment_failed: ({ storeName, number }) =>
      `[${storeName}] Pago fallido #${number}`,
  },
  it: {
    reservation_new: ({ storeName, number, customerName, amount }) =>
      `[${storeName}] Nuova richiesta #${number} da ${customerName}. Importo: ${amount}`,
    reservation_confirmed: ({ storeName, number, customerName }) =>
      `[${storeName}] Prenotazione #${number} confermata per ${customerName}`,
    reservation_rejected: ({ storeName, number }) =>
      `[${storeName}] Prenotazione #${number} rifiutata`,
    reservation_cancelled: ({ storeName, number }) =>
      `[${storeName}] Prenotazione #${number} annullata`,
    reservation_picked_up: ({ storeName, number }) =>
      `[${storeName}] Attrezzatura ritirata per #${number}`,
    reservation_completed: ({ storeName, number, amount }) =>
      `[${storeName}] Prenotazione #${number} completata. ${amount}`,
    payment_received: ({ storeName, number, amount }) =>
      `[${storeName}] Pagamento ricevuto #${number}: ${amount}`,
    payment_failed: ({ storeName, number }) =>
      `[${storeName}] Pagamento fallito #${number}`,
  },
  nl: {
    reservation_new: ({ storeName, number, customerName, amount }) =>
      `[${storeName}] Nieuwe aanvraag #${number} van ${customerName}. Bedrag: ${amount}`,
    reservation_confirmed: ({ storeName, number, customerName }) =>
      `[${storeName}] Reservering #${number} bevestigd voor ${customerName}`,
    reservation_rejected: ({ storeName, number }) =>
      `[${storeName}] Reservering #${number} afgewezen`,
    reservation_cancelled: ({ storeName, number }) =>
      `[${storeName}] Reservering #${number} geannuleerd`,
    reservation_picked_up: ({ storeName, number }) =>
      `[${storeName}] Apparatuur opgehaald voor #${number}`,
    reservation_completed: ({ storeName, number, amount }) =>
      `[${storeName}] Reservering #${number} voltooid. ${amount}`,
    payment_received: ({ storeName, number, amount }) =>
      `[${storeName}] Betaling ontvangen #${number}: ${amount}`,
    payment_failed: ({ storeName, number }) =>
      `[${storeName}] Betaling mislukt #${number}`,
  },
  pl: {
    reservation_new: ({ storeName, number, customerName, amount }) =>
      `[${storeName}] Nowe zamowienie #${number} od ${customerName}. Kwota: ${amount}`,
    reservation_confirmed: ({ storeName, number, customerName }) =>
      `[${storeName}] Rezerwacja #${number} potwierdzona dla ${customerName}`,
    reservation_rejected: ({ storeName, number }) =>
      `[${storeName}] Rezerwacja #${number} odrzucona`,
    reservation_cancelled: ({ storeName, number }) =>
      `[${storeName}] Rezerwacja #${number} anulowana`,
    reservation_picked_up: ({ storeName, number }) =>
      `[${storeName}] Sprzet odebrany dla #${number}`,
    reservation_completed: ({ storeName, number, amount }) =>
      `[${storeName}] Rezerwacja #${number} zakonczona. ${amount}`,
    payment_received: ({ storeName, number, amount }) =>
      `[${storeName}] Platnosc otrzymana #${number}: ${amount}`,
    payment_failed: ({ storeName, number }) =>
      `[${storeName}] Platnosc nieudana #${number}`,
  },
  pt: {
    reservation_new: ({ storeName, number, customerName, amount }) =>
      `[${storeName}] Nova solicitacao #${number} de ${customerName}. Valor: ${amount}`,
    reservation_confirmed: ({ storeName, number, customerName }) =>
      `[${storeName}] Reserva #${number} confirmada para ${customerName}`,
    reservation_rejected: ({ storeName, number }) =>
      `[${storeName}] Reserva #${number} rejeitada`,
    reservation_cancelled: ({ storeName, number }) =>
      `[${storeName}] Reserva #${number} cancelada`,
    reservation_picked_up: ({ storeName, number }) =>
      `[${storeName}] Equipamento retirado para #${number}`,
    reservation_completed: ({ storeName, number, amount }) =>
      `[${storeName}] Reserva #${number} concluida. ${amount}`,
    payment_received: ({ storeName, number, amount }) =>
      `[${storeName}] Pagamento recebido #${number}: ${amount}`,
    payment_failed: ({ storeName, number }) =>
      `[${storeName}] Pagamento falhou #${number}`,
  },
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build localized SMS message for admin notification
 */
function buildAdminSmsMessage(
  eventType: NotificationEventType,
  ctx: NotificationContext,
  locale: EmailLocale
): string {
  const templates = ADMIN_SMS_TEMPLATES[locale] || ADMIN_SMS_TEMPLATES.en
  const templateFn = templates[eventType]

  const vars: AdminSmsTemplateVars = {
    storeName: ctx.store.name,
    number: ctx.reservation?.number || '',
    customerName: ctx.customer
      ? `${ctx.customer.firstName} ${ctx.customer.lastName}`
      : '',
    amount: ctx.payment
      ? formatCurrencyForSms(ctx.payment.amount, ctx.store.settings?.currency)
      : ctx.reservation
        ? formatCurrencyForSms(ctx.reservation.totalAmount, ctx.store.settings?.currency)
        : '',
  }

  return templateFn(vars)
}

/**
 * Send SMS to store owner (admin notification)
 */
async function sendAdminSms(
  storeId: string,
  ownerPhone: string,
  eventType: NotificationEventType,
  message: string,
  reservationId?: string
): Promise<{ success: boolean; error?: string; limitReached?: boolean }> {
  // Check if SMS is configured
  if (!isSmsConfigured()) {
    return { success: false, error: 'SMS not configured' }
  }

  // Check quota
  const quota = await getSmsQuotaStatus(storeId)
  if (!quota.allowed) {
    return {
      success: false,
      error: 'SMS limit reached',
      limitReached: true,
    }
  }

  // Validate and normalize phone number
  const phoneResult = validateAndNormalizePhone(ownerPhone)
  if (!phoneResult.valid || !phoneResult.normalized) {
    return { success: false, error: phoneResult.error || 'Invalid phone number' }
  }
  const formattedPhone = phoneResult.normalized

  // Determine credit source
  const creditSource = await determineSmsSource(storeId)

  // Send SMS
  const result = await sendSms({
    to: formattedPhone,
    message,
  })

  // Log the SMS
  await db.insert(smsLogs).values({
    storeId,
    reservationId,
    to: formattedPhone,
    message,
    templateType: `admin_${eventType}`,
    status: result.success ? 'sent' : 'failed',
    error: result.error,
    creditSource,
  })

  // Deduct prepaid credit if needed
  if (result.success && creditSource === 'topup') {
    await deductPrepaidSmsCredit(storeId)
  }

  return result
}

/**
 * Get Discord sender function for event type
 */
function getDiscordSender(eventType: NotificationEventType) {
  switch (eventType) {
    case 'reservation_new':
      return sendNewReservationDiscord
    case 'reservation_confirmed':
      return sendReservationConfirmedDiscord
    case 'reservation_rejected':
      return sendReservationRejectedDiscord
    case 'reservation_cancelled':
      return sendReservationCancelledDiscord
    case 'reservation_picked_up':
      return sendReservationPickedUpDiscord
    case 'reservation_completed':
      return sendReservationCompletedDiscord
    case 'payment_received':
      return sendPaymentReceivedDiscord
    case 'payment_failed':
      return sendPaymentFailedDiscord
    default:
      return async () => ({ success: false, error: 'Unknown event type' })
  }
}

// ============================================================================
// Main Dispatch Function
// ============================================================================

/**
 * Dispatch notification to all enabled channels
 *
 * @param eventType - The type of event that triggered the notification
 * @param ctx - Context containing store, reservation, customer, and payment info
 * @returns Results for each channel (email, sms, discord)
 */
export async function dispatchNotification(
  eventType: NotificationEventType,
  ctx: NotificationContext
): Promise<NotificationResult> {
  const result: NotificationResult = {
    email: { sent: false },
    sms: { sent: false },
    discord: { sent: false },
  }

  // Get notification preferences (use defaults if not set)
  const settings = ctx.store.notificationSettings || DEFAULT_SETTINGS
  const prefs = settings[eventType] || DEFAULT_SETTINGS[eventType]

  // Determine locale from store country
  const locale = getLocaleFromCountry(ctx.store.settings?.country)

  // Email notification (for admin, this means sending to store email)
  // Note: Admin emails are handled by existing functions like sendNewRequestLandlordEmail
  // which are called separately from the action handlers
  if (prefs.email && ctx.store.email) {
    result.email.sent = true // Handled by existing email functions
  }

  // SMS notification to store owner
  if (prefs.sms && ctx.store.ownerPhone) {
    const message = buildAdminSmsMessage(eventType, ctx, locale)
    const smsResult = await sendAdminSms(
      ctx.store.id,
      ctx.store.ownerPhone,
      eventType,
      message,
      ctx.reservation?.id
    )
    result.sms = {
      sent: smsResult.success,
      error: smsResult.error,
      limitReached: smsResult.limitReached,
    }
  }

  // Discord notification
  if (prefs.discord && ctx.store.discordWebhookUrl) {
    const discordCtx = {
      store: {
        id: ctx.store.id,
        name: ctx.store.name,
        discordWebhookUrl: ctx.store.discordWebhookUrl,
      },
      reservation: ctx.reservation
        ? {
            ...ctx.reservation,
            currency: ctx.store.settings?.currency,
          }
        : undefined,
      customer: ctx.customer,
      payment: ctx.payment
        ? {
            ...ctx.payment,
            currency: ctx.store.settings?.currency,
          }
        : undefined,
    }

    try {
      const discordResult = await getDiscordSender(eventType)(discordCtx)
      result.discord = { sent: discordResult?.success ?? false, error: discordResult?.error }
    } catch (error) {
      result.discord = {
        sent: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  return result
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Helper to get full store data for notifications
 */
export async function getStoreForNotifications(storeId: string) {
  const store = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
  })

  if (!store) return null

  return {
    id: store.id,
    name: store.name,
    email: store.email,
    discordWebhookUrl: store.discordWebhookUrl,
    ownerPhone: store.ownerPhone,
    notificationSettings: store.notificationSettings,
    settings: store.settings,
  }
}
