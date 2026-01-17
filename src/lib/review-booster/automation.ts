/**
 * Review Booster Automation Service
 *
 * Handles automatic sending of thank-you emails/SMS with review links
 * after rentals are completed.
 */

import { db } from '@/lib/db'
import { stores, reservations, customers, reviewRequestLogs } from '@/lib/db/schema'
import { eq, and, isNull, lte, inArray, notInArray, sql } from 'drizzle-orm'
import { sendThankYouReviewSms } from '@/lib/sms/send'
import { buildReviewUrl } from '@/lib/google-places'
import { sendThankYouReviewEmail } from '@/lib/email/send'
import type { ReviewBoosterSettings } from '@/types'

interface ProcessResult {
  processed: number
  emailsSent: number
  smsSent: number
  errors: string[]
}

/**
 * Process pending review requests for all stores
 * This should be called by a cron job (e.g., every hour)
 */
export async function processReviewRequests(): Promise<ProcessResult> {
  const result: ProcessResult = {
    processed: 0,
    emailsSent: 0,
    smsSent: 0,
    errors: [],
  }

  try {
    // Get all stores with review booster enabled
    const storesWithReviewBooster = await db.query.stores.findMany({
      where: sql`JSON_EXTRACT(review_booster_settings, '$.enabled') = true`,
    })

    for (const store of storesWithReviewBooster) {
      const settings = store.reviewBoosterSettings as ReviewBoosterSettings | null
      if (!settings?.googlePlaceId) continue

      const reviewUrl = buildReviewUrl(settings.googlePlaceId)

      // Process email requests
      if (settings.autoSendThankYouEmail) {
        const emailResult = await processEmailRequests(store, settings, reviewUrl)
        result.emailsSent += emailResult.sent
        result.errors.push(...emailResult.errors)
      }

      // Process SMS requests
      if (settings.autoSendThankYouSms) {
        const smsResult = await processSmsRequests(store, settings, reviewUrl)
        result.smsSent += smsResult.sent
        result.errors.push(...smsResult.errors)
      }

      result.processed++
    }
  } catch (error) {
    result.errors.push(`Global error: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }

  return result
}

/**
 * Process email review requests for a store
 */
async function processEmailRequests(
  store: {
    id: string
    name: string
    logoUrl: string | null
    email: string | null
    phone: string | null
    address: string | null
    theme: { primaryColor?: string } | null
  },
  settings: ReviewBoosterSettings,
  reviewUrl: string
): Promise<{ sent: number; errors: string[] }> {
  const result = { sent: 0, errors: [] as string[] }
  const delayMs = settings.emailDelayHours * 60 * 60 * 1000
  const cutoffDate = new Date(Date.now() - delayMs)

  // Find completed reservations that need email review request
  // - returnedAt is before cutoff (delay has passed)
  // - no email review request has been sent yet
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
        eq(reservations.status, 'completed'),
        lte(reservations.returnedAt, cutoffDate)
      )
    )
    .limit(50) // Process in batches

  // Filter out reservations that already have an email sent
  const reservationIds = eligibleReservations.map((r) => r.reservation.id)
  if (reservationIds.length === 0) return result

  const existingLogs = await db.query.reviewRequestLogs.findMany({
    where: and(
      inArray(reviewRequestLogs.reservationId, reservationIds),
      eq(reviewRequestLogs.channel, 'email')
    ),
  })
  const sentReservationIds = new Set(existingLogs.map((l) => l.reservationId))

  for (const { reservation, customer } of eligibleReservations) {
    if (sentReservationIds.has(reservation.id)) continue

    try {
      await sendThankYouReviewEmail({
        to: customer.email,
        store: {
          id: store.id,
          name: store.name,
          logoUrl: store.logoUrl,
          email: store.email,
          phone: store.phone,
          address: store.address,
          theme: store.theme as { primaryColor?: string } | null,
        },
        customer: { firstName: customer.firstName },
        reservation: {
          id: reservation.id,
          number: reservation.number,
          startDate: reservation.startDate,
          endDate: reservation.endDate,
        },
        reviewUrl,
        locale: 'fr',
      })

      // Log the sent request
      await db.insert(reviewRequestLogs).values({
        reservationId: reservation.id,
        storeId: store.id,
        customerId: customer.id,
        channel: 'email',
      })

      result.sent++
    } catch (error) {
      result.errors.push(
        `Email error for reservation ${reservation.number}: ${error instanceof Error ? error.message : 'Unknown'}`
      )
    }
  }

  return result
}

/**
 * Process SMS review requests for a store
 */
async function processSmsRequests(
  store: {
    id: string
    name: string
  },
  settings: ReviewBoosterSettings,
  reviewUrl: string
): Promise<{ sent: number; errors: string[] }> {
  const result = { sent: 0, errors: [] as string[] }
  const delayMs = settings.smsDelayHours * 60 * 60 * 1000
  const cutoffDate = new Date(Date.now() - delayMs)

  // Find completed reservations that need SMS review request
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
        eq(reservations.status, 'completed'),
        lte(reservations.returnedAt, cutoffDate)
      )
    )
    .limit(50)

  // Filter out reservations that already have SMS sent
  const reservationIds = eligibleReservations.map((r) => r.reservation.id)
  if (reservationIds.length === 0) return result

  const existingLogs = await db.query.reviewRequestLogs.findMany({
    where: and(
      inArray(reviewRequestLogs.reservationId, reservationIds),
      eq(reviewRequestLogs.channel, 'sms')
    ),
  })
  const sentReservationIds = new Set(existingLogs.map((l) => l.reservationId))

  for (const { reservation, customer } of eligibleReservations) {
    if (sentReservationIds.has(reservation.id)) continue
    if (!customer.phone) continue // Skip if no phone

    try {
      const smsResult = await sendThankYouReviewSms({
        store: { id: store.id, name: store.name },
        customer: { id: customer.id, firstName: customer.firstName, lastName: customer.lastName, phone: customer.phone },
        reservation: { id: reservation.id, number: reservation.number },
        reviewUrl,
      })

      if (smsResult.success) {
        // Log the sent request
        await db.insert(reviewRequestLogs).values({
          reservationId: reservation.id,
          storeId: store.id,
          customerId: customer.id,
          channel: 'sms',
        })

        result.sent++
      } else if (smsResult.limitReached) {
        // Stop processing SMS if limit reached
        result.errors.push(`SMS limit reached for store ${store.id}`)
        break
      }
    } catch (error) {
      result.errors.push(
        `SMS error for reservation ${reservation.number}: ${error instanceof Error ? error.message : 'Unknown'}`
      )
    }
  }

  return result
}

/**
 * Manually trigger a review request for a specific reservation
 */
export async function sendManualReviewRequest(
  reservationId: string,
  channel: 'email' | 'sms'
): Promise<{ success: boolean; error?: string }> {
  const reservation = await db.query.reservations.findFirst({
    where: eq(reservations.id, reservationId),
    with: {
      store: true,
      customer: true,
    },
  })

  if (!reservation) {
    return { success: false, error: 'Reservation not found' }
  }

  const store = reservation.store
  const customer = reservation.customer
  const settings = store.reviewBoosterSettings as ReviewBoosterSettings | null

  if (!settings?.googlePlaceId) {
    return { success: false, error: 'Review Booster not configured' }
  }

  const reviewUrl = buildReviewUrl(settings.googlePlaceId)

  try {
    if (channel === 'email') {
      await sendThankYouReviewEmail({
        to: customer.email,
        store: {
          id: store.id,
          name: store.name,
          logoUrl: store.logoUrl,
          email: store.email,
          phone: store.phone,
          address: store.address,
          theme: store.theme as { primaryColor?: string } | null,
        },
        customer: { firstName: customer.firstName },
        reservation: {
          id: reservation.id,
          number: reservation.number,
          startDate: reservation.startDate,
          endDate: reservation.endDate,
        },
        reviewUrl,
        locale: 'fr',
      })
    } else {
      if (!customer.phone) {
        return { success: false, error: 'Customer has no phone number' }
      }

      const smsResult = await sendThankYouReviewSms({
        store: { id: store.id, name: store.name },
        customer: { id: customer.id, firstName: customer.firstName, lastName: customer.lastName, phone: customer.phone },
        reservation: { id: reservation.id, number: reservation.number },
        reviewUrl,
      })

      if (!smsResult.success) {
        return { success: false, error: smsResult.error }
      }
    }

    // Log the sent request
    await db.insert(reviewRequestLogs).values({
      reservationId: reservation.id,
      storeId: store.id,
      customerId: customer.id,
      channel,
    })

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}
