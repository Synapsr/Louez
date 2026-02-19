import { db, reservations } from '@louez/db'
import type { ReservationPollResponse } from '@louez/types'
import { and, count, desc, eq } from 'drizzle-orm'

interface GetReservationPollDataParams {
  storeId: string
}

export async function getReservationPollData(
  params: GetReservationPollDataParams,
): Promise<ReservationPollResponse> {
  const { storeId } = params

  const pendingResult = await db
    .select({ count: count() })
    .from(reservations)
    .where(and(eq(reservations.storeId, storeId), eq(reservations.status, 'pending')))

  const latestReservation = await db.query.reservations.findFirst({
    where: eq(reservations.storeId, storeId),
    orderBy: [desc(reservations.createdAt)],
    columns: {
      id: true,
      createdAt: true,
      status: true,
      number: true,
    },
  })

  const totalResult = await db
    .select({ count: count() })
    .from(reservations)
    .where(eq(reservations.storeId, storeId))

  return {
    pendingCount: pendingResult[0]?.count || 0,
    totalCount: totalResult[0]?.count || 0,
    latestReservation: latestReservation
      ? {
          id: latestReservation.id,
          number: latestReservation.number,
          status: latestReservation.status,
          createdAt: latestReservation.createdAt.toISOString(),
        }
      : null,
    timestamp: new Date().toISOString(),
  }
}
