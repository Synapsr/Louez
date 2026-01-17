import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  verificationCodes,
  customerSessions,
  stores,
  reservations,
} from '@/lib/db/schema'
import { eq, and, gt } from 'drizzle-orm'
import { nanoid } from 'nanoid'

const CUSTOMER_SESSION_COOKIE = 'customer_session'
const SESSION_DURATION_DAYS = 30

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; reservationId: string }> }
) {
  const { slug, reservationId } = await params
  const token = request.nextUrl.searchParams.get('token')

  if (!token) {
    // No token provided, redirect to login
    redirect(`/account/login?redirect=/account/reservations/${reservationId}`)
  }

  try {
    // Get store by slug
    const store = await db.query.stores.findFirst({
      where: eq(stores.slug, slug),
    })

    if (!store) {
      redirect(`/account/login?error=storeNotFound&redirect=/account/reservations/${reservationId}`)
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
      redirect(`/account/login?error=invalidToken&redirect=/account/reservations/${reservationId}`)
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
      redirect(`/account/login?error=reservationNotFound&redirect=/account/reservations/${reservationId}`)
    }

    // Token is valid and reusable (we don't mark it as used)

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

    // Set session cookie - this works in Route Handlers
    const cookieStore = await cookies()
    cookieStore.set(CUSTOMER_SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: expiresAt,
      path: '/',
    })

    // Redirect to reservation detail page
    redirect(`/account/reservations/${reservationId}`)
  } catch (error) {
    // If it's a redirect, rethrow it
    if (error instanceof Error && error.message === 'NEXT_REDIRECT') {
      throw error
    }

    console.error('Error processing instant access:', error)
    redirect(`/account/login?error=verificationError&redirect=/account/reservations/${reservationId}`)
  }
}
