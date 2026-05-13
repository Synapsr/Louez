import { Suspense } from 'react';

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  ArrowRight,
  Calendar,
  CheckCircle,
  ExternalLink,
  Mail,
  MapPin,
  Phone,
  Shield,
  Star,
  Truck,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { db } from '@louez/db';
import { categories, products, stores } from '@louez/db';
import type {
  ReviewBoosterSettings,
  StoreSettings,
  StoreTheme,
} from '@louez/types';
import { Button } from '@louez/ui';
import { Card, CardContent } from '@louez/ui';

import { GoogleReviewsSection } from '@/components/storefront/google-reviews-section';
import { HeroDatePicker } from '@/components/storefront/hero-date-picker';
import { HeroImageSlider } from '@/components/storefront/hero-image-slider';
import { PageTracker } from '@/components/storefront/page-tracker';
import { ProductGridWithPreview } from '@/components/storefront/product-grid-with-preview';
import { StoreMap } from '@/components/storefront/store-map';
import { StoreStatusBadge } from '@/components/storefront/store-status-badge';

import {
  JsonLd,
  generateLocalBusinessSchema,
  generateStoreMetadata,
  generateWebSiteSchema,
  stripHtml,
} from '@/lib/seo';
import { getMinRentalMinutes } from '@/lib/utils/rental-duration';

interface StorefrontPageProps {
  params: Promise<{ slug: string }>;
}

function getSafeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

export async function generateMetadata({
  params,
}: StorefrontPageProps): Promise<Metadata> {
  const { slug } = await params;

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
  });

  if (!store) {
    return { title: 'Boutique introuvable' };
  }

  const theme = (store.theme as StoreTheme) || {};
  const settings = (store.settings as StoreSettings) || {};

  // Use hero images for OG if available
  const ogImages = theme.heroImages?.length
    ? theme.heroImages.slice(0, 1)
    : store.logoUrl
      ? [store.logoUrl]
      : [];

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
    },
  );
}

export default async function StorefrontPage({ params }: StorefrontPageProps) {
  const { slug } = await params;
  const t = await getTranslations('storefront');

  // Fetch store without relations to avoid lateral join issues
  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
  });

  if (!store) {
    notFound();
  }

  // Fetch categories separately (lightweight, no images column issues)
  const storeCategories = await db.query.categories.findMany({
    where: eq(categories.storeId, store.id),
    orderBy: [categories.order],
  });

  // Fetch products in two steps to avoid sort buffer overflow
  // Step 1: Get product IDs (lightweight query with ORDER BY)
  // Order by displayOrder first (for manual sorting), then by createdAt for new products
  const productIds = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.storeId, store.id), eq(products.status, 'active')))
    .orderBy(asc(products.displayOrder), desc(products.createdAt))
    .limit(8);

  // Step 2: Fetch full product data with pricing tiers and category (no ORDER BY needed)
  let storeProducts: (typeof products.$inferSelect & {
    pricingTiers?: {
      id: string;
      minDuration: number | null;
      discountPercent: string | null;
      period: number | null;
      price: string | null;
      displayOrder: number | null;
    }[];
    category?: { name: string } | null;
  })[] = [];
  if (productIds.length > 0) {
    const productResults = await db.query.products.findMany({
      where: inArray(
        products.id,
        productIds.map((p) => p.id),
      ),
      with: {
        pricingTiers: true,
        category: true,
      },
    });
    // Preserve order from first query
    const productMap = new Map(productResults.map((p) => [p.id, p]));
    storeProducts = productIds
      .map(({ id }) => productMap.get(id))
      .filter((p): p is NonNullable<typeof p> => p !== undefined);
  }

  // Combine into expected structure
  const storeWithRelations = {
    ...store,
    categories: storeCategories,
    products: storeProducts,
  };

  const pricingMode = 'day' as const;
  const primaryColor = storeWithRelations.theme?.primaryColor || '#0066FF';
  const businessHours = storeWithRelations.settings?.businessHours;
  const timezone = storeWithRelations.settings?.timezone;
  const advanceNotice = storeWithRelations.settings?.advanceNoticeMinutes || 0;
  const minRentalMinutes = getMinRentalMinutes(
    storeWithRelations.settings as StoreSettings | null,
  );
  const heroImages = storeWithRelations.theme?.heroImages || [];
  const hasHeroImages = heroImages.length > 0;
  const reviewBoosterSettings =
    store.reviewBoosterSettings as ReviewBoosterSettings | null;
  const reviewRating = getSafeNumber(reviewBoosterSettings?.googleRating);
  const reviewCount = getSafeNumber(reviewBoosterSettings?.googleReviewCount);

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
  };

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

      <div className="-mt-20 overflow-hidden md:-mt-24">
        {/* Hero Section */}
        <section className="relative">
          {/* Hero with images - full width background */}
          {hasHeroImages ? (
            <div className="relative flex min-h-screen items-center">
              {/* Background Image Slider */}
              <div className="absolute inset-0">
                <HeroImageSlider
                  images={heroImages}
                  className="h-full w-full"
                  fullscreen
                />
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
              <div className="from-background/40 absolute inset-0 bg-gradient-to-t via-transparent to-transparent" />

              {/* Left-aligned Content */}
              <div className="relative z-10 container mx-auto px-4 py-20 md:py-24">
                {/* Glassmorphism content card */}
                <div className="bg-background/70 dark:bg-background/80 max-w-lg rounded-3xl border border-white/10 p-6 shadow-2xl backdrop-blur-xl md:p-8 lg:max-w-xl">
                  {/* Store name */}
                  <h1 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl lg:text-5xl">
                    {storeWithRelations.name}
                  </h1>

                  {/* Status and rating badges */}
                  <div className="mb-4 flex flex-wrap items-center gap-3">
                    <StoreStatusBadge
                      businessHours={businessHours}
                      timezone={timezone}
                    />
                    {reviewRating !== null && (
                      <div className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-sm">
                        <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                        <span className="font-medium">
                          {reviewRating.toFixed(1)}
                        </span>
                        {reviewCount !== null && (
                          <span className="text-muted-foreground text-xs">
                            ({reviewCount})
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Tagline */}
                  <p className="text-muted-foreground mb-5 text-base md:text-lg">
                    {t('hero.tagline')}
                  </p>

                  {/* Reassurance badges */}
                  <div className="mb-6 flex flex-wrap gap-2 text-xs md:text-sm">
                    <div className="text-muted-foreground flex items-center gap-1.5">
                      <CheckCircle className="text-primary h-4 w-4" />
                      <span>{t('hero.instantConfirmation')}</span>
                    </div>
                    <div className="text-muted-foreground flex items-center gap-1.5">
                      <span className="text-border">•</span>
                    </div>
                    <div className="text-muted-foreground flex items-center gap-1.5">
                      <Shield className="text-primary h-4 w-4" />
                      <span>{t('hero.securePayment')}</span>
                    </div>
                    <div className="text-muted-foreground flex items-center gap-1.5">
                      <span className="text-border">•</span>
                    </div>
                    <div className="text-muted-foreground flex items-center gap-1.5">
                      <MapPin className="text-primary h-4 w-4" />
                      <span>{t('hero.localPickup')}</span>
                    </div>
                  </div>

                  {/* Date Picker */}
                  <div id="date-picker">
                    <Suspense
                      fallback={
                        <div className="bg-muted/30 h-40 animate-pulse rounded-2xl" />
                      }
                    >
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
            <div className="relative flex min-h-screen items-center justify-center">
              {/* Subtle background gradient */}
              <div
                className="absolute inset-0 opacity-5"
                style={{
                  background: `radial-gradient(ellipse at center, ${primaryColor} 0%, transparent 70%)`,
                }}
              />

              {/* Centered Content */}
              <div className="relative z-10 container mx-auto px-4 py-20">
                <div className="mx-auto max-w-3xl text-center">
                  {/* Store name */}
                  <h1 className="mb-3 text-4xl font-bold tracking-tight md:text-5xl lg:text-6xl">
                    {storeWithRelations.name}
                  </h1>

                  {/* Status and rating badges */}
                  <div className="mb-6 flex flex-wrap items-center justify-center gap-3">
                    <StoreStatusBadge
                      businessHours={businessHours}
                      timezone={timezone}
                    />
                    {reviewRating !== null && (
                      <div className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1.5 text-sm">
                        <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                        <span className="font-medium">
                          {reviewRating.toFixed(1)}
                        </span>
                        {reviewCount !== null && (
                          <span className="text-muted-foreground text-xs">
                            ({reviewCount} {t('hero.reviewsBadge')})
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Tagline */}
                  <p className="text-muted-foreground mb-6 text-lg md:text-xl">
                    {t('hero.tagline')}
                  </p>

                  {/* Reassurance badges */}
                  <div className="mb-8 flex flex-wrap justify-center gap-2 text-sm md:gap-3">
                    <div className="bg-muted/50 flex items-center gap-2 rounded-full px-3 py-1.5 md:px-4 md:py-2">
                      <CheckCircle className="text-primary h-4 w-4" />
                      <span className="font-medium">
                        {t('hero.instantConfirmation')}
                      </span>
                    </div>
                    <div className="bg-muted/50 flex items-center gap-2 rounded-full px-3 py-1.5 md:px-4 md:py-2">
                      <Shield className="text-primary h-4 w-4" />
                      <span className="font-medium">
                        {t('hero.securePayment')}
                      </span>
                    </div>
                    <div className="bg-muted/50 flex items-center gap-2 rounded-full px-3 py-1.5 md:px-4 md:py-2">
                      <MapPin className="text-primary h-4 w-4" />
                      <span className="font-medium">
                        {t('hero.localPickup')}
                      </span>
                    </div>
                  </div>

                  {/* Date Picker - centered */}
                  <div id="date-picker" className="flex justify-center">
                    <Suspense
                      fallback={
                        <div className="bg-muted/30 h-40 w-full max-w-2xl animate-pulse rounded-2xl" />
                      }
                    >
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
              <div className="mx-auto max-w-3xl text-center">
                <div
                  className="prose prose-lg dark:prose-invert prose-p:text-muted-foreground prose-headings:text-foreground prose-a:text-primary mx-auto"
                  dangerouslySetInnerHTML={{
                    __html: storeWithRelations.description,
                  }}
                />
              </div>
            </div>
          </section>
        )}

        {/* Trust Badges */}
        <section className="bg-muted/30 py-12 md:py-16">
          <div className="container mx-auto px-4">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-8">
              {[
                {
                  icon: Calendar,
                  title: t('hero.simpleReservation'),
                  desc: t('hero.simpleReservationDesc'),
                },
                {
                  icon: Shield,
                  title: t('hero.securePayment'),
                  desc: t('hero.securePaymentDesc'),
                },
                {
                  icon: Truck,
                  title: t('hero.localPickup'),
                  desc: t('hero.localPickupDesc'),
                },
              ].map((item, index) => (
                <div
                  key={index}
                  className="bg-background flex flex-col items-center rounded-2xl p-6 text-center"
                >
                  <div
                    className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl"
                    style={{ backgroundColor: `${primaryColor}15` }}
                  >
                    <item.icon className="text-primary h-6 w-6" />
                  </div>
                  <h3 className="font-semibold">{item.title}</h3>
                  <p className="text-muted-foreground mt-2 text-sm">
                    {item.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Featured Products Section */}
        <section className="bg-muted/30 py-16 md:py-20">
          <div className="container mx-auto px-4">
            <div className="mb-10 flex flex-col justify-between gap-4 md:mb-12 md:flex-row md:items-end">
              <div>
                <h2 className="text-3xl font-bold md:text-4xl">
                  {t('home.ourProducts')}
                </h2>
                <p className="text-muted-foreground mt-3 max-w-lg">
                  {t('home.productsDesc')}
                </p>
              </div>
              <Button
                variant="outline"
                className="group self-start"
                render={<Link href="/catalog" />}
              >
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
                minRentalMinutes={minRentalMinutes}
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
          <section id="contact" className="px-6 py-20 md:px-16">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 lg:flex-row lg:items-start lg:gap-16">
              <div className="flex-1 space-y-8">
                <div className="space-y-1">
                  <p className="text-primary text-xs font-semibold tracking-[0.2em] uppercase">
                    {t('home.contactLabel')}
                  </p>
                  <h2 className="text-foreground text-3xl font-bold tracking-tight">
                    {t('home.contactTitle')}
                  </h2>
                </div>

                <div className="space-y-5">
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(storeWithRelations.address)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-4"
                  >
                    <span className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
                      <MapPin className="text-primary h-4 w-4" />
                    </span>
                    <span>
                      <span className="text-primary block text-sm">
                        {t('home.address')}
                      </span>
                      <span className="text-foreground inline-flex items-center gap-1 text-sm font-medium whitespace-pre-line transition-opacity hover:opacity-70">
                        {storeWithRelations.address}
                        <ExternalLink className="text-muted-foreground h-3 w-3" />
                      </span>
                    </span>
                  </a>

                  {storeWithRelations.phone && (
                    <a
                      href={`tel:${storeWithRelations.phone}`}
                      className="flex items-center gap-4"
                    >
                      <span className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
                        <Phone className="text-primary h-4 w-4" />
                      </span>
                      <span>
                        <span className="text-primary block text-sm">
                          {t('home.phone')}
                        </span>
                        <span className="text-foreground block text-sm font-medium">
                          {storeWithRelations.phone}
                        </span>
                      </span>
                    </a>
                  )}

                  {storeWithRelations.email && (
                    <a
                      href={`mailto:${storeWithRelations.email}`}
                      className="flex items-center gap-4"
                    >
                      <span className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
                        <Mail className="text-primary h-4 w-4" />
                      </span>
                      <span>
                        <span className="text-primary block text-sm">
                          {t('home.email')}
                        </span>
                        <span className="text-foreground block text-sm font-medium">
                          {storeWithRelations.email}
                        </span>
                      </span>
                    </a>
                  )}
                </div>
              </div>

              <div className="flex-1">
                {/* Map Card */}
                {storeWithRelations.latitude && storeWithRelations.longitude ? (
                  <div className="h-72 overflow-hidden rounded-2xl">
                    <StoreMap
                      latitude={parseFloat(storeWithRelations.latitude)}
                      longitude={parseFloat(storeWithRelations.longitude)}
                      storeName={storeWithRelations.name}
                      address={storeWithRelations.address}
                      primaryColor={primaryColor}
                      interactive={false}
                      showZoomControl={false}
                      showAttribution={false}
                      showRecenterControl
                      tileTheme="dark"
                      popupTheme="light"
                      directionsLabel={t('home.getDirections')}
                      className="h-full w-full"
                    />
                  </div>
                ) : (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(storeWithRelations.address)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group"
                  >
                    <div className="border-border bg-primary/5 hover:bg-primary/10 relative h-72 overflow-hidden rounded-2xl border transition-colors md:h-[300px]">
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-8">
                        <div className="bg-primary/10 mb-6 flex h-20 w-20 items-center justify-center rounded-full transition-transform duration-300 group-hover:scale-105">
                          <MapPin className="text-primary h-10 w-10" />
                        </div>
                        <h3 className="mb-2 text-center text-xl font-semibold">
                          {storeWithRelations.name}
                        </h3>
                        <p className="text-muted-foreground max-w-xs text-center whitespace-pre-line">
                          {storeWithRelations.address}
                        </p>
                        <div className="text-primary mt-6 flex translate-y-2 items-center gap-2 font-medium opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
                          {t('home.viewOnMap')}
                          <ArrowRight className="h-4 w-4" />
                        </div>
                      </div>
                    </div>
                  </a>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Already Have a Reservation - Login CTA */}
        <section className="border-border border-y px-6 py-12 md:px-16">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-6 md:flex-row">
            <div className="text-center md:text-left">
              <h3 className="text-foreground text-xl font-bold">
                {t('home.alreadyReserved')}
              </h3>
              <p className="text-muted-foreground mt-1 text-sm">
                {t('home.alreadyReservedDesc')}
              </p>
            </div>
            <Button className="shrink-0" render={<Link href="/account" />}>
              {t('home.accessAccount')}
            </Button>
          </div>
        </section>

        {/* CTA Section */}
        <section className="bg-primary text-primary-foreground px-6 py-24 text-center md:px-16">
          <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-7">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
              {t('home.readyToRent')}
            </h2>

            <p className="text-primary-foreground/85 text-base leading-relaxed">
              {t('home.readyToRentDesc')}
            </p>

            <Button
              size="lg"
              variant="secondary"
              className="group h-12 gap-2 px-6 text-base"
              render={<Link href="/catalog" />}
            >
              {t('home.exploreCatalog')}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
