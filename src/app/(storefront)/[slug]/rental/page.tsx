import type { Metadata } from 'next'
import { Suspense } from 'react'
import { getTranslations } from 'next-intl/server'
import { db } from '@/lib/db'
import { stores, products, categories, productPricingTiers, productAccessories } from '@/lib/db/schema'
import { eq, and, inArray, desc, asc } from 'drizzle-orm'
import { notFound, redirect } from 'next/navigation'

import { RentalContent } from './rental-content'
import { Skeleton } from '@/components/ui/skeleton'
import { generateStoreMetadata } from '@/lib/seo'
import type { StoreSettings, StoreTheme } from '@/types/store'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

interface RentalPageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{
    startDate?: string
    endDate?: string
    category?: string
    search?: string
  }>
}

export async function generateMetadata({
  params,
  searchParams,
}: RentalPageProps): Promise<Metadata> {
  const { slug } = await params
  const { startDate, endDate } = await searchParams

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
  })

  if (!store) {
    return { title: 'Boutique introuvable' }
  }

  const theme = (store.theme as StoreTheme) || {}
  const settings = (store.settings as StoreSettings) || {}

  // Format dates for title if valid
  let dateRange = ''
  if (startDate && endDate) {
    try {
      const start = new Date(startDate)
      const end = new Date(endDate)
      if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        dateRange = ` du ${format(start, 'd MMM', { locale: fr })} au ${format(end, 'd MMM yyyy', { locale: fr })}`
      }
    } catch {
      // Ignore date formatting errors
    }
  }

  return generateStoreMetadata(
    {
      id: store.id,
      name: store.name,
      slug: store.slug,
      settings,
      theme,
    },
    {
      title: `Disponibilités${dateRange} - ${store.name}`,
      description: `Consultez les équipements disponibles à la location${dateRange} chez ${store.name}.`,
      path: '/rental',
      noIndex: true, // Don't index search results pages
    }
  )
}

export default async function RentalPage({
  params,
  searchParams,
}: RentalPageProps) {
  const { slug } = await params
  const { startDate, endDate, category: categoryId, search } = await searchParams
  const t = await getTranslations('storefront.availability')

  // Redirect to homepage if no dates
  if (!startDate || !endDate) {
    redirect('/')
  }

  // Validate dates
  const start = new Date(startDate)
  const end = new Date(endDate)
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
    redirect('/')
  }

  // Fetch store
  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
  })

  if (!store) {
    notFound()
  }

  // Fetch categories
  const storeCategories = await db.query.categories.findMany({
    where: eq(categories.storeId, store.id),
    orderBy: [categories.order],
  })

  // Build conditions for products query
  const conditions = [
    eq(products.storeId, store.id),
    eq(products.status, 'active'),
  ]
  if (categoryId) {
    conditions.push(eq(products.categoryId, categoryId))
  }

  // Fetch product IDs first (lightweight query)
  // Order by displayOrder first (for manual sorting), then by createdAt for new products
  const productIds = await db
    .select({ id: products.id })
    .from(products)
    .where(and(...conditions))
    .orderBy(asc(products.displayOrder), desc(products.createdAt))

  // Fetch full product data
  interface PricingTier {
    id: string
    minDuration: number
    discountPercent: string
    displayOrder: number | null
  }
  interface Accessory {
    id: string
    name: string
    price: string
    deposit: string
    images: string[] | null
    quantity: number
    pricingMode: 'day' | 'hour' | 'week' | null
    pricingTiers?: PricingTier[]
  }
  let productsList: (typeof products.$inferSelect & { category: typeof categories.$inferSelect | null; pricingTiers?: PricingTier[]; accessories?: Accessory[] })[] = []
  if (productIds.length > 0) {
    const productIdsArray = productIds.map(p => p.id)

    // Fetch products with categories
    const productResults = await db
      .select({
        id: products.id,
        storeId: products.storeId,
        categoryId: products.categoryId,
        name: products.name,
        description: products.description,
        images: products.images,
        price: products.price,
        deposit: products.deposit,
        pricingMode: products.pricingMode,
        videoUrl: products.videoUrl,
        quantity: products.quantity,
        status: products.status,
        displayOrder: products.displayOrder,
        createdAt: products.createdAt,
        updatedAt: products.updatedAt,
        taxSettings: products.taxSettings,
        categoryName: categories.name,
        categoryStoreId: categories.storeId,
        categoryDescription: categories.description,
        categoryImageUrl: categories.imageUrl,
        categoryOrder: categories.order,
        categoryCreatedAt: categories.createdAt,
        categoryUpdatedAt: categories.updatedAt,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(inArray(products.id, productIdsArray))

    // Fetch pricing tiers for all products
    const pricingTiersResults = await db
      .select()
      .from(productPricingTiers)
      .where(inArray(productPricingTiers.productId, productIdsArray))

    // Group pricing tiers by product ID
    const pricingTiersByProductId = new Map<string, PricingTier[]>()
    for (const tier of pricingTiersResults) {
      const tiers = pricingTiersByProductId.get(tier.productId) || []
      tiers.push({
        id: tier.id,
        minDuration: tier.minDuration,
        discountPercent: tier.discountPercent,
        displayOrder: tier.displayOrder,
      })
      pricingTiersByProductId.set(tier.productId, tiers)
    }

    // Fetch accessories for all products
    const accessoriesResults = await db
      .select({
        productId: productAccessories.productId,
        accessoryId: productAccessories.accessoryId,
        displayOrder: productAccessories.displayOrder,
      })
      .from(productAccessories)
      .where(inArray(productAccessories.productId, productIdsArray))
      .orderBy(asc(productAccessories.displayOrder))

    // Get unique accessory IDs
    const accessoryIds = [...new Set(accessoriesResults.map((a) => a.accessoryId))]

    // Fetch accessory product details
    let accessoryProductsRaw: {
      id: string
      name: string
      price: string
      deposit: string | null
      images: string[] | null
      quantity: number
      status: 'active' | 'draft' | 'archived' | null
      pricingMode: 'day' | 'hour' | 'week' | null
    }[] = []
    if (accessoryIds.length > 0) {
      accessoryProductsRaw = await db
        .select({
          id: products.id,
          name: products.name,
          price: products.price,
          deposit: products.deposit,
          images: products.images,
          quantity: products.quantity,
          status: products.status,
          pricingMode: products.pricingMode,
        })
        .from(products)
        .where(inArray(products.id, accessoryIds))
    }

    // Fetch pricing tiers for accessories
    const accessoryPricingTiers = accessoryIds.length > 0
      ? await db
          .select()
          .from(productPricingTiers)
          .where(inArray(productPricingTiers.productId, accessoryIds))
      : []

    // Group accessory pricing tiers
    const accessoryTiersByProductId = new Map<string, PricingTier[]>()
    for (const tier of accessoryPricingTiers) {
      const tiers = accessoryTiersByProductId.get(tier.productId) || []
      tiers.push({
        id: tier.id,
        minDuration: tier.minDuration,
        discountPercent: tier.discountPercent,
        displayOrder: tier.displayOrder,
      })
      accessoryTiersByProductId.set(tier.productId, tiers)
    }

    // Create map of accessory products
    const accessoryProductMap = new Map(accessoryProductsRaw.map((p) => [p.id, p]))

    // Group accessories by product ID with full details
    interface ProductAccessory {
      id: string
      name: string
      price: string
      deposit: string
      images: string[] | null
      quantity: number
      pricingMode: 'day' | 'hour' | 'week' | null
      pricingTiers?: PricingTier[]
    }
    const accessoriesByProductId = new Map<string, ProductAccessory[]>()
    for (const acc of accessoriesResults) {
      const accessoryProduct = accessoryProductMap.get(acc.accessoryId)
      // Only include active accessories with stock
      if (accessoryProduct && accessoryProduct.status === 'active' && accessoryProduct.quantity > 0) {
        const accessories = accessoriesByProductId.get(acc.productId) || []
        accessories.push({
          id: accessoryProduct.id,
          name: accessoryProduct.name,
          price: accessoryProduct.price,
          deposit: accessoryProduct.deposit || '0',
          images: accessoryProduct.images,
          quantity: accessoryProduct.quantity,
          pricingMode: accessoryProduct.pricingMode,
          pricingTiers: accessoryTiersByProductId.get(accessoryProduct.id),
        })
        accessoriesByProductId.set(acc.productId, accessories)
      }
    }

    const productMap = new Map(productResults.map(p => [p.id, p]))
    productsList = productIds
      .map(({ id }) => productMap.get(id))
      .filter((p): p is NonNullable<typeof p> => p !== undefined)
      .map((row) => ({
        id: row.id,
        storeId: row.storeId,
        categoryId: row.categoryId,
        name: row.name,
        description: row.description,
        images: row.images,
        price: row.price,
        deposit: row.deposit,
        pricingMode: row.pricingMode,
        videoUrl: row.videoUrl,
        quantity: row.quantity,
        status: row.status,
        displayOrder: row.displayOrder,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        taxSettings: row.taxSettings,
        category: row.categoryId && row.categoryName
          ? {
              id: row.categoryId,
              storeId: row.categoryStoreId!,
              name: row.categoryName,
              description: row.categoryDescription,
              imageUrl: row.categoryImageUrl,
              order: row.categoryOrder!,
              createdAt: row.categoryCreatedAt!,
              updatedAt: row.categoryUpdatedAt!,
            }
          : null,
        pricingTiers: pricingTiersByProductId.get(row.id) || [],
        accessories: accessoriesByProductId.get(row.id) || [],
      }))
  }

  // Filter by search term if provided
  const filteredProducts = search
    ? productsList.filter(
        (p) =>
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          p.description?.toLowerCase().includes(search.toLowerCase())
      )
    : productsList

  const pricingMode = store.settings?.pricingMode || 'day'

  return (
    <div className="min-h-screen">
      <Suspense
        fallback={
          <div className="container mx-auto px-4 py-8">
            <div className="grid lg:grid-cols-[1fr_320px] gap-8">
              <div className="space-y-6">
                <Skeleton className="h-8 w-48" />
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
                  {[...Array(6)].map((_, i) => (
                    <Skeleton key={i} className="aspect-square rounded-lg" />
                  ))}
                </div>
              </div>
              <Skeleton className="h-96 rounded-lg hidden lg:block" />
            </div>
          </div>
        }
      >
        <RentalContent
          store={store}
          products={filteredProducts}
          categories={storeCategories}
          pricingMode={pricingMode}
          startDate={startDate}
          endDate={endDate}
          categoryId={categoryId}
          searchTerm={search}
        />
      </Suspense>
    </div>
  )
}
