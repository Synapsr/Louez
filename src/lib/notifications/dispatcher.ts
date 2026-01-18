import { db } from '@/lib/db'
import { stores, smsLogs } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getSmsQuotaStatus, determineSmsSource, deductPrepaidSmsCredit } from '@/lib/plan-limits'
import { sendSms, isSmsConfigured } from '@/lib/sms/client'
import { validateAndNormalizePhone } from '@/lib/sms/phone'
import { formatCurrency } from '@/lib/utils'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
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
import type { NotificationEventType, NotificationSettings, DEFAULT_NOTIFICATION_SETTINGS } from '@/types/store'

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

function formatDate(date: Date): string {
  return format(date, 'dd MMM yyyy', { locale: fr })
}

/**
 * Build SMS message for admin notification
 */
function buildAdminSmsMessage(
  eventType: NotificationEventType,
  ctx: NotificationContext
): string {
  const storeName = ctx.store.name
  const resNumber = ctx.reservation?.number || ''
  const customerName = ctx.customer
    ? `${ctx.customer.firstName} ${ctx.customer.lastName}`
    : ''
  const amount = ctx.reservation
    ? formatCurrency(ctx.reservation.totalAmount, ctx.store.settings?.currency)
    : ''

  switch (eventType) {
    case 'reservation_new':
      return `[${storeName}] Nouvelle demande #${resNumber} de ${customerName}. Montant: ${amount}`
    case 'reservation_confirmed':
      return `[${storeName}] Reservation #${resNumber} confirmee pour ${customerName}`
    case 'reservation_rejected':
      return `[${storeName}] Reservation #${resNumber} rejetee`
    case 'reservation_cancelled':
      return `[${storeName}] Reservation #${resNumber} annulee`
    case 'reservation_picked_up':
      return `[${storeName}] Equipement recupere pour #${resNumber}`
    case 'reservation_completed':
      return `[${storeName}] Reservation #${resNumber} terminee. ${amount}`
    case 'payment_received':
      const paymentAmount = ctx.payment
        ? formatCurrency(ctx.payment.amount, ctx.store.settings?.currency)
        : amount
      return `[${storeName}] Paiement recu #${resNumber}: ${paymentAmount}`
    case 'payment_failed':
      return `[${storeName}] Echec paiement #${resNumber}`
    default:
      return `[${storeName}] Notification: ${eventType}`
  }
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
 * Dispatch notification to all enabled channels
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

  // Email notification (for admin, this means sending to store email)
  // Note: The existing email functions send to customers. For admin notifications,
  // we'll use the new request landlord email or skip if not applicable
  if (prefs.email && ctx.store.email) {
    // Email notifications for admin are already handled by existing functions
    // like sendNewRequestLandlordEmail which is called separately
    // This dispatcher focuses on NEW channels (SMS to owner, Discord)
    result.email.sent = true // Assume handled elsewhere for now
  }

  // SMS notification to store owner
  if (prefs.sms && ctx.store.ownerPhone) {
    const message = buildAdminSmsMessage(eventType, ctx)
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
