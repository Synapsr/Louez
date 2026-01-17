import { Suspense } from 'react'
import { db } from '@/lib/db'
import { products, categories } from '@/lib/db/schema'
import { eq, desc, and, count, inArray } from 'drizzle-orm'

import { getCurrentStore } from '@/lib/store-context'
import { getStoreLimits, getStorePlan } from '@/lib/plan-limits'
import { Skeleton } from '@/components/ui/skeleton'
import { ProductsPageContent } from './products-page-content'

async function getProducts(storeId: string, searchParams: { status?: string; category?: string }) {
  const conditions = [eq(products.storeId, storeId)]

  if (searchParams.status && searchParams.status !== 'all') {
    conditions.push(eq(products.status, searchParams.status as 'draft' | 'active' | 'archived'))
  }

  if (searchParams.category && searchParams.category !== 'all') {
    conditions.push(eq(products.categoryId, searchParams.category))
  }

  // Exclude archived from limit calculations
  if (!searchParams.status || searchParams.status === 'all') {
    // Don't filter by status for display, but we'll handle archived separately
  }

  // Step 1: Get product IDs with lightweight columns (excludes images to avoid sort buffer overflow)
  const productIds = await db
    .select({
      id: products.id,
    })
    .from(products)
    .where(and(...conditions))
    .orderBy(desc(products.createdAt))
    .limit(100)

  if (productIds.length === 0) {
    return []
  }

  // Step 2: Fetch full data for those products (no ORDER BY needed, small result set)
  const results = await db
    .select({
      id: products.id,
      name: products.name,
      images: products.images,
      price: products.price,
      deposit: products.deposit,
      quantity: products.quantity,
      status: products.status,
      categoryId: products.categoryId,
      createdAt: products.createdAt,
      categoryName: categories.name,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(inArray(products.id, productIds.map(p => p.id)))

  // Create a map for O(1) lookup and preserve order from first query
  const resultsMap = new Map(results.map(r => [r.id, r]))

  // Transform to expected format, preserving original order
  return productIds
    .map(({ id }) => resultsMap.get(id))
    .filter((row): row is NonNullable<typeof row> => row !== undefined)
    .map((row) => ({
      id: row.id,
      name: row.name,
      images: row.images,
      price: row.price,
      deposit: row.deposit,
      quantity: row.quantity,
      status: row.status,
      category: row.categoryId && row.categoryName
        ? { id: row.categoryId, name: row.categoryName }
        : null,
    }))
}

async function getCategories(storeId: string) {
  return db.query.categories.findMany({
    where: eq(categories.storeId, storeId),
    orderBy: [categories.order],
  })
}

async function getProductCounts(storeId: string) {
  const allCount = await db
    .select({ count: count() })
    .from(products)
    .where(eq(products.storeId, storeId))

  const activeCount = await db
    .select({ count: count() })
    .from(products)
    .where(and(eq(products.storeId, storeId), eq(products.status, 'active')))

  const draftCount = await db
    .select({ count: count() })
    .from(products)
    .where(and(eq(products.storeId, storeId), eq(products.status, 'draft')))

  const archivedCount = await db
    .select({ count: count() })
    .from(products)
    .where(and(eq(products.storeId, storeId), eq(products.status, 'archived')))

  return {
    all: allCount[0]?.count || 0,
    active: activeCount[0]?.count || 0,
    draft: draftCount[0]?.count || 0,
    archived: archivedCount[0]?.count || 0,
  }
}

function ProductsTableSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="rounded-md border">
        <div className="p-4 space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-12 w-12 rounded" />
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

interface ProductsPageProps {
  searchParams: Promise<{ status?: string; category?: string }>
}

export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const store = await getCurrentStore()
  if (!store) return null

  const params = await searchParams
  const [productsList, categoriesList, productCounts, limits, plan] = await Promise.all([
    getProducts(store.id, params),
    getCategories(store.id),
    getProductCounts(store.id),
    getStoreLimits(store.id),
    getStorePlan(store.id),
  ])

  return (
    <Suspense fallback={<ProductsTableSkeleton />}>
      <ProductsPageContent
        products={productsList}
        categories={categoriesList}
        counts={productCounts}
        currentStatus={params.status}
        currentCategory={params.category}
        limits={limits.products}
        planSlug={plan.slug}
        currency={store.settings?.currency}
      />
    </Suspense>
  )
}
