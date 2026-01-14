import { db } from '@/lib/db'
import { getCurrentStore } from '@/lib/store-context'
import { customers, products } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

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
    },
    limit: 500,
  })
  return result.sort((a, b) => a.name.localeCompare(b.name, 'fr'))
}

export default async function NewReservationPage() {
  const t = await getTranslations('dashboard.reservations')
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const [customersList, productsList] = await Promise.all([
    getCustomers(store.id),
    getProductsWithTiers(store.id),
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
        pricingMode={store.settings?.pricingMode || 'day'}
        businessHours={store.settings?.businessHours}
        advanceNotice={store.settings?.advanceNotice || 0}
      />
    </div>
  )
}
