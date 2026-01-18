import { db } from '@/lib/db'
import { discordLogs } from '@/lib/db/schema'
import { formatCurrency } from '@/lib/utils'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { sendDiscordNotification, type DiscordEmbed } from './client'
import type { NotificationEventType } from '@/types/store'

// Discord embed colors
const COLORS = {
  info: 0x3b82f6, // blue
  success: 0x22c55e, // green
  warning: 0xf59e0b, // amber
  error: 0xef4444, // red
}

interface DiscordNotificationContext {
  store: {
    id: string
    name: string
    discordWebhookUrl: string | null
  }
  reservation?: {
    id: string
    number: string
    startDate: Date
    endDate: Date
    totalAmount: number
    currency?: string
  }
  customer?: {
    firstName: string
    lastName: string
    email: string
    phone?: string | null
  }
  payment?: {
    amount: number
    currency?: string
  }
}

function formatDate(date: Date): string {
  return format(date, 'dd MMM yyyy', { locale: fr })
}

async function logDiscordNotification(
  storeId: string,
  eventType: NotificationEventType,
  reservationId?: string,
  status: 'sent' | 'failed' = 'sent',
  error?: string
) {
  try {
    await db.insert(discordLogs).values({
      storeId,
      reservationId,
      eventType,
      status,
      error,
    })
  } catch (e) {
    console.error('Failed to log Discord notification:', e)
  }
}

async function sendAndLog(
  ctx: DiscordNotificationContext,
  eventType: NotificationEventType,
  embed: DiscordEmbed
) {
  if (!ctx.store.discordWebhookUrl) return { success: false, error: 'No webhook configured' }

  const result = await sendDiscordNotification(ctx.store.discordWebhookUrl, {
    embeds: [embed],
  })

  await logDiscordNotification(
    ctx.store.id,
    eventType,
    ctx.reservation?.id,
    result.success ? 'sent' : 'failed',
    result.error
  )

  return result
}

export async function sendNewReservationDiscord(ctx: DiscordNotificationContext) {
  if (!ctx.reservation || !ctx.customer) return

  const embed: DiscordEmbed = {
    title: `Nouvelle demande #${ctx.reservation.number}`,
    color: COLORS.info,
    fields: [
      {
        name: 'Client',
        value: `${ctx.customer.firstName} ${ctx.customer.lastName}`,
        inline: true,
      },
      {
        name: 'Email',
        value: ctx.customer.email,
        inline: true,
      },
      {
        name: 'Dates',
        value: `${formatDate(ctx.reservation.startDate)} - ${formatDate(ctx.reservation.endDate)}`,
        inline: false,
      },
      {
        name: 'Montant',
        value: formatCurrency(ctx.reservation.totalAmount, ctx.reservation.currency),
        inline: true,
      },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: ctx.store.name },
  }

  return sendAndLog(ctx, 'reservation_new', embed)
}

export async function sendReservationConfirmedDiscord(ctx: DiscordNotificationContext) {
  if (!ctx.reservation || !ctx.customer) return

  const embed: DiscordEmbed = {
    title: `Réservation confirmée #${ctx.reservation.number}`,
    color: COLORS.success,
    fields: [
      {
        name: 'Client',
        value: `${ctx.customer.firstName} ${ctx.customer.lastName}`,
        inline: true,
      },
      {
        name: 'Dates',
        value: `${formatDate(ctx.reservation.startDate)} - ${formatDate(ctx.reservation.endDate)}`,
        inline: false,
      },
      {
        name: 'Montant',
        value: formatCurrency(ctx.reservation.totalAmount, ctx.reservation.currency),
        inline: true,
      },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: ctx.store.name },
  }

  return sendAndLog(ctx, 'reservation_confirmed', embed)
}

export async function sendReservationRejectedDiscord(ctx: DiscordNotificationContext) {
  if (!ctx.reservation || !ctx.customer) return

  const embed: DiscordEmbed = {
    title: `Réservation rejetée #${ctx.reservation.number}`,
    color: COLORS.error,
    fields: [
      {
        name: 'Client',
        value: `${ctx.customer.firstName} ${ctx.customer.lastName}`,
        inline: true,
      },
      {
        name: 'Dates',
        value: `${formatDate(ctx.reservation.startDate)} - ${formatDate(ctx.reservation.endDate)}`,
        inline: false,
      },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: ctx.store.name },
  }

  return sendAndLog(ctx, 'reservation_rejected', embed)
}

export async function sendReservationCancelledDiscord(ctx: DiscordNotificationContext) {
  if (!ctx.reservation || !ctx.customer) return

  const embed: DiscordEmbed = {
    title: `Réservation annulée #${ctx.reservation.number}`,
    color: COLORS.warning,
    fields: [
      {
        name: 'Client',
        value: `${ctx.customer.firstName} ${ctx.customer.lastName}`,
        inline: true,
      },
      {
        name: 'Dates',
        value: `${formatDate(ctx.reservation.startDate)} - ${formatDate(ctx.reservation.endDate)}`,
        inline: false,
      },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: ctx.store.name },
  }

  return sendAndLog(ctx, 'reservation_cancelled', embed)
}

export async function sendReservationPickedUpDiscord(ctx: DiscordNotificationContext) {
  if (!ctx.reservation || !ctx.customer) return

  const embed: DiscordEmbed = {
    title: `Équipement récupéré #${ctx.reservation.number}`,
    color: COLORS.success,
    fields: [
      {
        name: 'Client',
        value: `${ctx.customer.firstName} ${ctx.customer.lastName}`,
        inline: true,
      },
      {
        name: 'Retour prévu',
        value: formatDate(ctx.reservation.endDate),
        inline: true,
      },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: ctx.store.name },
  }

  return sendAndLog(ctx, 'reservation_picked_up', embed)
}

export async function sendReservationCompletedDiscord(ctx: DiscordNotificationContext) {
  if (!ctx.reservation || !ctx.customer) return

  const embed: DiscordEmbed = {
    title: `Réservation terminée #${ctx.reservation.number}`,
    color: COLORS.success,
    fields: [
      {
        name: 'Client',
        value: `${ctx.customer.firstName} ${ctx.customer.lastName}`,
        inline: true,
      },
      {
        name: 'Montant',
        value: formatCurrency(ctx.reservation.totalAmount, ctx.reservation.currency),
        inline: true,
      },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: ctx.store.name },
  }

  return sendAndLog(ctx, 'reservation_completed', embed)
}

export async function sendPaymentReceivedDiscord(ctx: DiscordNotificationContext) {
  if (!ctx.reservation || !ctx.payment) return

  const embed: DiscordEmbed = {
    title: `Paiement reçu #${ctx.reservation.number}`,
    color: COLORS.success,
    fields: [
      {
        name: 'Montant',
        value: formatCurrency(ctx.payment.amount, ctx.payment.currency),
        inline: true,
      },
      {
        name: 'Client',
        value: ctx.customer
          ? `${ctx.customer.firstName} ${ctx.customer.lastName}`
          : 'N/A',
        inline: true,
      },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: ctx.store.name },
  }

  return sendAndLog(ctx, 'payment_received', embed)
}

export async function sendPaymentFailedDiscord(ctx: DiscordNotificationContext) {
  if (!ctx.reservation) return

  const embed: DiscordEmbed = {
    title: `Échec de paiement #${ctx.reservation.number}`,
    color: COLORS.error,
    fields: [
      {
        name: 'Montant',
        value: ctx.payment
          ? formatCurrency(ctx.payment.amount, ctx.payment.currency)
          : formatCurrency(ctx.reservation.totalAmount, ctx.reservation.currency),
        inline: true,
      },
      {
        name: 'Client',
        value: ctx.customer
          ? `${ctx.customer.firstName} ${ctx.customer.lastName}`
          : 'N/A',
        inline: true,
      },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: ctx.store.name },
  }

  return sendAndLog(ctx, 'payment_failed', embed)
}
