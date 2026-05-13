import { customers, db, reservations } from '@louez/db'
import type { ReservationPollResponse } from '@louez/types'
import { and, count, desc, eq, sql } from 'drizzle-orm'

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
    where: and(
      eq(reservations.storeId, storeId),
      eq(reservations.status, 'pending'),
      eq(reservations.source, 'online'),
    ),
    orderBy: [desc(reservations.createdAt)],
    columns: {
      id: true,
      createdAt: true,
      status: true,
      number: true,
    },
  })

  const pendingReservations = await db
    .select({
      id: reservations.id,
      number: reservations.number,
      status: reservations.status,
      createdAt: reservations.createdAt,
      startDate: reservations.startDate,
      customerName: sql<string>`TRIM(CONCAT(COALESCE(${customers.firstName}, ''), ' ', COALESCE(${customers.lastName}, '')))`,
    })
    .from(reservations)
    .leftJoin(customers, eq(reservations.customerId, customers.id))
    .where(and(eq(reservations.storeId, storeId), eq(reservations.status, 'pending')))
    .orderBy(desc(reservations.createdAt))
    .limit(5)

  const totalResult = await db
    .select({ count: count() })
    .from(reservations)
    .where(eq(reservations.storeId, storeId))

  return {
    pendingCount: pendingResult[0]?.count || 0,
    totalCount: totalResult[0]?.count || 0,
    pendingReservations: pendingReservations.map((reservation) => ({
      id: reservation.id,
      number: reservation.number,
      status: reservation.status,
      createdAt: reservation.createdAt.toISOString(),
      startDate: reservation.startDate.toISOString(),
      customerName: reservation.customerName || 'Client',
    })),
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
