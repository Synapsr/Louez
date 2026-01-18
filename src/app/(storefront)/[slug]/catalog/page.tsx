import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { db } from '@/lib/db'
import { stores, products, categories, productPricingTiers } from '@/lib/db/schema'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { Calendar, ArrowRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ProductGridWithPreview } from '@/components/storefront/product-grid-with-preview'
import { CatalogDatePicker } from '@/components/storefront/catalog-date-picker'
import {
  generateStoreMetadata,
  generateItemListSchema,
  generateBreadcrumbSchema,
  getCanonicalUrl,
  JsonLd,
} from '@/lib/seo'
import type { StoreSettings, StoreTheme } from '@/types/store'
import { PageTracker } from '@/components/storefront/page-tracker'

interface CatalogPageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{
    category?: string
    search?: string
  }>
}

export async function generateMetadata({
  params,
  searchParams,
}: CatalogPageProps): Promise<Metadata> {
  const { slug } = await params
  const { category: categoryId } = await searchParams

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
  })

  if (!store) {
    return { title: 'Boutique introuvable' }
  }

  const theme = (store.theme as StoreTheme) || {}
  const settings = (store.settings as StoreSettings) || {}

  // If a category is selected, get its name
  let categoryName: string | null = null
  if (categoryId) {
    const category = await db.query.categories.findFirst({
      where: and(eq(categories.id, categoryId), eq(categories.storeId, store.id)),
    })
    categoryName = category?.name || null
  }

  const title = categoryName
    ? `${categoryName} - Catalogue ${store.name}`
    : `Catalogue - ${store.name}`

  const description = categoryName
    ? `Découvrez notre sélection de ${categoryName.toLowerCase()} disponibles à la location chez ${store.name}.`
    : `Parcourez notre catalogue complet de matériel à louer chez ${store.name}. Réservation en ligne facile.`

  return generateStoreMetadata(
    {
      id: store.id,
      name: store.name,
      slug: store.slug,
      description: store.description,
      logoUrl: store.logoUrl,
      settings,
      theme,
    },
    {
      title,
      description,
      path: categoryId ? `/catalog?category=${categoryId}` : '/catalog',
    }
  )
}

export default async function CatalogPage({
  params,
  searchParams,
}: CatalogPageProps) {
  const { slug } = await params
  const { category: categoryId, search } = await searchParams
  const t = await getTranslations('storefront.catalog')

  // Fetch store without products relation to avoid lateral join issues
  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
  })

  if (!store) {
    notFound()
  }

  // Fetch categories separately
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

  // Step 1: Get product IDs (lightweight query with ORDER BY)
  const productIds = await db
    .select({ id: products.id })
    .from(products)
    .where(and(...conditions))
    .orderBy(desc(products.createdAt))

  // Step 2: Fetch full product data (no ORDER BY needed)
  interface PricingTier {
    id: string
    minDuration: number
    discountPercent: string
    displayOrder: number | null
  }
  let productsList: (typeof products.$inferSelect & { category: typeof categories.$inferSelect | null; pricingTiers?: PricingTier[] })[] = []
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

    // Create a map for O(1) lookup and preserve order
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
  const activeCategory = storeCategories.find((c) => c.id === categoryId)
  const settings = (store.settings as StoreSettings) || {}
  const businessHours = settings.businessHours
  const advanceNotice = settings.advanceNotice || 0

  // Prepare data for JSON-LD
  const storeForSchema = {
    id: store.id,
    name: store.name,
    slug: store.slug,
    settings,
  }

  const productsForSchema = filteredProducts.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    price: p.price,
    images: p.images,
    quantity: p.quantity,
    category: p.category ? { id: p.category.id, name: p.category.name } : null,
  }))

  const listName = activeCategory
    ? `${activeCategory.name} - ${store.name}`
    : `Catalogue - ${store.name}`

  // Generate breadcrumbs
  const breadcrumbItems = [
    { name: store.name, url: getCanonicalUrl(slug) },
    { name: 'Catalogue', url: getCanonicalUrl(slug, '/catalog') },
  ]
  if (activeCategory) {
    breadcrumbItems.push({
      name: activeCategory.name,
      url: getCanonicalUrl(slug, `/catalog?category=${activeCategory.id}`),
    })
  }

  return (
    <>
      <PageTracker page="catalog" categoryId={categoryId} />
      {/* JSON-LD Structured Data */}
      <JsonLd
        data={[
          generateBreadcrumbSchema(storeForSchema, breadcrumbItems),
          ...(filteredProducts.length > 0
            ? [generateItemListSchema(storeForSchema, productsForSchema, listName)]
            : []),
        ]}
      />

      <div className="min-h-screen">
        {/* Header Section */}
      <section className="bg-muted/30 border-b">
        <div className="container mx-auto px-4 py-6 md:py-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="shrink-0">
              <h1 className="text-2xl md:text-3xl font-bold">
                {activeCategory ? activeCategory.name : t('title')}
              </h1>
              <p className="text-muted-foreground mt-1">
                {t('productCount', { count: filteredProducts.length })}
              </p>
            </div>

            {/* Date picker */}
            <CatalogDatePicker
              storeSlug={slug}
              pricingMode={pricingMode}
              businessHours={businessHours}
              advanceNotice={advanceNotice}
            />
          </div>

          {/* Category Pills */}
          {storeCategories.length > 0 && (
            <div className="flex items-center gap-2 mt-6 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0">
              <Link
                href="/catalog"
                className={`shrink-0 px-4 py-2 text-sm font-medium rounded-full transition-colors ${
                  !categoryId
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background border hover:bg-muted text-foreground'
                }`}
              >
                {t('allProducts')}
              </Link>
              {storeCategories.map((cat) => (
                <Link
                  key={cat.id}
                  href={`/catalog?category=${cat.id}`}
                  className={`shrink-0 px-4 py-2 text-sm font-medium rounded-full transition-colors ${
                    categoryId === cat.id
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background border hover:bg-muted text-foreground'
                  }`}
                >
                  {cat.name}
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Products Grid Section */}
      <section className="container mx-auto px-4 py-8 md:py-10">
        {/* Products Grid */}
        {filteredProducts.length > 0 ? (
          <ProductGridWithPreview
            products={filteredProducts}
            storeSlug={slug}
            storePricingMode={pricingMode}
            businessHours={businessHours}
            advanceNotice={advanceNotice}
          />
        ) : (
          <Card className="py-16">
            <CardContent className="text-center">
              <Calendar className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
              <p className="text-muted-foreground mb-4">
                {search ? t('noProductsFor', { search }) : t('noProducts')}
              </p>
              <Button variant="outline" asChild>
                <Link href="/#date-picker">
                  {t('backToHome')}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}
        </section>
      </div>
    </>
  )
}
