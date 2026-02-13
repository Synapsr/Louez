import type { QueryClient } from '@tanstack/react-query'

import { orpc } from '@/lib/orpc/react'

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

export async function invalidateReservationAll(
  queryClient: QueryClient,
  reservationId: string,
) {
  await Promise.all([
    invalidateReservationDetail(queryClient, reservationId),
    invalidateReservationList(queryClient),
    invalidateReservationPoll(queryClient),
  ])
}
