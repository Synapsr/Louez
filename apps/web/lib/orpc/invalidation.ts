import type { QueryClient } from '@tanstack/react-query'

import { orpc } from '@/lib/orpc/react'
import { productsQueries } from '@/lib/queries/products.queries'
import { reservationCalendarQueries } from '@/lib/queries/reservation-calendar.queries'
import { reservationPlanningQueries } from '@/lib/queries/reservation-planning.queries'

/** Invalidates every filter combination of the dashboard products list. */
export async function invalidateProductsList(queryClient: QueryClient) {
  await queryClient.invalidateQueries({ queryKey: productsQueries.listKey() })
}

export async function invalidateReservationDetail(
  queryClient: QueryClient,
  reservationId: string,
) {
  await queryClient.invalidateQueries({
    queryKey: orpc.dashboard.reservations.getById.key({
      input: { reservationId },
    }),
  })
}

export async function invalidateReservationList(queryClient: QueryClient) {
  await queryClient.invalidateQueries({
    queryKey: orpc.dashboard.reservations.list.key(),
  })
}

export async function invalidateReservationPoll(queryClient: QueryClient) {
  await queryClient.invalidateQueries({
    queryKey: orpc.dashboard.reservations.poll.key(),
  })
}

export async function invalidateReservationTimelines(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: reservationCalendarQueries.key() }),
    queryClient.invalidateQueries({ queryKey: reservationPlanningQueries.key() }),
  ])
}

export async function invalidateReservationAll(
  queryClient: QueryClient,
  reservationId: string,
) {
  await Promise.all([
    invalidateReservationDetail(queryClient, reservationId),
    invalidateReservationList(queryClient),
    invalidateReservationPoll(queryClient),
    invalidateReservationTimelines(queryClient),
  ])
}
