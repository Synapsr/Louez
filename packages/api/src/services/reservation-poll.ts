import { customers, db, payments, receivedInvoices, reservations, storeIntegrations } from '@louez/db'
import type { ReservationPollResponse } from '@louez/types'
import { and, count, desc, eq, notExists, sql } from 'drizzle-orm'

interface GetReservationPollDataParams {
  storeId: string
}

export async function getReservationPollData(
  params: GetReservationPollDataParams,
): Promise<ReservationPollResponse> {
  const { storeId } = params

  // A pending reservation waits on the owner unless its online checkout is
  // underway: that one confirms itself when paid (same reading as the home).
  const awaitsOwner = and(
    eq(reservations.storeId, storeId),
    eq(reservations.status, 'pending'),
    notExists(
      db
        .select({ id: payments.id })
        .from(payments)
        .where(
          and(
            eq(payments.reservationId, reservations.id),
            eq(payments.method, 'stripe'),
            eq(payments.type, 'rental'),
            eq(payments.status, 'pending'),
          ),
        ),
    ),
  )

  const pendingResult = await db
    .select({ count: count() })
    .from(reservations)
    .where(awaitsOwner)

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
    .where(awaitsOwner)
    .orderBy(desc(reservations.createdAt))
    .limit(5)

  const pendingSupplierInvoiceResult = await db
    .select({ count: count() })
    .from(receivedInvoices)
    .innerJoin(
      storeIntegrations,
      and(
        eq(storeIntegrations.storeId, receivedInvoices.storeId),
        eq(storeIntegrations.providerKey, 'superpdp'),
      ),
    )
    .where(
      and(eq(receivedInvoices.storeId, storeId), eq(receivedInvoices.ourAction, 'none')),
    )

  const totalResult = await db
    .select({ count: count() })
    .from(reservations)
    .where(eq(reservations.storeId, storeId))

  return {
    pendingCount: pendingResult[0]?.count || 0,
    pendingSupplierInvoices: pendingSupplierInvoiceResult[0]?.count || 0,
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
