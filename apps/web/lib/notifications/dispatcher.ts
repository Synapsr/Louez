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

import { db } from '@louez/db'
import { stores, smsLogs, pushSubscriptions, storeMembers } from '@louez/db'
import { eq } from 'drizzle-orm'
import { getSmsQuotaStatus, determineSmsSource, deductPrepaidSmsCredit } from '@/lib/plan-limits'
import { sendSms, isSmsConfigured } from '@/lib/sms/client'
import { validateAndNormalizePhone } from '@/lib/sms/phone'
import { formatCurrencyForSms } from '@louez/utils'
import { getLocaleFromCountry, getEmailTranslations, type EmailLocale } from '@/lib/email/i18n'
import {
  sendNewReservationDiscord,
  sendReservationConfirmedDiscord,
  sendReservationRejectedDiscord,
  sendReservationCancelledDiscord,
  sendReservationPickedUpDiscord,
  sendReservationCompletedDiscord,
  sendReminderPickupAdminDiscord,
  sendReminderReturnAdminDiscord,
  sendReminderDigestAdminDiscord,
  sendPaymentReceivedDiscord,
  sendPaymentFailedDiscord,
} from '@/lib/discord/notifications'
import {
  sendReminderPickupAdminEmail,
  sendReminderReturnAdminEmail,
  sendReminderDigestAdminEmail,
} from '@/lib/email/send'
import type { DigestEntry } from '@/lib/email/templates'
import { isPushConfigured, sendPush } from '@/lib/push/client'
import { buildAdminPushPayload } from '@/lib/push/notifications'
import type { NotificationEventType, NotificationSettings } from '@louez/types'

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
  push: { sent: boolean; error?: string }
}

// ============================================================================
// Default Settings
// ============================================================================

const DEFAULT_SETTINGS: NotificationSettings = {
  reservation_new: { email: true, sms: false, discord: false, push: true },
  reservation_confirmed: { email: true, sms: false, discord: false, push: false },
  reservation_rejected: { email: true, sms: false, discord: false, push: false },
  reservation_cancelled: { email: true, sms: false, discord: false, push: false },
  reservation_picked_up: { email: false, sms: false, discord: false, push: false },
  reservation_completed: { email: false, sms: false, discord: false, push: false },
  reservation_reminder_pickup: { email: false, sms: false, discord: false, push: false },
  reservation_reminder_return: { email: false, sms: false, discord: false, push: false },
  payment_received: { email: true, sms: false, discord: false, push: false },
  payment_failed: { email: true, sms: false, discord: false, push: false },
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
  reservation_reminder_pickup: (vars: AdminSmsTemplateVars) => string
  reservation_reminder_return: (vars: AdminSmsTemplateVars) => string
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
    reservation_reminder_pickup: ({ storeName, number, customerName }) =>
      `[${storeName}] Rappel retrait #${number} - ${customerName}`,
    reservation_reminder_return: ({ storeName, number, customerName }) =>
      `[${storeName}] Rappel retour #${number} - ${customerName}`,
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
    reservation_reminder_pickup: ({ storeName, number, customerName }) =>
      `[${storeName}] Pickup reminder #${number} - ${customerName}`,
    reservation_reminder_return: ({ storeName, number, customerName }) =>
      `[${storeName}] Return reminder #${number} - ${customerName}`,
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
    reservation_reminder_pickup: ({ storeName, number, customerName }) =>
      `[${storeName}] Erinnerung Abholung #${number} - ${customerName}`,
    reservation_reminder_return: ({ storeName, number, customerName }) =>
      `[${storeName}] Erinnerung Rueckgabe #${number} - ${customerName}`,
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
    reservation_reminder_pickup: ({ storeName, number, customerName }) =>
      `[${storeName}] Recordatorio recogida #${number} - ${customerName}`,
    reservation_reminder_return: ({ storeName, number, customerName }) =>
      `[${storeName}] Recordatorio devolucion #${number} - ${customerName}`,
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
    reservation_reminder_pickup: ({ storeName, number, customerName }) =>
      `[${storeName}] Promemoria ritiro #${number} - ${customerName}`,
    reservation_reminder_return: ({ storeName, number, customerName }) =>
      `[${storeName}] Promemoria reso #${number} - ${customerName}`,
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
    reservation_reminder_pickup: ({ storeName, number, customerName }) =>
      `[${storeName}] Herinnering ophalen #${number} - ${customerName}`,
    reservation_reminder_return: ({ storeName, number, customerName }) =>
      `[${storeName}] Herinnering retour #${number} - ${customerName}`,
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
    reservation_reminder_pickup: ({ storeName, number, customerName }) =>
      `[${storeName}] Przypomnienie odbioru #${number} - ${customerName}`,
    reservation_reminder_return: ({ storeName, number, customerName }) =>
      `[${storeName}] Przypomnienie zwrotu #${number} - ${customerName}`,
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
    reservation_reminder_pickup: ({ storeName, number, customerName }) =>
      `[${storeName}] Lembrete retirada #${number} - ${customerName}`,
    reservation_reminder_return: ({ storeName, number, customerName }) =>
      `[${storeName}] Lembrete devolucao #${number} - ${customerName}`,
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
  eventType: string,
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
    case 'reservation_reminder_pickup':
      return sendReminderPickupAdminDiscord
    case 'reservation_reminder_return':
      return sendReminderReturnAdminDiscord
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
    push: { sent: false },
  }

  // Get notification preferences (use defaults if not set). Merge per-channel
  // over the defaults so stores saved before a channel existed (e.g. `push`)
  // still inherit that channel's default instead of resolving to undefined.
  const settings = ctx.store.notificationSettings || DEFAULT_SETTINGS
  const prefs = { ...DEFAULT_SETTINGS[eventType], ...settings[eventType] }

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

  // Web push to every store member's registered devices
  if (prefs.push && isPushConfigured()) {
    try {
      const payload = buildAdminPushPayload(eventType, ctx, locale)
      if (payload) {
        const subs = await db
          .select({
            id: pushSubscriptions.id,
            endpoint: pushSubscriptions.endpoint,
            p256dh: pushSubscriptions.p256dh,
            auth: pushSubscriptions.auth,
          })
          .from(pushSubscriptions)
          .innerJoin(
            storeMembers,
            eq(storeMembers.userId, pushSubscriptions.userId)
          )
          .where(eq(storeMembers.storeId, ctx.store.id))

        for (const sub of subs) {
          const sendResult = await sendPush(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            payload
          )
          if (sendResult.success) {
            result.push.sent = true
          } else if (
            sendResult.statusCode === 404 ||
            sendResult.statusCode === 410
          ) {
            // Endpoint is gone — prune the dead subscription.
            await db
              .delete(pushSubscriptions)
              .where(eq(pushSubscriptions.id, sub.id))
          }
        }
      }
    } catch (error) {
      result.push.error =
        error instanceof Error ? error.message : 'Unknown error'
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
// Admin Reminder Dispatch
// ============================================================================

export type AdminReminderEventType =
  | 'reservation_reminder_pickup'
  | 'reservation_reminder_return'

export interface AdminReminderContext {
  store: {
    id: string
    name: string
    email?: string | null
    logoUrl?: string | null
    darkLogoUrl?: string | null
    address?: string | null
    phone?: string | null
    ownerPhone?: string | null
    discordWebhookUrl?: string | null
    theme?: { mode?: 'light' | 'dark'; primaryColor?: string } | null
    notificationSettings?: NotificationSettings | null
    settings?: {
      currency?: string
      country?: string
      timezone?: string
    } | null
  }
  reservation: {
    id: string
    number: string
    startDate: Date
    endDate: Date
    totalAmount: number
  }
  customer: {
    firstName: string
    lastName: string
    email: string
    phone?: string | null
  }
  dashboardUrl: string
}

/**
 * Dispatch an automatic admin reminder (upcoming pickup / return) to the store
 * owner across all enabled channels.
 *
 * Unlike dispatchNotification (event-driven, where admin emails are sent by
 * inline callers), reminders are cron-driven with no inline trigger, so this
 * owns the email send too. SMS and Discord reuse the same infrastructure.
 */
export async function dispatchAdminReminder(
  eventType: AdminReminderEventType,
  ctx: AdminReminderContext
): Promise<NotificationResult> {
  const result: NotificationResult = {
    email: { sent: false },
    sms: { sent: false },
    discord: { sent: false },
    push: { sent: false },
  }

  const settings = ctx.store.notificationSettings || DEFAULT_SETTINGS
  const prefs = settings[eventType] || DEFAULT_SETTINGS[eventType]
  const locale = getLocaleFromCountry(ctx.store.settings?.country)

  // Email to store owner
  if (prefs.email && ctx.store.email) {
    try {
      const emailArgs = {
        to: ctx.store.email,
        store: ctx.store,
        customer: ctx.customer,
        dashboardUrl: ctx.dashboardUrl,
        locale,
      }
      if (eventType === 'reservation_reminder_pickup') {
        await sendReminderPickupAdminEmail({
          ...emailArgs,
          reservation: {
            id: ctx.reservation.id,
            number: ctx.reservation.number,
            startDate: ctx.reservation.startDate,
            totalAmount: ctx.reservation.totalAmount,
          },
        })
      } else {
        await sendReminderReturnAdminEmail({
          ...emailArgs,
          reservation: {
            id: ctx.reservation.id,
            number: ctx.reservation.number,
            endDate: ctx.reservation.endDate,
            totalAmount: ctx.reservation.totalAmount,
          },
        })
      }
      result.email.sent = true
    } catch (error) {
      result.email.error = error instanceof Error ? error.message : 'Unknown error'
      console.error(`Failed to send admin reminder email for ${eventType}:`, error)
    }
  }

  // SMS to store owner
  if (prefs.sms && ctx.store.ownerPhone) {
    const message = buildAdminSmsMessage(
      eventType,
      {
        store: ctx.store,
        reservation: ctx.reservation,
        customer: ctx.customer,
      },
      locale
    )
    const smsResult = await sendAdminSms(
      ctx.store.id,
      ctx.store.ownerPhone,
      eventType,
      message,
      ctx.reservation.id
    )
    result.sms = {
      sent: smsResult.success,
      error: smsResult.error,
      limitReached: smsResult.limitReached,
    }
  }

  // Discord
  if (prefs.discord && ctx.store.discordWebhookUrl) {
    const discordCtx = {
      store: {
        id: ctx.store.id,
        name: ctx.store.name,
        discordWebhookUrl: ctx.store.discordWebhookUrl,
      },
      reservation: {
        ...ctx.reservation,
        currency: ctx.store.settings?.currency,
      },
      customer: ctx.customer,
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
// Admin Daily Digest
// ============================================================================

// Short SMS summary of the day's pickups/returns (i18n, 8 languages). Kept
// deliberately terse — the digest's job here is to nudge the owner to the
// dashboard, where the full schedule lives.
const ADMIN_DIGEST_SMS: Record<EmailLocale, (v: { storeName: string; pickups: number; returns: number; url: string }) => string> = {
  fr: ({ storeName, pickups, returns, url }) =>
    `[${storeName}] Aujourd'hui : ${pickups} retrait(s), ${returns} retour(s). ${url}`,
  en: ({ storeName, pickups, returns, url }) =>
    `[${storeName}] Today: ${pickups} pickup(s), ${returns} return(s). ${url}`,
  de: ({ storeName, pickups, returns, url }) =>
    `[${storeName}] Heute: ${pickups} Abholung(en), ${returns} Rueckgabe(n). ${url}`,
  es: ({ storeName, pickups, returns, url }) =>
    `[${storeName}] Hoy: ${pickups} recogida(s), ${returns} devolucion(es). ${url}`,
  it: ({ storeName, pickups, returns, url }) =>
    `[${storeName}] Oggi: ${pickups} ritiro/i, ${returns} reso/i. ${url}`,
  nl: ({ storeName, pickups, returns, url }) =>
    `[${storeName}] Vandaag: ${pickups} ophaling(en), ${returns} retour(en). ${url}`,
  pl: ({ storeName, pickups, returns, url }) =>
    `[${storeName}] Dzisiaj: ${pickups} odbior(ow), ${returns} zwrot(ow). ${url}`,
  pt: ({ storeName, pickups, returns, url }) =>
    `[${storeName}] Hoje: ${pickups} retirada(s), ${returns} devolucao(oes). ${url}`,
}

export interface AdminDigestContext {
  store: {
    id: string
    name: string
    email?: string | null
    logoUrl?: string | null
    darkLogoUrl?: string | null
    address?: string | null
    phone?: string | null
    ownerPhone?: string | null
    discordWebhookUrl?: string | null
    theme?: { mode?: 'light' | 'dark'; primaryColor?: string } | null
    settings?: {
      currency?: string
      country?: string
      timezone?: string
    } | null
  }
  /** Localized full date, e.g. "Monday, 9 June 2026". */
  dateLabel: string
  pickups: DigestEntry[]
  returns: DigestEntry[]
  dashboardUrl: string
  /** Channels to attempt — already filtered for enabled + not-yet-sent today. */
  channels: { email: boolean; sms: boolean; discord: boolean }
}

/**
 * Dispatch the once-a-day admin digest across the requested channels.
 * Every channel receives the same content (the day's pickups + returns); the
 * caller decides which channels to attempt.
 */
export async function dispatchAdminDigest(ctx: AdminDigestContext): Promise<NotificationResult> {
  const result: NotificationResult = {
    email: { sent: false },
    sms: { sent: false },
    discord: { sent: false },
    push: { sent: false },
  }

  const locale = getLocaleFromCountry(ctx.store.settings?.country)

  // Email
  if (ctx.channels.email && ctx.store.email) {
    try {
      await sendReminderDigestAdminEmail({
        to: ctx.store.email,
        store: ctx.store,
        dateLabel: ctx.dateLabel,
        pickups: ctx.pickups,
        returns: ctx.returns,
        dashboardUrl: ctx.dashboardUrl,
        locale,
      })
      result.email.sent = true
    } catch (error) {
      result.email.error = error instanceof Error ? error.message : 'Unknown error'
      console.error('Failed to send admin digest email:', error)
    }
  }

  // SMS
  if (ctx.channels.sms && ctx.store.ownerPhone) {
    const build = ADMIN_DIGEST_SMS[locale] || ADMIN_DIGEST_SMS.en
    const message = build({
      storeName: ctx.store.name,
      pickups: ctx.pickups.length,
      returns: ctx.returns.length,
      url: ctx.dashboardUrl,
    })
    const smsResult = await sendAdminSms(ctx.store.id, ctx.store.ownerPhone, 'digest', message)
    result.sms = {
      sent: smsResult.success,
      error: smsResult.error,
      limitReached: smsResult.limitReached,
    }
  }

  // Discord
  if (ctx.channels.discord && ctx.store.discordWebhookUrl) {
    try {
      const t = getEmailTranslations(locale)
      const discordResult = await sendReminderDigestAdminDiscord({
        store: {
          id: ctx.store.id,
          name: ctx.store.name,
          discordWebhookUrl: ctx.store.discordWebhookUrl,
        },
        dateLabel: ctx.dateLabel,
        pickupsLabel: t.reminderDigestAdmin.pickupsTitle.replace('{count}', String(ctx.pickups.length)),
        returnsLabel: t.reminderDigestAdmin.returnsTitle.replace('{count}', String(ctx.returns.length)),
        pickups: ctx.pickups,
        returns: ctx.returns,
      })
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
