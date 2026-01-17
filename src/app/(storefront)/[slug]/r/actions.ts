'use server'

import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import {
  customers,
  verificationCodes,
  customerSessions,
  stores,
  reservations,
} from '@/lib/db/schema'
import { eq, and, gt } from 'drizzle-orm'
import { nanoid } from 'nanoid'

const CUSTOMER_SESSION_COOKIE = 'customer_session'
const SESSION_DURATION_DAYS = 30

export async function validateInstantAccessToken(
  storeSlug: string,
  reservationId: string,
  token: string
) {
  try {
    // Get store by slug
    const store = await db.query.stores.findFirst({
      where: eq(stores.slug, storeSlug),
    })

    if (!store) {
      return { error: 'errors.storeNotFound' }
    }

    // Find valid instant access token
    const verification = await db.query.verificationCodes.findFirst({
      where: and(
        eq(verificationCodes.storeId, store.id),
        eq(verificationCodes.type, 'instant_access'),
        eq(verificationCodes.token, token),
        eq(verificationCodes.reservationId, reservationId),
        gt(verificationCodes.expiresAt, new Date())
      ),
    })

    if (!verification) {
      return { error: 'errors.invalidOrExpiredToken' }
    }

    // Verify reservation exists and belongs to this store
    const reservation = await db.query.reservations.findFirst({
      where: and(
        eq(reservations.id, reservationId),
        eq(reservations.storeId, store.id)
      ),
      with: { customer: true },
    })

    if (!reservation) {
      return { error: 'errors.reservationNotFound' }
    }

    // Do NOT mark token as used (reusable tokens)

    // Create customer session
    const sessionToken = nanoid(32)
    const expiresAt = new Date(
      Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000
    )

    await db.insert(customerSessions).values({
      customerId: reservation.customer.id,
      token: sessionToken,
      expiresAt,
    })

    // Set cookie
    const cookieStore = await cookies()
    cookieStore.set(CUSTOMER_SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: expiresAt,
      path: '/',
    })

    return {
      success: true,
      customerId: reservation.customer.id,
      redirectUrl: `/${storeSlug}/account/reservations/${reservationId}`,
    }
  } catch (error) {
    console.error('Error validating instant access token:', error)
    return { error: 'errors.verificationError' }
  }
}
