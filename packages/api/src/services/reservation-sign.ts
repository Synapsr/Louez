import {
  db,
  reservationActivity,
  reservationContractSignatures,
  reservations,
  type ContractSignatureMethod,
} from '@louez/db'
import { and, eq, inArray, isNull } from 'drizzle-orm'
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

interface SignReservationInStoreParams {
  reservationId: string
  storeId: string
  userId: string
  signerName: string
  /** PNG data URL drawn by the customer on the renter's device. */
  image: string
  headers: Headers
  regenerateContract?: (reservationId: string) => Promise<void>
}

/** A contract is signed while the rental is ahead or under way, never once it is closed. */
const SIGNABLE_STATUSES = ['pending', 'confirmed', 'ongoing'] as const

type AcceptContractResult =
  | { ok: true; signedAt: Date }
  | { ok: false; reason: 'already_signed' | 'not_signable' }

/**
 * Records the customer's acceptance of the contract, once: date, IP address and where it
 * happened, plus the drawn signature when signed in store. Refused when the reservation is
 * already signed or closed, even if it changed after the caller read it.
 */
export async function acceptReservationContract(params: {
  reservationId: string
  storeId: string
  headers: Headers
  method: ContractSignatureMethod
  drawnSignature?: { userId: string; signerName: string; image: string }
}): Promise<AcceptContractResult> {
  const { reservationId, storeId, method, drawnSignature } = params
  const signedAt = new Date()
  return db.transaction(async (tx) => {
    const [result] = await tx
      .update(reservations)
      .set({
        signedAt,
        signatureIp: getClientIp(params.headers),
        signatureMethod: method,
        updatedAt: signedAt,
      })
      .where(
        and(
          eq(reservations.id, reservationId),
          eq(reservations.storeId, storeId),
          isNull(reservations.signedAt),
          inArray(reservations.status, SIGNABLE_STATUSES),
        ),
      )
    if (result.affectedRows === 0) {
      const [current] = await tx
        .select({ signedAt: reservations.signedAt })
        .from(reservations)
        .where(and(eq(reservations.id, reservationId), eq(reservations.storeId, storeId)))
      return { ok: false, reason: current?.signedAt ? 'already_signed' : 'not_signable' }
    }

    if (drawnSignature) {
      await tx.insert(reservationContractSignatures).values({
        reservationId,
        signerName: drawnSignature.signerName,
        image: drawnSignature.image,
        createdAt: signedAt,
      })
    }
    await tx.insert(reservationActivity).values({
      reservationId,
      userId: drawnSignature?.userId ?? null,
      activityType: 'contract_signed',
      metadata: { method, ...(drawnSignature ? { signerName: drawnSignature.signerName } : {}) },
      createdAt: signedAt,
    })
    return { ok: true, signedAt }
  })
}

async function persistSignature(params: {
  reservationId: string
  storeId: string
  signedBy: 'customer' | 'admin'
  headers: Headers
  method: ContractSignatureMethod
  drawnSignature?: { userId: string; signerName: string; image: string }
  regenerateContract?: (reservationId: string) => Promise<void>
}) {
  const { reservationId, signedBy, regenerateContract } = params
  const accepted = await acceptReservationContract(params)
  if (!accepted.ok) {
    throw new ApiServiceError(
      'BAD_REQUEST',
      accepted.reason === 'already_signed'
        ? 'errors.contractAlreadySigned'
        : 'errors.contractNotSignable',
    )
  }
  const { signedAt } = accepted

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
    method: 'account',
    regenerateContract,
  })
}

/** The customer signs on the renter's device, at pickup: a drawn signature and their name. */
export async function signReservationInStore(params: SignReservationInStoreParams) {
  const { reservationId, storeId, userId, signerName, image, headers, regenerateContract } =
    params

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
    method: 'in_store',
    drawnSignature: { userId, signerName, image },
    regenerateContract,
  })
}
