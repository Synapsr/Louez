import { db } from '@/lib/db'
import { getCurrentStore } from '@/lib/store-context'
import { customers, reservations } from '@/lib/db/schema'
import { eq, count, sql, desc } from 'drizzle-orm'
import { redirect } from 'next/navigation'

import { getStoreLimits, getStorePlan } from '@/lib/plan-limits'
import { CustomersPageContent } from './customers-page-content'

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
      customerType: customers.customerType,
      email: customers.email,
      firstName: customers.firstName,
      lastName: customers.lastName,
      companyName: customers.companyName,
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
        LOWER(${customers.phone}) LIKE ${searchLower} OR
        LOWER(${customers.companyName}) LIKE ${searchLower}
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
  const [customersList, totalCountResult, limits, plan] = await Promise.all([
    getCustomersWithStats(store.id, params.search, params.sort),
    db.select({ count: count() }).from(customers).where(eq(customers.storeId, store.id)),
    getStoreLimits(store.id),
    getStorePlan(store.id),
  ])

  return (
    <CustomersPageContent
      customers={customersList}
      totalCount={totalCountResult[0]?.count || 0}
      limits={limits.customers}
      planSlug={plan.slug}
    />
  )
}
