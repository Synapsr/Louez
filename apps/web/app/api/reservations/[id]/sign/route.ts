import {
  ApiServiceError,
  getReservationSigningContext,
  signReservationAsAdmin,
  signReservationAsCustomer,
} from '@louez/api/services'
import { reservationSignInputSchema } from '@louez/validations'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { db, customerSessions } from '@louez/db'
import { and, eq, gt } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { verifyStoreAccess } from '@/lib/store-context'
import { generateContract } from '@/lib/pdf/generate'

function statusFromServiceCode(code: ApiServiceError['code']) {
  switch (code) {
    case 'BAD_REQUEST':
      return 400
    case 'UNAUTHORIZED':
      return 401
    case 'FORBIDDEN':
      return 403
    case 'NOT_FOUND':
      return 404
    default:
      return 500
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const parsed = reservationSignInputSchema.safeParse({ reservationId: id })

  if (!parsed.success) {
    return NextResponse.json({ error: 'errors.invalidData' }, { status: 400 })
  }

  try {
    const { reservationId } = parsed.data
    const reservation = await getReservationSigningContext(reservationId)

    const cookieStore = await cookies()
    const sessionToken = cookieStore.get('customer_session')?.value

    if (sessionToken) {
      const customerSession = await db.query.customerSessions.findFirst({
        where: and(
          eq(customerSessions.token, sessionToken),
          gt(customerSessions.expiresAt, new Date()),
        ),
        with: {
          customer: true,
        },
      })

      if (
        customerSession?.customer &&
        customerSession.customer.id === reservation.customerId &&
        customerSession.customer.storeId === reservation.storeId
      ) {
        return NextResponse.json(
          await signReservationAsCustomer({
            reservationId,
            storeId: reservation.storeId,
            customerId: customerSession.customer.id,
            headers: request.headers,
            regenerateContract: async (idToRegenerate: string) => {
              await generateContract({ reservationId: idToRegenerate, regenerate: true })
            },
          }),
        )
      }
    }

    const dashboardSession = await auth()
    if (!dashboardSession?.user?.id) {
      return NextResponse.json({ error: 'errors.unauthenticated' }, { status: 401 })
    }

    const hasAccess = await verifyStoreAccess(reservation.storeId)
    if (!hasAccess) {
      return NextResponse.json({ error: 'errors.unauthorized' }, { status: 403 })
    }

    return NextResponse.json(
      await signReservationAsAdmin({
        reservationId,
        storeId: reservation.storeId,
        headers: request.headers,
        regenerateContract: async (idToRegenerate: string) => {
          await generateContract({ reservationId: idToRegenerate, regenerate: true })
        },
      }),
    )
  } catch (error) {
    if (error instanceof ApiServiceError) {
      return NextResponse.json(
        { error: error.key, details: error.details },
        { status: statusFromServiceCode(error.code) },
      )
    }

    console.error('Reservation sign error:', error)
    return NextResponse.json({ error: 'errors.internalServerError' }, { status: 500 })
  }
}
