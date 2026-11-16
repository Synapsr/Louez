import type { QueryClient } from '@tanstack/react-query'

import { orpc } from '@/lib/orpc/react'
import { productsQueries } from '@/lib/queries/products.queries'
import { reservationCalendarQueries } from '@/lib/queries/reservation-calendar.queries'
import { reservationPlanningQueries } from '@/lib/queries/reservation-planning.queries'
import { reservationsQueries } from '@/lib/queries/reservations.queries'

/** Invalidates every filter combination of the dashboard products list. */
export async function invalidateProductsList(queryClient: QueryClient) {
  await queryClient.invalidateQueries({ queryKey: productsQueries.listKey() })
}

/**
 * Everything the products domain caches: the lists, a unit's history, the
 * reservation timeline, the variant catalog. After a unit, downtime or
 * withdrawal changes what they show; the server-rendered parts of the page
 * still need `router.refresh()`.
 */
export async function invalidateProductInventory(queryClient: QueryClient) {
  await queryClient.invalidateQueries({ queryKey: productsQueries.key() })
}

/** The store's variant catalog and which products use each variant. */
export async function invalidateVariantCatalog(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: orpc.dashboard.products.listVariants.key(),
    }),
    queryClient.invalidateQueries({
      queryKey: orpc.dashboard.products.getVariantUsage.key(),
    }),
  ])
}

/**
 * What a creation by hand is priced from outside the server: the insurer's
 * quote and the routes its delivery fee is measured on. After a creation
 * refused as changed meanwhile, both are read again, so the total the form
 * shows is the one the next attempt is compared with.
 */
export async function invalidateManualCreationQuotes(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: orpc.dashboard.reservations.previewManualTulipQuote.key(),
    }),
    queryClient.invalidateQueries({ queryKey: orpc.public.address.distance.key() }),
  ])
}

export async function invalidateReservationDetail(
  queryClient: QueryClient,
  reservationId: string,
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: reservationsQueries.detailKey(reservationId) }),
    queryClient.invalidateQueries({
      queryKey: orpc.dashboard.reservations.getEditContext.key({
        input: { reservationId },
      }),
    }),
  ])
}

export async function invalidateReservationList(queryClient: QueryClient) {
  await queryClient.invalidateQueries({ queryKey: reservationsQueries.listKey() })
}

export async function invalidateReservationPoll(queryClient: QueryClient) {
  await queryClient.invalidateQueries({ queryKey: reservationsQueries.pollKey() })
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
