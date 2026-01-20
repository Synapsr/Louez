import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { db } from '@/lib/db'
import { stores, products, categories } from '@/lib/db/schema'
import { eq, and, ne, asc, desc } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { ArrowLeft, Check, ImageIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { formatCurrency } from '@/lib/utils'
import type { StoreSettings, StoreTheme } from '@/types/store'
import { ProductCard } from '@/components/storefront/product-card'
import { PricingTiersDisplay } from '@/components/storefront/pricing-tiers-display'
import { ProductGallery } from './product-gallery'
import { AddToCartForm } from './add-to-cart-form'
import { getEffectivePricingMode } from '@/lib/pricing'
import {
  generateProductMetadata,
  generateProductSchema,
  generateBreadcrumbSchema,
  getCanonicalUrl,
  JsonLd,
} from '@/lib/seo'
import { PageTracker } from '@/components/storefront/page-tracker'

interface ProductPageProps {
  params: Promise<{ slug: string; productId: string }>
}

export async function generateMetadata({
  params,
}: ProductPageProps): Promise<Metadata> {
  const { slug, productId } = await params

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
  })

  if (!store) {
    return { title: 'Boutique introuvable' }
  }

  const product = await db.query.products.findFirst({
    where: and(
      eq(products.id, productId),
      eq(products.storeId, store.id),
      eq(products.status, 'active')
    ),
    with: {
      category: true,
    },
  })

  if (!product) {
    return { title: 'Produit introuvable' }
  }

  const theme = (store.theme as StoreTheme) || {}
  const settings = (store.settings as StoreSettings) || {}

  return generateProductMetadata(
    {
      id: store.id,
      name: store.name,
      slug: store.slug,
      settings,
      theme,
    },
    {
      id: product.id,
      name: product.name,
      description: product.description,
      price: product.price,
      deposit: product.deposit,
      images: product.images,
      quantity: product.quantity,
      category: product.category
        ? { id: product.category.id, name: product.category.name }
        : null,
    },
    {
      path: `/product/${productId}`,
    }
  )
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug, productId } = await params
  const t = await getTranslations('storefront.product')
  const tCatalog = await getTranslations('storefront.catalog')

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
  })

  if (!store) {
    notFound()
  }

  const storeSettings = (store.settings as StoreSettings) || {}
  const currency = storeSettings.currency || 'EUR'

  const product = await db.query.products.findFirst({
    where: and(
      eq(products.id, productId),
      eq(products.storeId, store.id),
      eq(products.status, 'active')
    ),
    with: {
      category: true,
      pricingTiers: true,
      accessories: {
        orderBy: (acc, { asc }) => [asc(acc.displayOrder)],
        with: {
          accessory: {
            with: {
              pricingTiers: true,
            },
          },
        },
      },
    },
  })

  if (!product) {
    notFound()
  }

  // Filter accessories to only include active ones with stock
  const availableAccessories = (product.accessories || [])
    .filter((acc) => acc.accessory && acc.accessory.status === 'active' && acc.accessory.quantity > 0)
    .map((acc) => ({
      id: acc.accessory.id,
      name: acc.accessory.name,
      price: acc.accessory.price,
      deposit: acc.accessory.deposit || '0',
      images: acc.accessory.images,
      quantity: acc.accessory.quantity,
      pricingMode: acc.accessory.pricingMode,
      pricingTiers: acc.accessory.pricingTiers?.map((tier) => ({
        id: tier.id,
        minDuration: tier.minDuration,
        discountPercent: tier.discountPercent,
      })),
    }))

  // Get related products from same category
  const relatedProducts = product.categoryId
    ? await db.query.products.findMany({
        where: and(
          eq(products.storeId, store.id),
          eq(products.status, 'active'),
          eq(products.categoryId, product.categoryId),
          ne(products.id, product.id)
        ),
        with: {
          pricingTiers: true,
        },
        orderBy: [asc(products.displayOrder), desc(products.createdAt)],
        limit: 4,
      })
    : []

  const storePricingMode = store.settings?.pricingMode || 'day'
  const effectivePricingMode = getEffectivePricingMode(product.pricingMode, storePricingMode)
  const isAvailable = product.quantity > 0

  // Prepare data for JSON-LD schemas
  const storeForSchema = {
    id: store.id,
    name: store.name,
    slug: store.slug,
    settings: storeSettings as StoreSettings,
  }

  const productForSchema = {
    id: product.id,
    name: product.name,
    description: product.description,
    price: product.price,
    deposit: product.deposit,
    images: product.images,
    quantity: product.quantity,
    category: product.category
      ? { id: product.category.id, name: product.category.name }
      : null,
  }

  // Build breadcrumb items
  const breadcrumbItems: { name: string; url?: string }[] = [
    { name: store.name, url: getCanonicalUrl(slug) },
    { name: 'Catalogue', url: getCanonicalUrl(slug, '/catalog') },
  ]
  if (product.category) {
    breadcrumbItems.push({
      name: product.category.name,
      url: getCanonicalUrl(slug, `/catalog?category=${product.category.id}`),
    })
  }
  breadcrumbItems.push({ name: product.name })

  return (
    <>
      <PageTracker page="product" productId={productId} />
      {/* JSON-LD Structured Data */}
      <JsonLd
        data={[
          generateProductSchema(storeForSchema, productForSchema),
          generateBreadcrumbSchema(storeForSchema, breadcrumbItems),
        ]}
      />

      <div className="container mx-auto px-4 py-8">
        {/* Breadcrumb */}
      <nav className="mb-6">
        <ol className="flex items-center gap-2 text-sm text-muted-foreground">
          <li>
            <Link href="/" className="hover:text-foreground">
              {t('breadcrumb.home')}
            </Link>
          </li>
          <li>/</li>
          <li>
            <Link href="/catalog" className="hover:text-foreground">
              {t('breadcrumb.catalog')}
            </Link>
          </li>
          {product.category && (
            <>
              <li>/</li>
              <li>
                <Link
                  href={`/catalog?category=${product.category.id}`}
                  className="hover:text-foreground"
                >
                  {product.category.name}
                </Link>
              </li>
            </>
          )}
          <li>/</li>
          <li className="text-foreground">{product.name}</li>
        </ol>
      </nav>

      <div className="grid lg:grid-cols-2 gap-8 lg:gap-12">
        {/* Gallery */}
        <ProductGallery images={product.images || []} productName={product.name} />

        {/* Product Info */}
        <div className="space-y-6">
          {product.category && (
            <Badge variant="secondary">{product.category.name}</Badge>
          )}

          <h1 className="text-3xl font-bold">{product.name}</h1>

          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold">
              {formatCurrency(parseFloat(product.price), currency)}
            </span>
            <span className="text-lg text-muted-foreground">
              / {t(`pricingUnit.${effectivePricingMode}.singular`)}
            </span>
          </div>

          {product.deposit && parseFloat(product.deposit) > 0 && (
            <p className="text-sm text-muted-foreground">
              {t('deposit')}: {formatCurrency(parseFloat(product.deposit), currency)}
            </p>
          )}

          {/* Pricing Tiers Display */}
          {product.pricingTiers && product.pricingTiers.length > 0 && (
            <PricingTiersDisplay
              basePrice={parseFloat(product.price)}
              pricingMode={effectivePricingMode}
              tiers={product.pricingTiers}
              className="mt-4"
            />
          )}

          <div className="flex items-center gap-2">
            {isAvailable ? (
              <>
                <Check className="h-5 w-5 text-green-500" />
                <span className="text-green-600 font-medium">
                  {t('availableCount', { count: product.quantity })}
                </span>
              </>
            ) : (
              <Badge variant="destructive">{tCatalog('unavailable')}</Badge>
            )}
          </div>

          <Separator />

          {/* Add to Cart Form */}
          {isAvailable && (
            <AddToCartForm
              productId={product.id}
              productName={product.name}
              productImage={product.images?.[0] || null}
              price={parseFloat(product.price)}
              deposit={product.deposit ? parseFloat(product.deposit) : 0}
              maxQuantity={product.quantity}
              pricingMode={effectivePricingMode}
              storePricingMode={storePricingMode}
              storeSlug={slug}
              pricingTiers={product.pricingTiers?.map((tier) => ({
                id: tier.id,
                minDuration: tier.minDuration,
                discountPercent: parseFloat(tier.discountPercent),
              }))}
              productPricingMode={product.pricingMode}
              advanceNotice={storeSettings.advanceNotice || 0}
              accessories={availableAccessories}
            />
          )}

          {/* Description */}
          {product.description && (
            <div className="mt-8">
              <h2 className="text-lg font-semibold mb-2">{t('description')}</h2>
              <p className="text-muted-foreground whitespace-pre-line">
                {product.description}
              </p>
            </div>
          )}
        </div>
      </div>

        {/* Related Products */}
        {relatedProducts.length > 0 && (
          <section className="mt-16">
            <h2 className="text-2xl font-bold mb-6">{t('relatedProducts')}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {relatedProducts.map((relatedProduct) => (
                <ProductCard
                  key={relatedProduct.id}
                  product={relatedProduct}
                  storeSlug={slug}
                  pricingMode={storePricingMode}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  )
}
