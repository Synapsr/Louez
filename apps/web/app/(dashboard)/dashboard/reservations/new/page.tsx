import { db } from '@louez/db'
import { getCurrentStore } from '@/lib/store-context'
import { customers, products, reservations } from '@louez/db'
import { eq, and, inArray, gte } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { subDays } from 'date-fns'

import { NewReservationForm } from './new-reservation-form'

async function getCustomers(storeId: string) {
  return db.query.customers.findMany({
    where: eq(customers.storeId, storeId),
    orderBy: (customers, { desc }) => [desc(customers.createdAt)],
  })
}

async function getProductsWithTiers(storeId: string) {
  // Fetch products with their pricing tiers
  const result = await db.query.products.findMany({
    where: and(eq(products.storeId, storeId), eq(products.status, 'active')),
    with: {
      pricingTiers: true,
      units: {
        columns: {
          status: true,
          attributes: true,
        },
      },
    },
    limit: 500,
  })
  return result.sort((a, b) => a.name.localeCompare(b.name, 'fr'))
}

// Fetch existing reservations for availability conflict checking
async function getActiveReservations(storeId: string) {
  // Get reservations that are active or upcoming (not cancelled/rejected/completed)
  // Only look at reservations from 30 days ago to avoid loading too much data
  const thirtyDaysAgo = subDays(new Date(), 30)

  return db.query.reservations.findMany({
    where: and(
      eq(reservations.storeId, storeId),
      inArray(reservations.status, ['pending', 'confirmed', 'ongoing']),
      gte(reservations.endDate, thirtyDaysAgo)
    ),
    with: {
      items: {
        columns: {
          productId: true,
          quantity: true,
        },
      },
    },
    columns: {
      id: true,
      startDate: true,
      endDate: true,
      status: true,
    },
  })
}

export default async function NewReservationPage() {
  const t = await getTranslations('dashboard.reservations')
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const [customersList, productsList, activeReservations] = await Promise.all([
    getCustomers(store.id),
    getProductsWithTiers(store.id),
    getActiveReservations(store.id),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t('addReservation')}
        </h1>
        <p className="text-muted-foreground">
          {t('createManually')}
        </p>
      </div>

      <NewReservationForm
        customers={customersList}
        products={productsList}
        businessHours={store.settings?.businessHours}
        advanceNoticeMinutes={store.settings?.advanceNoticeMinutes || 0}
        existingReservations={activeReservations}
      />
    </div>
  )
}
