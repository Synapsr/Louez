import { NextResponse } from 'next/server'
import { headers, cookies } from 'next/headers'
import { db } from '@/lib/db'
import { reservations, customerSessions } from '@/lib/db/schema'
import { eq, and, gt } from 'drizzle-orm'
import { generateContract } from '@/lib/pdf/generate'
import { auth } from '@/lib/auth'
import { verifyStoreAccess } from '@/lib/store-context'
import { getClientIp } from '@/lib/request'

/**
 * POST /api/reservations/[id]/sign
 *
 * Signs a reservation contract. Requires authentication via:
 * - Customer session cookie (for customers signing their own reservations)
 * - Dashboard admin session (for store members signing on behalf)
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: reservationId } = await params

  // Validate reservation ID format (nanoid 21 chars)
  if (!reservationId || reservationId.length !== 21) {
    return NextResponse.json(
      { error: 'Invalid reservation ID' },
      { status: 400 }
    )
  }

  // Get reservation with store info
  const reservation = await db.query.reservations.findFirst({
    where: eq(reservations.id, reservationId),
    with: {
      store: true,
    },
  })

  if (!reservation) {
    return NextResponse.json(
      { error: 'Reservation not found' },
      { status: 404 }
    )
  }

  // Check if already signed
  if (reservation.signedAt) {
    return NextResponse.json(
      { error: 'Contract already signed' },
      { status: 400 }
    )
  }

  // ===== AUTHENTICATION =====
  // Try customer session first (for storefront signing)
  const cookieStore = await cookies()
  const sessionToken = cookieStore.get('customer_session')?.value

  let isAuthorized = false
  let signerType: 'customer' | 'admin' = 'customer'

  if (sessionToken) {
    // Validate customer session
    const session = await db.query.customerSessions.findFirst({
      where: and(
        eq(customerSessions.token, sessionToken),
        gt(customerSessions.expiresAt, new Date())
      ),
      with: {
        customer: true,
      },
    })

    // Customer must match the reservation's customer AND store
    if (
      session?.customer &&
      session.customer.id === reservation.customerId &&
      session.customer.storeId === reservation.storeId
    ) {
      isAuthorized = true
      signerType = 'customer'
    }
  }

  // If not authorized as customer, try dashboard admin
  if (!isAuthorized) {
    const dashboardSession = await auth()

    if (dashboardSession?.user?.id) {
      // Verify user has access to this specific store
      const storeAccess = await verifyStoreAccess(reservation.storeId)

      if (storeAccess) {
        isAuthorized = true
        signerType = 'admin'
      }
    }
  }

  // Reject if not authorized
  if (!isAuthorized) {
    return NextResponse.json(
      { error: 'Unauthorized - Please sign in to sign this contract' },
      { status: 401 }
    )
  }

  // Get client IP for audit trail (supports Cloudflare, Traefik, nginx, etc.)
  const headersList = await headers()
  const ip = getClientIp(headersList)

  // Update reservation with signature (with store isolation)
  const updated = await db
    .update(reservations)
    .set({
      signedAt: new Date(),
      signatureIp: ip,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(reservations.id, reservationId),
        eq(reservations.storeId, reservation.storeId) // Ensure store isolation
      )
    )

  // Regenerate contract PDF with signature
  await generateContract({ reservationId, regenerate: true })

  return NextResponse.json({
    success: true,
    signedBy: signerType,
    signedAt: new Date().toISOString(),
  })
}
