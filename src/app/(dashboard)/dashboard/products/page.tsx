import { Suspense } from 'react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { db } from '@/lib/db'
import { products, categories } from '@/lib/db/schema'
import { eq, desc, and, count, inArray } from 'drizzle-orm'
import { Plus, FolderOpen } from 'lucide-react'

import { getCurrentStore } from '@/lib/store-context'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ProductsTable } from './products-table'
import { ProductsFilters } from './products-filters'

async function getProducts(storeId: string, searchParams: { status?: string; category?: string }) {
  const conditions = [eq(products.storeId, storeId)]

  if (searchParams.status && searchParams.status !== 'all') {
    conditions.push(eq(products.status, searchParams.status as 'draft' | 'active' | 'archived'))
  }

  if (searchParams.category && searchParams.category !== 'all') {
    conditions.push(eq(products.categoryId, searchParams.category))
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

  const t = await getTranslations('dashboard.products')

  const params = await searchParams
  const [productsList, categoriesList, productCounts] = await Promise.all([
    getProducts(store.id, params),
    getCategories(store.id),
    getProductCounts(store.id),
  ])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">
            {t('description')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/dashboard/categories">
              <FolderOpen className="mr-2 h-4 w-4" />
              {t('manageCategories')}
            </Link>
          </Button>
          <Button asChild>
            <Link href="/dashboard/products/new">
              <Plus className="mr-2 h-4 w-4" />
              {t('addProduct')}
            </Link>
          </Button>
        </div>
      </div>

      {/* Filters */}
      <ProductsFilters
        categories={categoriesList}
        counts={productCounts}
        currentStatus={params.status}
        currentCategory={params.category}
      />

      {/* Products Table */}
      <Suspense fallback={<ProductsTableSkeleton />}>
        <ProductsTable products={productsList} />
      </Suspense>
    </div>
  )
}
