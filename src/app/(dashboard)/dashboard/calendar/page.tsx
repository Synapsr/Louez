import { db } from '@/lib/db'
import { getCurrentStore } from '@/lib/store-context'
import { reservations, products } from '@/lib/db/schema'
import { eq, and, gte, lte, or } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { CalendarView } from './calendar-view'

async function getStoreData() {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  return store
}

async function getReservationsForPeriod(storeId: string, startDate: Date, endDate: Date) {
  // Get reservations that overlap with the period
  const storeReservations = await db.query.reservations.findMany({
    where: and(
      eq(reservations.storeId, storeId),
      or(
        // Reservation starts within the period
        and(gte(reservations.startDate, startDate), lte(reservations.startDate, endDate)),
        // Reservation ends within the period
        and(gte(reservations.endDate, startDate), lte(reservations.endDate, endDate)),
        // Reservation spans the entire period
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

  return storeReservations
}

async function getProducts(storeId: string) {
  // Only select columns needed for the calendar to avoid MySQL sort memory issues
  return db
    .select({
      id: products.id,
      name: products.name,
      quantity: products.quantity,
    })
    .from(products)
    .where(and(eq(products.storeId, storeId), eq(products.status, 'active')))
    .orderBy(products.name)
}

export default async function CalendarPage() {
  const store = await getStoreData()
  const t = await getTranslations('dashboard.calendar')

  // Get current month's range by default
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)

  const [storeReservations, storeProducts] = await Promise.all([
    getReservationsForPeriod(store.id, startOfMonth, endOfMonth),
    getProducts(store.id),
  ])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">
            {t('description')}
          </p>
        </div>
      </div>

      <CalendarView
        initialReservations={storeReservations}
        products={storeProducts}
        storeId={store.id}
      />
    </div>
  )
}
