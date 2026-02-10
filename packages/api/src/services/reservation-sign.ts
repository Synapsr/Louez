import { db, reservations } from '@louez/db'
import { and, eq } from 'drizzle-orm'
import { ApiServiceError } from './errors'

function getClientIp(headers: Headers): string {
  const cfConnectingIp = headers.get('cf-connecting-ip')
  if (cfConnectingIp) return cfConnectingIp.trim()

  const trueClientIp = headers.get('true-client-ip')
  if (trueClientIp) return trueClientIp.trim()

  const realIp = headers.get('x-real-ip')
  if (realIp) return realIp.trim()

  const forwardedFor = headers.get('x-forwarded-for')
  if (forwardedFor) {
    const firstIp = forwardedFor.split(',')[0]?.trim()
    if (firstIp) return firstIp
  }

  return 'unknown'
}

export interface ReservationSigningContext {
  id: string
  storeId: string
  customerId: string
  signedAt: Date | null
}

export async function getReservationSigningContext(
  reservationId: string,
): Promise<ReservationSigningContext> {
  const reservation = await db.query.reservations.findFirst({
    where: eq(reservations.id, reservationId),
    columns: {
      id: true,
      storeId: true,
      customerId: true,
      signedAt: true,
    },
  })

  if (!reservation) {
    throw new ApiServiceError('NOT_FOUND', 'errors.reservationNotFound')
  }

  return reservation
}

interface SignReservationByCustomerParams {
  reservationId: string
  storeId: string
  customerId: string
  headers: Headers
  regenerateContract?: (reservationId: string) => Promise<void>
}

interface SignReservationByAdminParams {
  reservationId: string
  storeId: string
  headers: Headers
  regenerateContract?: (reservationId: string) => Promise<void>
}

async function persistSignature(params: {
  reservationId: string
  storeId: string
  signedBy: 'customer' | 'admin'
  headers: Headers
  regenerateContract?: (reservationId: string) => Promise<void>
}) {
  const { reservationId, storeId, signedBy, headers, regenerateContract } = params
  const signedAt = new Date()

  await db
    .update(reservations)
    .set({
      signedAt,
      signatureIp: getClientIp(headers),
      updatedAt: signedAt,
    })
    .where(and(eq(reservations.id, reservationId), eq(reservations.storeId, storeId)))

  if (regenerateContract) {
    try {
      await regenerateContract(reservationId)
    } catch {
      throw new ApiServiceError('INTERNAL_SERVER_ERROR', 'errors.contractGenerationFailed')
    }
  }

  return {
    success: true as const,
    signedBy,
    signedAt: signedAt.toISOString(),
  }
}

export async function signReservationAsCustomer(
  params: SignReservationByCustomerParams,
) {
  const { reservationId, storeId, customerId, headers, regenerateContract } = params

  const reservation = await getReservationSigningContext(reservationId)

  if (reservation.signedAt) {
    throw new ApiServiceError('BAD_REQUEST', 'errors.contractAlreadySigned')
  }

  if (reservation.storeId !== storeId || reservation.customerId !== customerId) {
    throw new ApiServiceError('FORBIDDEN', 'errors.unauthorized')
  }

  return persistSignature({
    reservationId,
    storeId: reservation.storeId,
    headers,
    signedBy: 'customer',
    regenerateContract,
  })
}

export async function signReservationAsAdmin(
  params: SignReservationByAdminParams,
) {
  const { reservationId, storeId, headers, regenerateContract } = params

  const reservation = await getReservationSigningContext(reservationId)

  if (reservation.signedAt) {
    throw new ApiServiceError('BAD_REQUEST', 'errors.contractAlreadySigned')
  }

  if (reservation.storeId !== storeId) {
    throw new ApiServiceError('FORBIDDEN', 'errors.unauthorized')
  }

  return persistSignature({
    reservationId,
    storeId: reservation.storeId,
    headers,
    signedBy: 'admin',
    regenerateContract,
  })
}
