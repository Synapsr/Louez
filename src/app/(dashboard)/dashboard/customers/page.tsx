import { getTranslations } from 'next-intl/server'
import { db } from '@/lib/db'
import { getCurrentStore } from '@/lib/store-context'
import { customers, reservations } from '@/lib/db/schema'
import { eq, count, sql, desc } from 'drizzle-orm'
import { redirect } from 'next/navigation'

import { CustomersFilters } from './customers-filters'
import { CustomersTable } from './customers-table'

interface CustomersPageProps {
  searchParams: Promise<{
    search?: string
    sort?: string
  }>
}

async function getCustomersWithStats(storeId: string, search?: string, sort?: string) {
  // Build the query
  let query = db
    .select({
      id: customers.id,
      email: customers.email,
      firstName: customers.firstName,
      lastName: customers.lastName,
      phone: customers.phone,
      city: customers.city,
      createdAt: customers.createdAt,
      reservationCount: count(reservations.id),
      totalSpent: sql<string>`COALESCE(SUM(${reservations.totalAmount}), 0)`,
      lastReservation: sql<Date | null>`MAX(${reservations.createdAt})`,
    })
    .from(customers)
    .leftJoin(reservations, eq(reservations.customerId, customers.id))
    .where(eq(customers.storeId, storeId))
    .groupBy(customers.id)
    .$dynamic()

  // Apply search filter
  if (search) {
    const searchLower = `%${search.toLowerCase()}%`
    query = query.where(
      sql`(
        LOWER(${customers.firstName}) LIKE ${searchLower} OR
        LOWER(${customers.lastName}) LIKE ${searchLower} OR
        LOWER(${customers.email}) LIKE ${searchLower} OR
        LOWER(${customers.phone}) LIKE ${searchLower}
      )`
    )
  }

  // Apply sorting
  switch (sort) {
    case 'name':
      query = query.orderBy(customers.lastName, customers.firstName)
      break
    case 'reservations':
      query = query.orderBy(desc(count(reservations.id)))
      break
    case 'spent':
      query = query.orderBy(desc(sql`COALESCE(SUM(${reservations.totalAmount}), 0)`))
      break
    default:
      query = query.orderBy(desc(customers.createdAt))
  }

  return query
}

export default async function CustomersPage({ searchParams }: CustomersPageProps) {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const params = await searchParams
  const customersList = await getCustomersWithStats(store.id, params.search, params.sort)

  // Get total customer count
  const totalCount = await db
    .select({ count: count() })
    .from(customers)
    .where(eq(customers.storeId, store.id))

  const t = await getTranslations('dashboard.customers')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">
          {t('description')}
        </p>
      </div>

      <CustomersFilters totalCount={totalCount[0]?.count || 0} />

      <CustomersTable customers={customersList} />
    </div>
  )
}
