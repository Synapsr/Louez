import { cookies } from 'next/headers'
import { NextRequest } from 'next/server'
import { db } from '@louez/db'
import { storefrontRedirect } from '@/lib/storefront-url'
import {
  verificationCodes,
  customerSessions,
  customers,
  stores,
  reservations,
} from '@louez/db'
import { eq, and, gt } from 'drizzle-orm'
import { nanoid } from 'nanoid'

const CUSTOMER_SESSION_COOKIE = 'customer_session'
const SESSION_DURATION_DAYS = 30

/**
 * Route handler for post-payment success redirect with auto-login
 *
 * URL: /{slug}/account/success?token=XXX&type=payment|deposit&reservation=YYY
 *
 * This route:
 * 1. Validates the instant access token
 * 2. Creates a customer session (auto-login)
 * 3. Redirects to /account with success params to show toast
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const token = request.nextUrl.searchParams.get('token')
  const type = request.nextUrl.searchParams.get('type')
  const reservationId = request.nextUrl.searchParams.get('reservation')

  // Build redirect params for success message
  const successParams = new URLSearchParams()
  if (type) successParams.set('success', type)
  if (reservationId) successParams.set('reservation', reservationId)
  const successQuery = successParams.toString() ? `?${successParams.toString()}` : ''

  if (!token) {
    return storefrontRedirect(slug, '/account/login')
  }

  try {
    // Get store by slug
    const store = await db.query.stores.findFirst({
      where: eq(stores.slug, slug),
    })

    if (!store) {
      return storefrontRedirect(slug, '/account/login?error=storeNotFound')
    }

    // Find valid instant access token
    const verification = await db.query.verificationCodes.findFirst({
      where: and(
        eq(verificationCodes.storeId, store.id),
        eq(verificationCodes.type, 'instant_access'),
        eq(verificationCodes.token, token),
        gt(verificationCodes.expiresAt, new Date())
      ),
    })

    if (!verification) {
      return storefrontRedirect(slug, '/account/login?error=invalidToken')
    }

    // Get customer from the verification code's reservation or email
    let customerId: string | null = null

    if (verification.reservationId) {
      // Get customer from the linked reservation
      const reservation = await db.query.reservations.findFirst({
        where: and(
          eq(reservations.id, verification.reservationId),
          eq(reservations.storeId, store.id)
        ),
        with: { customer: true },
      })

      if (reservation?.customer) {
        customerId = reservation.customer.id
      }
    }

    if (!customerId && verification.email) {
      // Fallback: find customer by email in this store
      const customer = await db.query.customers.findFirst({
        where: and(
          eq(customers.storeId, store.id),
          eq(customers.email, verification.email)
        ),
      })
      if (customer) {
        customerId = customer.id
      }
    }

    if (!customerId) {
      return storefrontRedirect(slug, '/account/login?error=customerNotFound')
    }

    // Create customer session
    const sessionToken = nanoid(32)
    const expiresAt = new Date(
      Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000
    )

    await db.insert(customerSessions).values({
      customerId,
      token: sessionToken,
      expiresAt,
    })

    // Set session cookie
    const cookieStore = await cookies()
    cookieStore.set(CUSTOMER_SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: expiresAt,
      path: '/',
    })

    // Redirect to account page with success message
    return storefrontRedirect(slug, `/account${successQuery}`)
  } catch (error) {
    // If it's a redirect, rethrow it
    if (error instanceof Error && error.message === 'NEXT_REDIRECT') {
      throw error
    }

    console.error('Error processing payment success redirect:', error)
    return storefrontRedirect(slug, '/account/login?error=verificationError')
  }
}
