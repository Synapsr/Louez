import { db, customers, reservationActivity, reservations } from '@louez/db'
import { and, asc, count, desc, eq, gte, inArray, like, lte, not, or, sql } from 'drizzle-orm'
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
  search?: string
  sort?: 'startDate' | 'amount' | 'status' | 'number'
  sortDirection?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}) {
  const { storeId, status, period, limit, search, sort, sortDirection, page, pageSize } = params
  const conditions = [eq(reservations.storeId, storeId)]

  if (status && status !== 'all') {
    if (status === 'cancelled') {
      // "Cancelled" tab groups both cancelled and rejected
      conditions.push(
        or(
          eq(reservations.status, 'cancelled'),
          eq(reservations.status, 'rejected'),
        )!
      )
    } else {
      conditions.push(eq(reservations.status, status))
    }
  } else {
    // Default "all" view excludes cancelled and rejected
    conditions.push(
      not(eq(reservations.status, 'cancelled')),
      not(eq(reservations.status, 'rejected')),
    )
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

  // Determine sort order
  const sortDir = sortDirection === 'asc' ? asc : desc
  let orderByClause
  switch (sort) {
    case 'amount':
      orderByClause = [sortDir(reservations.totalAmount)]
      break
    case 'status':
      orderByClause = [sortDir(reservations.status)]
      break
    case 'number':
      orderByClause = [sortDir(reservations.number)]
      break
    case 'startDate':
      orderByClause = [sortDir(reservations.startDate)]
      break
    default:
      orderByClause = [desc(reservations.startDate)]
      break
  }

  // Pagination
  const usePagination = page != null && pageSize != null
  const effectiveLimit = usePagination ? pageSize : limit
  const offset = usePagination ? (page - 1) * pageSize : 0

  const needsSearch = search && search.trim()

  // When searching, we need to join with customers table.
  // Drizzle relational queries don't support cross-table WHERE, so we use a
  // two-step approach: first find matching IDs via a join query, then load
  // full relational data for those IDs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let reservationsList: any[]
  if (needsSearch) {
    const term = `%${search.trim()}%`
    const searchCondition = or(
      like(reservations.number, term),
      like(customers.firstName, term),
      like(customers.lastName, term),
      sql`CONCAT(${customers.firstName}, ' ', ${customers.lastName}) LIKE ${term}`,
    )!

    const matchingIds = await db
      .select({ id: reservations.id })
      .from(reservations)
      .innerJoin(customers, eq(reservations.customerId, customers.id))
      .where(and(...conditions, searchCondition))
      .orderBy(...orderByClause)
      .limit(effectiveLimit)
      .offset(offset)

    if (matchingIds.length === 0) {
      reservationsList = []
    } else {
      reservationsList = await db.query.reservations.findMany({
        where: inArray(reservations.id, matchingIds.map(r => r.id)),
        with: {
          customer: true,
          items: { with: { product: true } },
          payments: true,
        },
        orderBy: orderByClause,
      })
    }
  } else {
    reservationsList = await db.query.reservations.findMany({
      where: and(...conditions),
      with: {
        customer: true,
        items: { with: { product: true } },
        payments: true,
      },
      orderBy: orderByClause,
      limit: effectiveLimit,
      offset,
    })
  }

  // Count queries (run in parallel)
  const [countsByStatus, totalCountResult] = await Promise.all([
    db
      .select({
        status: reservations.status,
        count: count(),
      })
      .from(reservations)
      .where(eq(reservations.storeId, storeId))
      .groupBy(reservations.status),
    usePagination
      ? (needsSearch
          ? db
              .select({ count: count() })
              .from(reservations)
              .innerJoin(customers, eq(reservations.customerId, customers.id))
              .where(and(...conditions, or(
                like(reservations.number, `%${search!.trim()}%`),
                like(customers.firstName, `%${search!.trim()}%`),
                like(customers.lastName, `%${search!.trim()}%`),
                sql`CONCAT(${customers.firstName}, ' ', ${customers.lastName}) LIKE ${`%${search!.trim()}%`}`,
              )!))
          : db
              .select({ count: count() })
              .from(reservations)
              .where(and(...conditions))
        ).then((r) => r[0]?.count ?? 0)
      : Promise.resolve(null),
  ])

  const counts: Record<string, number> = {}
  for (const row of countsByStatus) {
    counts[row.status] = row.count
  }

  const cancelledCount = (counts['cancelled'] || 0) + (counts['rejected'] || 0)
  const activeTotal =
    (counts['pending'] || 0) +
    (counts['confirmed'] || 0) +
    (counts['ongoing'] || 0) +
    (counts['completed'] || 0)

  return {
    reservations: reservationsList,
    counts: {
      all: activeTotal,
      pending: counts['pending'] || 0,
      confirmed: counts['confirmed'] || 0,
      ongoing: counts['ongoing'] || 0,
      completed: counts['completed'] || 0,
      cancelled: cancelledCount,
    },
    totalCount: totalCountResult,
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
