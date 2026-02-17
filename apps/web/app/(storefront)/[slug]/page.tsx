import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { getTranslations } from 'next-intl/server'
import { db } from '@louez/db'
import { stores, products, categories } from '@louez/db'
import { eq, desc, asc, and, inArray } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { ArrowRight, Calendar, Shield, Truck, Sparkles, ChevronRight, MapPin, Phone, Mail, User, KeyRound, CheckCircle, Star } from 'lucide-react'

import { Button } from '@louez/ui'
import { Card, CardContent } from '@louez/ui'
import { ProductGridWithPreview } from '@/components/storefront/product-grid-with-preview'
import { StoreMap } from '@/components/storefront/store-map'
import { HeroDatePicker } from '@/components/storefront/hero-date-picker'
import { HeroImageSlider } from '@/components/storefront/hero-image-slider'
import { StoreStatusBadge } from '@/components/storefront/store-status-badge'
import { GoogleReviewsSection } from '@/components/storefront/google-reviews-section'
import {
  generateStoreMetadata,
  generateLocalBusinessSchema,
  generateWebSiteSchema,
  JsonLd,
  stripHtml,
} from '@/lib/seo'
import type { StoreTheme, StoreSettings, ReviewBoosterSettings } from '@louez/types'
import { getMinRentalMinutes } from '@/lib/utils/rental-duration'
import { PageTracker } from '@/components/storefront/page-tracker'

interface StorefrontPageProps {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({
  params,
}: StorefrontPageProps): Promise<Metadata> {
  const { slug } = await params

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
  })

  if (!store) {
    return { title: 'Boutique introuvable' }
  }

  const theme = (store.theme as StoreTheme) || {}
  const settings = (store.settings as StoreSettings) || {}

  // Use hero images for OG if available
  const ogImages = theme.heroImages?.length
    ? theme.heroImages.slice(0, 1)
    : store.logoUrl
      ? [store.logoUrl]
      : []

  return generateStoreMetadata(
    {
      id: store.id,
      name: store.name,
      slug: store.slug,
      description: store.description,
      email: store.email,
      phone: store.phone,
      address: store.address,
      latitude: store.latitude,
      longitude: store.longitude,
      logoUrl: store.logoUrl,
      settings,
      theme,
    },
    {
      title: `${store.name} - Location de matériel`,
      description: store.description
        ? stripHtml(store.description)
        : `Louez du matériel chez ${store.name}. Réservation en ligne simple et rapide.`,
      images: ogImages,
    }
  )
}

export default async function StorefrontPage({ params }: StorefrontPageProps) {
  const { slug } = await params
  const t = await getTranslations('storefront')

  // Fetch store without relations to avoid lateral join issues
  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
  })

  if (!store) {
    notFound()
  }

  // Fetch categories separately (lightweight, no images column issues)
  const storeCategories = await db.query.categories.findMany({
    where: eq(categories.storeId, store.id),
    orderBy: [categories.order],
  })

  // Fetch products in two steps to avoid sort buffer overflow
  // Step 1: Get product IDs (lightweight query with ORDER BY)
  // Order by displayOrder first (for manual sorting), then by createdAt for new products
  const productIds = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.storeId, store.id), eq(products.status, 'active')))
    .orderBy(asc(products.displayOrder), desc(products.createdAt))
    .limit(8)

  // Step 2: Fetch full product data with pricing tiers and category (no ORDER BY needed)
  let storeProducts: (typeof products.$inferSelect & {
    pricingTiers?: {
      id: string
      minDuration: number | null
      discountPercent: string | null
      period: number | null
      price: string | null
      displayOrder: number | null
    }[]
    category?: { name: string } | null
  })[] = []
  if (productIds.length > 0) {
    const productResults = await db.query.products.findMany({
      where: inArray(products.id, productIds.map(p => p.id)),
      with: {
        pricingTiers: true,
        category: true,
      },
    })
    // Preserve order from first query
    const productMap = new Map(productResults.map(p => [p.id, p]))
    storeProducts = productIds
      .map(({ id }) => productMap.get(id))
      .filter((p): p is NonNullable<typeof p> => p !== undefined)
  }

  // Combine into expected structure
  const storeWithRelations = {
    ...store,
    categories: storeCategories,
    products: storeProducts,
  }

  const pricingMode = 'day' as const
  const primaryColor = storeWithRelations.theme?.primaryColor || '#0066FF'
  const businessHours = storeWithRelations.settings?.businessHours
  const timezone = storeWithRelations.settings?.timezone
  const advanceNotice = storeWithRelations.settings?.advanceNoticeMinutes || 0
  const minRentalMinutes = getMinRentalMinutes(
    storeWithRelations.settings as StoreSettings | null
  )
  const heroImages = storeWithRelations.theme?.heroImages || []
  const hasHeroImages = heroImages.length > 0
  const reviewBoosterSettings = store.reviewBoosterSettings as ReviewBoosterSettings | null

  // Prepare store data for JSON-LD
  const storeForSchema = {
    id: store.id,
    name: store.name,
    slug: store.slug,
    description: store.description,
    email: store.email,
    phone: store.phone,
    address: store.address,
    latitude: store.latitude,
    longitude: store.longitude,
    logoUrl: store.logoUrl,
    settings: storeWithRelations.settings as StoreSettings | null,
    theme: storeWithRelations.theme as StoreTheme | null,
  }

  return (
    <>
      <PageTracker page="home" />
      {/* JSON-LD Structured Data */}
      <JsonLd
        data={[
          generateLocalBusinessSchema(storeForSchema),
          generateWebSiteSchema(storeForSchema),
        ]}
      />

      <div className="overflow-hidden -mt-20 md:-mt-24">
        {/* Hero Section */}
      <section className="relative">
        {/* Hero with images - full width background */}
        {hasHeroImages ? (
          <div className="relative min-h-screen flex items-center">
            {/* Background Image Slider */}
            <div className="absolute inset-0">
              <HeroImageSlider images={heroImages} className="w-full h-full" fullscreen />
            </div>

            {/* Modern diagonal gradient overlay */}
            <div
              className="absolute inset-0"
              style={{
                background: `linear-gradient(108deg,
                  hsl(var(--background)) 0%,
                  hsl(var(--background)) 35%,
                  hsl(var(--background) / 0.85) 45%,
                  hsl(var(--background) / 0.4) 55%,
                  transparent 65%
                )`,
              }}
            />
            {/* Subtle color accent from primary */}
            <div
              className="absolute inset-0 opacity-[0.03]"
              style={{
                background: `linear-gradient(135deg, ${primaryColor} 0%, transparent 50%)`,
              }}
            />
            {/* Bottom gradient for content readability */}
            <div className="absolute inset-0 bg-gradient-to-t from-background/40 via-transparent to-transparent" />

            {/* Left-aligned Content */}
            <div className="relative z-10 container mx-auto px-4 py-20 md:py-24">
              {/* Glassmorphism content card */}
              <div className="max-w-lg lg:max-w-xl bg-background/70 dark:bg-background/80 backdrop-blur-xl rounded-3xl p-6 md:p-8 shadow-2xl border border-white/10">
                {/* Store name */}
                <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight mb-3">
                  {storeWithRelations.name}
                </h1>

                {/* Status and rating badges */}
                <div className="flex flex-wrap items-center gap-3 mb-4">
                  <StoreStatusBadge businessHours={businessHours} timezone={timezone} />
                  {reviewBoosterSettings?.googleRating && (
                    <div className="flex items-center gap-1.5 bg-amber-500/10 rounded-full px-3 py-1 text-sm">
                      <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                      <span className="font-medium">{reviewBoosterSettings.googleRating.toFixed(1)}</span>
                      {reviewBoosterSettings.googleReviewCount && (
                        <span className="text-muted-foreground text-xs">({reviewBoosterSettings.googleReviewCount})</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Tagline */}
                <p className="text-base md:text-lg text-muted-foreground mb-5">
                  {t('hero.tagline')}
                </p>

                {/* Reassurance badges */}
                <div className="flex flex-wrap gap-2 text-xs md:text-sm mb-6">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <CheckCircle className="h-4 w-4 text-primary" />
                    <span>{t('hero.instantConfirmation')}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="text-border">•</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Shield className="h-4 w-4 text-primary" />
                    <span>{t('hero.securePayment')}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="text-border">•</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <MapPin className="h-4 w-4 text-primary" />
                    <span>{t('hero.localPickup')}</span>
                  </div>
                </div>

                {/* Date Picker */}
                <div id="date-picker">
                  <Suspense fallback={<div className="h-40 bg-muted/30 rounded-2xl animate-pulse" />}>
                    <HeroDatePicker
                      storeSlug={slug}
                      pricingMode={pricingMode}
                      businessHours={businessHours}
                      advanceNotice={advanceNotice}
                      minRentalMinutes={minRentalMinutes}
                      timezone={timezone}
                    />
                  </Suspense>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Hero without images - centered layout */
          <div className="relative min-h-screen flex items-center justify-center">
            {/* Subtle background gradient */}
            <div
              className="absolute inset-0 opacity-5"
              style={{
                background: `radial-gradient(ellipse at center, ${primaryColor} 0%, transparent 70%)`,
              }}
            />

            {/* Centered Content */}
            <div className="relative z-10 container mx-auto px-4 py-20">
              <div className="max-w-3xl mx-auto text-center">
                {/* Store name */}
                <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-3">
                  {storeWithRelations.name}
                </h1>

                {/* Status and rating badges */}
                <div className="flex flex-wrap justify-center items-center gap-3 mb-6">
                  <StoreStatusBadge businessHours={businessHours} timezone={timezone} />
                  {reviewBoosterSettings?.googleRating && (
                    <div className="flex items-center gap-1.5 bg-amber-500/10 rounded-full px-3 py-1.5 text-sm">
                      <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                      <span className="font-medium">{reviewBoosterSettings.googleRating.toFixed(1)}</span>
                      {reviewBoosterSettings.googleReviewCount && (
                        <span className="text-muted-foreground text-xs">({reviewBoosterSettings.googleReviewCount} {t('hero.reviewsBadge')})</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Tagline */}
                <p className="text-lg md:text-xl text-muted-foreground mb-6">
                  {t('hero.tagline')}
                </p>

                {/* Reassurance badges */}
                <div className="flex flex-wrap justify-center gap-2 md:gap-3 text-sm mb-8">
                  <div className="flex items-center gap-2 bg-muted/50 rounded-full px-3 py-1.5 md:px-4 md:py-2">
                    <CheckCircle className="h-4 w-4 text-primary" />
                    <span className="font-medium">{t('hero.instantConfirmation')}</span>
                  </div>
                  <div className="flex items-center gap-2 bg-muted/50 rounded-full px-3 py-1.5 md:px-4 md:py-2">
                    <Shield className="h-4 w-4 text-primary" />
                    <span className="font-medium">{t('hero.securePayment')}</span>
                  </div>
                  <div className="flex items-center gap-2 bg-muted/50 rounded-full px-3 py-1.5 md:px-4 md:py-2">
                    <MapPin className="h-4 w-4 text-primary" />
                    <span className="font-medium">{t('hero.localPickup')}</span>
                  </div>
                </div>

                {/* Date Picker - centered */}
                <div id="date-picker" className="flex justify-center">
                  <Suspense fallback={<div className="h-40 w-full max-w-2xl bg-muted/30 rounded-2xl animate-pulse" />}>
                    <HeroDatePicker
                      storeSlug={slug}
                      pricingMode={pricingMode}
                      businessHours={businessHours}
                      advanceNotice={advanceNotice}
                      minRentalMinutes={minRentalMinutes}
                      timezone={timezone}
                    />
                  </Suspense>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Description Section */}
      {storeWithRelations.description && (
        <section className="py-16 md:py-20">
          <div className="container mx-auto px-4">
            <div className="max-w-3xl mx-auto text-center">
              <div
                className="prose prose-lg dark:prose-invert prose-p:text-muted-foreground prose-headings:text-foreground prose-a:text-primary mx-auto"
                dangerouslySetInnerHTML={{ __html: storeWithRelations.description }}
              />
            </div>
          </div>
        </section>
      )}

      {/* Trust Badges */}
      <section className="py-12 md:py-16 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
            {[
              { icon: Calendar, title: t('hero.simpleReservation'), desc: t('hero.simpleReservationDesc') },
              { icon: Shield, title: t('hero.securePayment'), desc: t('hero.securePaymentDesc') },
              { icon: Truck, title: t('hero.localPickup'), desc: t('hero.localPickupDesc') },
            ].map((item, index) => (
              <div
                key={index}
                className="flex flex-col items-center text-center p-6 rounded-2xl bg-background"
              >
                <div
                  className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl"
                  style={{ backgroundColor: `${primaryColor}15` }}
                >
                  <item.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Featured Products Section */}
      <section className="py-16 md:py-20 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-10 md:mb-12">
            <div>
              <h2 className="text-3xl md:text-4xl font-bold">{t('home.ourProducts')}</h2>
              <p className="mt-3 text-muted-foreground max-w-lg">
                {t('home.productsDesc')}
              </p>
            </div>
            <Button variant="outline" className="group self-start" render={<Link href="/catalog" />}>
                {t('home.viewAll')}
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Button>
          </div>

          {storeWithRelations.products.length > 0 ? (
            <ProductGridWithPreview
              products={storeWithRelations.products}
              storeSlug={slug}
              businessHours={businessHours}
              advanceNotice={advanceNotice}
              timezone={timezone}
            />
          ) : (
            <Card className="py-16 text-center">
              <CardContent>
                <p className="text-muted-foreground">
                  {t('home.noProducts')}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </section>

      {/* Google Reviews Section */}
      {reviewBoosterSettings?.displayReviewsOnStorefront &&
        reviewBoosterSettings?.googlePlaceId && (
          <GoogleReviewsSection
            placeId={reviewBoosterSettings.googlePlaceId}
            primaryColor={primaryColor}
          />
        )}

      {/* Location Section */}
      {storeWithRelations.address && (
        <section className="py-16 md:py-20">
          <div className="container mx-auto px-4">
            <div className="text-center mb-10 md:mb-12">
              <h2 className="text-3xl md:text-4xl font-bold">
                {t('home.findUs')}
              </h2>
              <p className="mt-3 text-muted-foreground">
                {t('home.findUsDesc')}
              </p>
            </div>

            <div className="grid lg:grid-cols-2 gap-8 items-stretch">
              {/* Map Card */}
              {storeWithRelations.latitude && storeWithRelations.longitude ? (
                <Card className="overflow-hidden h-[400px]">
                  <StoreMap
                    latitude={parseFloat(storeWithRelations.latitude)}
                    longitude={parseFloat(storeWithRelations.longitude)}
                    storeName={storeWithRelations.name}
                    address={storeWithRelations.address}
                    primaryColor={primaryColor}
                    className="w-full h-full"
                  />
                </Card>
              ) : (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(storeWithRelations.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group"
                >
                  <Card className="relative overflow-hidden h-[400px] bg-gradient-to-br from-primary/5 via-background to-primary/10 hover:shadow-xl transition-all duration-300">
                    {/* Decorative map pattern */}
                    <div className="absolute inset-0 opacity-10">
                      <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                        <defs>
                          <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
                            <path d="M 10 0 L 0 0 0 10" fill="none" stroke="currentColor" strokeWidth="0.5"/>
                          </pattern>
                        </defs>
                        <rect width="100" height="100" fill="url(#grid)"/>
                      </svg>
                    </div>

                    {/* Content */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-8">
                      <div
                        className="mb-6 flex h-20 w-20 items-center justify-center rounded-full transition-transform duration-300 group-hover:scale-110"
                        style={{ backgroundColor: `${primaryColor}20` }}
                      >
                        <MapPin className="h-10 w-10 text-primary" />
                      </div>
                      <h3 className="text-xl font-semibold text-center mb-2">{storeWithRelations.name}</h3>
                      <p className="text-muted-foreground text-center max-w-xs whitespace-pre-line">
                        {storeWithRelations.address}
                      </p>
                      <div className="mt-6 flex items-center gap-2 text-primary font-medium opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all duration-300">
                        {t('home.viewOnMap')}
                        <ArrowRight className="h-4 w-4" />
                      </div>
                    </div>
                  </Card>
                </a>
              )}

              {/* Contact Info */}
              <div className="flex flex-col justify-center">
                <Card className="p-8">
                  <div className="space-y-6">
                    <div className="flex items-start gap-4">
                      <div
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
                        style={{ backgroundColor: `${primaryColor}15` }}
                      >
                        <MapPin className="h-6 w-6 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-lg">{t('home.address')}</h3>
                        <p className="mt-1 text-muted-foreground whitespace-pre-line">
                          {storeWithRelations.address}
                        </p>
                      </div>
                    </div>

                    {storeWithRelations.phone && (
                      <div className="flex items-start gap-4">
                        <div
                          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
                          style={{ backgroundColor: `${primaryColor}15` }}
                        >
                          <Phone className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-lg">{t('home.phone')}</h3>
                          <a
                            href={`tel:${storeWithRelations.phone}`}
                            className="mt-1 text-muted-foreground hover:text-primary transition-colors"
                          >
                            {storeWithRelations.phone}
                          </a>
                        </div>
                      </div>
                    )}

                    {storeWithRelations.email && (
                      <div className="flex items-start gap-4">
                        <div
                          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
                          style={{ backgroundColor: `${primaryColor}15` }}
                        >
                          <Mail className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-lg">{t('home.email')}</h3>
                          <a
                            href={`mailto:${storeWithRelations.email}`}
                            className="mt-1 text-muted-foreground hover:text-primary transition-colors"
                          >
                            {storeWithRelations.email}
                          </a>
                        </div>
                      </div>
                    )}

                    <div className="pt-4">
                      <Button
                        className="w-full"
                        variant="outline"
                        render={<a
                          href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(storeWithRelations.address)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        />}
                      >
                          <MapPin className="mr-2 h-4 w-4" />
                          {t('home.getDirections')}
                      </Button>
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Already Have a Reservation - Login CTA */}
      <section className="py-12 md:py-16 bg-muted/30">
        <div className="container mx-auto px-4">
          <Card className="bg-gradient-to-r from-primary/5 via-transparent to-primary/5">
            <CardContent className="p-6 md:p-8">
              <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                    <User className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold">{t('home.alreadyReserved')}</h3>
                    <p className="text-muted-foreground text-sm mt-0.5">
                      {t('home.alreadyReservedDesc')}
                    </p>
                  </div>
                </div>
                <Button variant="outline" className="shrink-0 gap-2" render={<Link href="/account" />}>
                    <KeyRound className="h-4 w-4" />
                    {t('home.accessAccount')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 md:py-24 relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-5"
          style={{
            background: `radial-gradient(ellipse at bottom, ${primaryColor} 0%, transparent 70%)`,
          }}
        />

        <div className="container relative mx-auto px-4 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
            <Sparkles className="h-4 w-4" />
            {t('home.readyBadge')}
          </div>

          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold max-w-2xl mx-auto">
            {t('home.readyToRent')}
          </h2>

          <p className="mt-6 text-lg text-muted-foreground max-w-xl mx-auto">
            {t('home.readyToRentDesc')}
          </p>

          <Button size="lg" className="mt-8 text-base px-8 h-12 shadow-lg shadow-primary/25" render={<Link href="/catalog" />}>
              {t('home.exploreCatalog')}
              <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </section>
      </div>
    </>
  )
}
