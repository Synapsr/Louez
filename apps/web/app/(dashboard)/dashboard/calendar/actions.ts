'use server'

import { db } from '@louez/db'
import { stores, reservations } from '@louez/db'
import { getCurrentStore } from '@/lib/store-context'
import { eq, and, gte, lte, or } from 'drizzle-orm'
import { nanoid } from 'nanoid'

export async function fetchReservationsForPeriod(startDateISO: string, endDateISO: string) {
  const store = await getCurrentStore()

  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  const startDate = new Date(startDateISO)
  const endDate = new Date(endDateISO)

  const storeReservations = await db.query.reservations.findMany({
    where: and(
      eq(reservations.storeId, store.id),
      or(
        and(gte(reservations.startDate, startDate), lte(reservations.startDate, endDate)),
        and(gte(reservations.endDate, startDate), lte(reservations.endDate, endDate)),
        and(lte(reservations.startDate, startDate), gte(reservations.endDate, endDate))
      )
    ),
    with: {
      customer: true,
      items: {
        with: {
          product: true,
        },
      },
    },
    orderBy: (reservations, { asc }) => [asc(reservations.startDate)],
  })

  return { data: storeReservations }
}

export async function generateIcsToken() {
  const store = await getCurrentStore()

  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  // Generate a new 32-character token
  const token = nanoid(32)

  await db
    .update(stores)
    .set({
      icsToken: token,
      updatedAt: new Date(),
    })
    .where(eq(stores.id, store.id))

  return { success: true, token }
}

export async function getIcsToken() {
  const store = await getCurrentStore()

  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  // Return existing token or generate one if it doesn't exist
  if (store.icsToken) {
    return { success: true, token: store.icsToken }
  }

  // Generate and save a new token
  return generateIcsToken()
}

export async function regenerateIcsToken() {
  // Simply generate a new token, which invalidates the old one
  return generateIcsToken()
}
