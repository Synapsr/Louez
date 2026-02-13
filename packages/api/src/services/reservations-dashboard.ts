import { db, reservationActivity, reservations } from '@louez/db'
import { and, count, desc, eq, gte, lte } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'

type ReservationStatus =
  | 'pending'
  | 'confirmed'
  | 'ongoing'
  | 'completed'
  | 'cancelled'
  | 'rejected'

export async function getDashboardReservationsList(params: {
  storeId: string
  status?: 'all' | ReservationStatus
  period?: 'today' | 'week' | 'month'
  limit: number
}) {
  const { storeId, status, period, limit } = params
  const conditions = [eq(reservations.storeId, storeId)]

  if (status && status !== 'all') {
    conditions.push(eq(reservations.status, status))
  }

  const now = new Date()
  if (period === 'today') {
    const startOfDay = new Date(now)
    startOfDay.setHours(0, 0, 0, 0)
    const endOfDay = new Date(now)
    endOfDay.setHours(23, 59, 59, 999)
    conditions.push(gte(reservations.startDate, startOfDay))
    conditions.push(lte(reservations.startDate, endOfDay))
  } else if (period === 'week') {
    const startOfWeek = new Date(now)
    startOfWeek.setDate(now.getDate() - now.getDay())
    startOfWeek.setHours(0, 0, 0, 0)
    const endOfWeek = new Date(startOfWeek)
    endOfWeek.setDate(startOfWeek.getDate() + 6)
    endOfWeek.setHours(23, 59, 59, 999)
    conditions.push(gte(reservations.startDate, startOfWeek))
    conditions.push(lte(reservations.startDate, endOfWeek))
  } else if (period === 'month') {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    endOfMonth.setHours(23, 59, 59, 999)
    conditions.push(gte(reservations.startDate, startOfMonth))
    conditions.push(lte(reservations.startDate, endOfMonth))
  }

  const [reservationsList, countsByStatus] = await Promise.all([
    db.query.reservations.findMany({
      where: and(...conditions),
      with: {
        customer: true,
        items: {
          with: {
            product: true,
          },
        },
        payments: true,
      },
      orderBy: [desc(reservations.createdAt)],
      limit,
    }),
    db
      .select({
        status: reservations.status,
        count: count(),
      })
      .from(reservations)
      .where(eq(reservations.storeId, storeId))
      .groupBy(reservations.status),
  ])

  const counts: Record<string, number> = {}
  let total = 0
  for (const row of countsByStatus) {
    counts[row.status] = row.count
    total += row.count
  }

  return {
    reservations: reservationsList,
    counts: {
      all: total,
      pending: counts['pending'] || 0,
      confirmed: counts['confirmed'] || 0,
      ongoing: counts['ongoing'] || 0,
      completed: counts['completed'] || 0,
    },
  }
}

export async function getDashboardReservationById(params: {
  storeId: string
  reservationId: string
}) {
  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, params.reservationId),
      eq(reservations.storeId, params.storeId),
    ),
    with: {
      customer: true,
      items: {
        with: {
          product: true,
          assignedUnits: true,
        },
      },
      payments: true,
      documents: true,
      activity: {
        with: {
          user: true,
        },
        orderBy: [desc(reservationActivity.createdAt)],
      },
    },
  })

  if (!reservation) {
    throw new ORPCError('NOT_FOUND', { message: 'errors.reservationNotFound' })
  }

  return reservation
}

