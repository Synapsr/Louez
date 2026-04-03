import type { QueryClient } from '@tanstack/react-query'

import { orpc } from '@/lib/orpc/react'

interface DeliveryDistanceParams {
  originLatitude: number
  originLongitude: number
  destinationLatitude: number
  destinationLongitude: number
}

export async function fetchDeliveryDistanceKm(
  queryClient: QueryClient,
  params: DeliveryDistanceParams,
): Promise<number> {
  const data = await queryClient.fetchQuery(
    orpc.public.address.distance.queryOptions({
      input: params,
    }),
  )

  return data.distanceKm
}
