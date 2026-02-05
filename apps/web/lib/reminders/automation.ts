/**
 * Automatic Reminder Service
 *
 * Handles automatic sending of pickup and return reminder emails/SMS
 * before reservations start or end.
 *
 * Called by the cron job every minute to check for pending reminders.
 */

import { db } from '@louez/db'
import { stores, reservations, customers, reminderLogs } from '@louez/db'
import { eq, and, gte, lte, inArray, sql } from 'drizzle-orm'
import { dispatchCustomerNotification } from '@/lib/notifications/customer-dispatcher'
import {
  DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS,
  type CustomerNotificationSettings,
} from '@louez/types'

interface ProcessResult {
  processed: number
  pickupRemindersSent: number
  returnRemindersSent: number
  errors: string[]
}

/**
 * Process pending reminders for all stores
 * This is called by the cron job (every minute)
 */
export async function processReminders(): Promise<ProcessResult> {
  const result: ProcessResult = {
    processed: 0,
    pickupRemindersSent: 0,
    returnRemindersSent: 0,
    errors: [],
  }

  try {
    // Get all stores that have customer notification settings with reminders enabled
    // We check for stores where at least one reminder type (pickup or return) has email or sms enabled
    const allStores = await db.query.stores.findMany({
      columns: {
        id: true,
        name: true,
        email: true,
        logoUrl: true,
        darkLogoUrl: true,
        address: true,
        phone: true,
        theme: true,
        settings: true,
        emailSettings: true,
        customerNotificationSettings: true,
      },
    })

    for (const store of allStores) {
      const settings: CustomerNotificationSettings =
        (store.customerNotificationSettings as CustomerNotificationSettings) ||
        DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS

      // Get reminder timing settings (default: 24 hours)
      const reminderSettings = settings.reminderSettings || {
        pickupReminderHours: 24,
        returnReminderHours: 24,
      }

      // Process pickup reminders if enabled
      if (settings.customer_reminder_pickup.enabled &&
          (settings.customer_reminder_pickup.email || settings.customer_reminder_pickup.sms)) {
        const pickupResult = await processPickupReminders(store, settings, reminderSettings.pickupReminderHours)
        result.pickupRemindersSent += pickupResult.sent
        result.errors.push(...pickupResult.errors)
      }

      // Process return reminders if enabled
      if (settings.customer_reminder_return.enabled &&
          (settings.customer_reminder_return.email || settings.customer_reminder_return.sms)) {
        const returnResult = await processReturnReminders(store, settings, reminderSettings.returnReminderHours)
        result.returnRemindersSent += returnResult.sent
        result.errors.push(...returnResult.errors)
      }

      result.processed++
    }
  } catch (error) {
    result.errors.push(`Global error: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }

  return result
}

/**
 * Process pickup reminders for a store
 * Sends reminders for reservations starting within the configured hours window
 */
async function processPickupReminders(
  store: {
    id: string
    name: string
    email: string | null
    logoUrl: string | null
    address: string | null
    phone: string | null
    theme: unknown
    settings: unknown
    emailSettings: unknown
    customerNotificationSettings: unknown
  },
  settings: CustomerNotificationSettings,
  hoursBeforePickup: number
): Promise<{ sent: number; errors: string[] }> {
  const result = { sent: 0, errors: [] as string[] }

  const now = new Date()
  // Window: from now to (now + hoursBeforePickup)
  // But we only want reservations where startDate is within 1 hour of the target time
  // This ensures we send the reminder at approximately the right time
  const targetTime = new Date(now.getTime() + hoursBeforePickup * 60 * 60 * 1000)
  const windowStart = new Date(targetTime.getTime() - 30 * 60 * 1000) // 30 min before target
  const windowEnd = new Date(targetTime.getTime() + 30 * 60 * 1000) // 30 min after target

  // Find confirmed reservations starting within the window
  const eligibleReservations = await db
    .select({
      reservation: reservations,
      customer: customers,
    })
    .from(reservations)
    .innerJoin(customers, eq(customers.id, reservations.customerId))
    .where(
      and(
        eq(reservations.storeId, store.id),
        eq(reservations.status, 'confirmed'),
        gte(reservations.startDate, windowStart),
        lte(reservations.startDate, windowEnd)
      )
    )
    .limit(50)

  if (eligibleReservations.length === 0) return result

  // Filter out reservations that already have pickup reminder sent
  const reservationIds = eligibleReservations.map((r) => r.reservation.id)
  const existingLogs = await db.query.reminderLogs.findMany({
    where: and(
      inArray(reminderLogs.reservationId, reservationIds),
      eq(reminderLogs.type, 'pickup')
    ),
  })
  const sentReservationIds = new Set(existingLogs.map((l) => l.reservationId))

  for (const { reservation, customer } of eligibleReservations) {
    if (sentReservationIds.has(reservation.id)) continue

    try {
      // Build reservation URL
      const domain = process.env.NEXT_PUBLIC_APP_DOMAIN || 'localhost:3000'
      const storeData = await db.query.stores.findFirst({
        where: eq(stores.id, store.id),
        columns: { slug: true },
      })
      const reservationUrl = storeData
        ? `https://${storeData.slug}.${domain}/account/reservations/${reservation.id}`
        : ''

      // Dispatch notification via customer-dispatcher
      const dispatchResult = await dispatchCustomerNotification('customer_reminder_pickup', {
        store: {
          id: store.id,
          name: store.name,
          email: store.email,
          logoUrl: store.logoUrl,
          darkLogoUrl: (store as unknown as { darkLogoUrl: string | null }).darkLogoUrl,
          address: store.address,
          phone: store.phone,
          theme: store.theme as { mode?: 'light' | 'dark'; primaryColor?: string } | null,
          settings: store.settings as { country?: string; currency?: string } | null,
          emailSettings: store.emailSettings as Record<string, unknown> | null,
          customerNotificationSettings: settings,
        },
        customer: {
          id: customer.id,
          firstName: customer.firstName,
          lastName: customer.lastName,
          email: customer.email,
          phone: customer.phone,
        },
        reservation: {
          id: reservation.id,
          number: reservation.number,
          startDate: reservation.startDate,
          endDate: reservation.endDate,
          totalAmount: Number(reservation.totalAmount),
          subtotalAmount: Number(reservation.subtotalAmount),
          depositAmount: Number(reservation.depositAmount),
        },
        reservationUrl,
      })

      // Log successful sends
      if (dispatchResult.email.sent) {
        await db.insert(reminderLogs).values({
          reservationId: reservation.id,
          storeId: store.id,
          customerId: customer.id,
          type: 'pickup',
          channel: 'email',
        }).onDuplicateKeyUpdate({ set: { sentAt: new Date() } })
        result.sent++
      }

      if (dispatchResult.sms.sent) {
        await db.insert(reminderLogs).values({
          reservationId: reservation.id,
          storeId: store.id,
          customerId: customer.id,
          type: 'pickup',
          channel: 'sms',
        }).onDuplicateKeyUpdate({ set: { sentAt: new Date() } })
        result.sent++
      }
    } catch (error) {
      result.errors.push(
        `Pickup reminder error for reservation ${reservation.number}: ${error instanceof Error ? error.message : 'Unknown'}`
      )
    }
  }

  return result
}

/**
 * Process return reminders for a store
 * Sends reminders for reservations ending within the configured hours window
 */
async function processReturnReminders(
  store: {
    id: string
    name: string
    email: string | null
    logoUrl: string | null
    address: string | null
    phone: string | null
    theme: unknown
    settings: unknown
    emailSettings: unknown
    customerNotificationSettings: unknown
  },
  settings: CustomerNotificationSettings,
  hoursBeforeReturn: number
): Promise<{ sent: number; errors: string[] }> {
  const result = { sent: 0, errors: [] as string[] }

  const now = new Date()
  // Window: from now to (now + hoursBeforeReturn)
  const targetTime = new Date(now.getTime() + hoursBeforeReturn * 60 * 60 * 1000)
  const windowStart = new Date(targetTime.getTime() - 30 * 60 * 1000)
  const windowEnd = new Date(targetTime.getTime() + 30 * 60 * 1000)

  // Find ongoing reservations ending within the window
  const eligibleReservations = await db
    .select({
      reservation: reservations,
      customer: customers,
    })
    .from(reservations)
    .innerJoin(customers, eq(customers.id, reservations.customerId))
    .where(
      and(
        eq(reservations.storeId, store.id),
        eq(reservations.status, 'ongoing'),
        gte(reservations.endDate, windowStart),
        lte(reservations.endDate, windowEnd)
      )
    )
    .limit(50)

  if (eligibleReservations.length === 0) return result

  // Filter out reservations that already have return reminder sent
  const reservationIds = eligibleReservations.map((r) => r.reservation.id)
  const existingLogs = await db.query.reminderLogs.findMany({
    where: and(
      inArray(reminderLogs.reservationId, reservationIds),
      eq(reminderLogs.type, 'return')
    ),
  })
  const sentReservationIds = new Set(existingLogs.map((l) => l.reservationId))

  for (const { reservation, customer } of eligibleReservations) {
    if (sentReservationIds.has(reservation.id)) continue

    try {
      // Build reservation URL
      const domain = process.env.NEXT_PUBLIC_APP_DOMAIN || 'localhost:3000'
      const storeData = await db.query.stores.findFirst({
        where: eq(stores.id, store.id),
        columns: { slug: true },
      })
      const reservationUrl = storeData
        ? `https://${storeData.slug}.${domain}/account/reservations/${reservation.id}`
        : ''

      // Dispatch notification via customer-dispatcher
      const dispatchResult = await dispatchCustomerNotification('customer_reminder_return', {
        store: {
          id: store.id,
          name: store.name,
          email: store.email,
          logoUrl: store.logoUrl,
          darkLogoUrl: (store as unknown as { darkLogoUrl: string | null }).darkLogoUrl,
          address: store.address,
          phone: store.phone,
          theme: store.theme as { mode?: 'light' | 'dark'; primaryColor?: string } | null,
          settings: store.settings as { country?: string; currency?: string } | null,
          emailSettings: store.emailSettings as Record<string, unknown> | null,
          customerNotificationSettings: settings,
        },
        customer: {
          id: customer.id,
          firstName: customer.firstName,
          lastName: customer.lastName,
          email: customer.email,
          phone: customer.phone,
        },
        reservation: {
          id: reservation.id,
          number: reservation.number,
          startDate: reservation.startDate,
          endDate: reservation.endDate,
          totalAmount: Number(reservation.totalAmount),
          subtotalAmount: Number(reservation.subtotalAmount),
          depositAmount: Number(reservation.depositAmount),
        },
        reservationUrl,
      })

      // Log successful sends
      if (dispatchResult.email.sent) {
        await db.insert(reminderLogs).values({
          reservationId: reservation.id,
          storeId: store.id,
          customerId: customer.id,
          type: 'return',
          channel: 'email',
        }).onDuplicateKeyUpdate({ set: { sentAt: new Date() } })
        result.sent++
      }

      if (dispatchResult.sms.sent) {
        await db.insert(reminderLogs).values({
          reservationId: reservation.id,
          storeId: store.id,
          customerId: customer.id,
          type: 'return',
          channel: 'sms',
        }).onDuplicateKeyUpdate({ set: { sentAt: new Date() } })
        result.sent++
      }
    } catch (error) {
      result.errors.push(
        `Return reminder error for reservation ${reservation.number}: ${error instanceof Error ? error.message : 'Unknown'}`
      )
    }
  }

  return result
}
