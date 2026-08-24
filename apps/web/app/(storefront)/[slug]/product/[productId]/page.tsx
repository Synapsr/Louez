import { cache } from 'react';

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { inArray } from 'drizzle-orm';
import { and, asc, desc, eq, ne } from 'drizzle-orm';
import { ArrowRight, Check } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';

import { db, getEffectiveProductQuantities } from '@louez/db';
import {
  productSeasonalPricing,
  productSeasonalPricingTiers,
  products,
  stores,
} from '@louez/db';
import type { BusinessHours, StoreSettings, StoreTheme } from '@louez/types';
import { Badge } from '@louez/ui';
import { Button } from '@louez/ui';
import { Separator } from '@louez/ui';
import {
  buildCombinationKey,
  formatCurrency,
  getDeterministicCombinationSortValue,
  isFixedPriceProduct,
  minutesToPriceDuration,
  pricingModeToMinutes,
} from '@louez/utils';

import { PageTracker } from '@/components/storefront/page-tracker';
import { PricingTiersDisplay } from '@/components/storefront/pricing-tiers-display';
import { ProductCard } from '@/components/storefront/product-card';

import {
  JsonLd,
  generateBreadcrumbSchema,
  generateProductMetadata,
  generateProductSchema,
  getCanonicalUrl,
} from '@/lib/seo';
import { sanitizeProductDescriptionHtml } from '@/lib/util.product-description';
import { getStorefrontPathPrefix } from '@/lib/util.storefront-host';
import { filterActiveVariantAxes } from '@/lib/util.variant-visibility';
import { getStoreVariantActivity } from '@/lib/util.variant-visibility.server';
import { getConfiguredFormatLocale } from '@/lib/i18n/configured-format-locale';
import { getRequestFormatLocale } from '@/lib/i18n/format-locale.server';
import { getMinRentalMinutes } from '@/lib/utils/rental-duration';
import { getCurrentDowntimeUnitIds } from '@/lib/utils/unit-current-downtime';

import { AddToCartForm } from './add-to-cart-form';
import { ProductGallery } from './product-gallery';

interface ProductPageProps {
  params: Promise<{ slug: string; productId: string }>;
}

export const instant = false;

// generateMetadata and the page body render in the same request — cache() the
// shared lookups so each query runs once instead of twice.
const getStoreBySlug = cache((slug: string) =>
  db.query.stores.findFirst({ where: eq(stores.slug, slug) }),
);

const getActiveProduct = cache((storeId: string, productId: string) =>
  db.query.products.findFirst({
    where: and(
      eq(products.id, productId),
      eq(products.storeId, storeId),
      eq(products.status, 'active'),
    ),
    with: {
      category: true,
      pricingTiers: true,
      units: {
        columns: {
          id: true,
          lifecycleStatus: true,
          attributes: true,
        },
      },
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
  }),
);

export async function generateMetadata({
  params,
}: ProductPageProps): Promise<Metadata> {
  const { slug, productId } = await params;
  const t = await getTranslations('storefront.product');
  const locale = await getLocale();
  const { intl: formatLocale } = getConfiguredFormatLocale(locale);

  const store = await getStoreBySlug(slug);

  if (!store) {
    return { title: t('meta.storeNotFound') };
  }

  const product = await getActiveProduct(store.id, productId);

  if (!product) {
    return { title: t('meta.productNotFound') };
  }

  const theme = (store.theme as StoreTheme) || {};
  const settings = (store.settings as StoreSettings) || {};

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
      // Effective quantity is irrelevant for metadata (only the JSON-LD
      // schema reads availability) — skip that extra query here.
      quantity: product.quantity,
      pricingKind: product.pricingKind,
      pricingMode: product.pricingMode,
      basePeriodMinutes: product.basePeriodMinutes,
      category: product.category
        ? { id: product.category.id, name: product.category.name }
        : null,
    },
    {
      path: `/product/${productId}`,
      locale,
      title: t('meta.title', { product: product.name, store: store.name }),
      description: t('meta.description', {
        product: product.name,
        store: store.name,
        price: formatCurrency(
          parseFloat(product.price),
          settings.currency || 'EUR',
          formatLocale,
        ),
      }),
    },
  );
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug, productId } = await params;
  const t = await getTranslations('storefront.product');
  const tCatalog = await getTranslations('storefront.catalog');
  const tCommon = await getTranslations('common');
  const { intl: formatLocale } = await getRequestFormatLocale();

  const store = await getStoreBySlug(slug);

  if (!store) {
    notFound();
  }

  const variantActivity = await getStoreVariantActivity(store.id);

  const storeSettings = (store.settings as StoreSettings) || {};
  const currency = storeSettings.currency || 'EUR';

  const product = await getActiveProduct(store.id, productId);

  if (!product) {
    notFound();
  }

  const accessoryIds = (product.accessories || [])
    .map((acc) => acc.accessory?.id)
    .filter((id): id is string => Boolean(id));
  const effectiveQuantities = await getEffectiveProductQuantities(db, [
    product.id,
    ...accessoryIds,
  ]);
  const effectiveQuantity = product.trackUnits
    ? (effectiveQuantities.get(product.id) ?? 0)
    : product.quantity;

  const currentDowntimeUnitIds = await getCurrentDowntimeUnitIds(
    (product.units || []).map((unit) => unit.id),
    store.id,
  );

  // Fetch seasonal pricings for this product
  const seasonalPricingsRaw = await db
    .select()
    .from(productSeasonalPricing)
    .where(eq(productSeasonalPricing.productId, product.id));

  const seasonalPricingIds = seasonalPricingsRaw.map((sp) => sp.id);
  const seasonalTiersRaw =
    seasonalPricingIds.length > 0
      ? await db
          .select()
          .from(productSeasonalPricingTiers)
          .where(
            inArray(
              productSeasonalPricingTiers.seasonalPricingId,
              seasonalPricingIds,
            ),
          )
      : [];

  // Group seasonal tiers by seasonal pricing ID
  const seasonalTiersByPricingId = new Map<string, typeof seasonalTiersRaw>();
  for (const tier of seasonalTiersRaw) {
    const tiers = seasonalTiersByPricingId.get(tier.seasonalPricingId) || [];
    tiers.push(tier);
    seasonalTiersByPricingId.set(tier.seasonalPricingId, tiers);
  }

  const seasonalPricings = seasonalPricingsRaw.map((sp) => {
    const spTiers = seasonalTiersByPricingId.get(sp.id) || [];
    return {
      id: sp.id,
      name: sp.name,
      startDate: sp.startDate,
      endDate: sp.endDate,
      basePrice: parseFloat(sp.price),
      tiers: spTiers
        .filter((t) => t.minDuration !== null && t.discountPercent !== null)
        .map((t) => ({
          id: t.id,
          minDuration: t.minDuration!,
          discountPercent: parseFloat(t.discountPercent!),
          displayOrder: t.displayOrder ?? 0,
        })),
      rates: spTiers
        .filter((t) => t.period !== null && t.price !== null)
        .map((t) => ({
          id: t.id,
          period: t.period!,
          price: parseFloat(t.price!),
          displayOrder: t.displayOrder ?? 0,
        })),
    };
  });

  // Filter accessories to only include active ones with stock
  const availableAccessories = (product.accessories || [])
    .filter(
      (acc) =>
        acc.accessory &&
        acc.accessory.status === 'active' &&
        (acc.accessory.trackUnits
          ? (effectiveQuantities.get(acc.accessory.id) ?? 0)
          : acc.accessory.quantity) > 0,
    )
    .map((acc) => ({
      quantity: acc.accessory.trackUnits
        ? (effectiveQuantities.get(acc.accessory.id) ?? 0)
        : acc.accessory.quantity,
      id: acc.accessory.id,
      name: acc.accessory.name,
      price: acc.accessory.price,
      deposit: acc.accessory.deposit || '0',
      images: acc.accessory.images,
      pricingKind: acc.accessory.pricingKind,
      pricingMode: acc.accessory.pricingMode,
      basePeriodMinutes: acc.accessory.basePeriodMinutes,
      pricingTiers: acc.accessory.pricingTiers?.map((tier) => ({
        id: tier.id,
        minDuration: tier.minDuration,
        discountPercent: tier.discountPercent,
        period: tier.period,
        price: tier.price,
      })),
    }));

  // Get related products from same category
  const relatedProductsRaw = product.categoryId
    ? await db.query.products.findMany({
        where: and(
          eq(products.storeId, store.id),
          eq(products.status, 'active'),
          eq(products.categoryId, product.categoryId),
          ne(products.id, product.id),
        ),
        with: {
          pricingTiers: true,
        },
        orderBy: [asc(products.displayOrder), desc(products.createdAt)],
        limit: 4,
      })
    : [];
  const relatedQuantities = await getEffectiveProductQuantities(
    db,
    relatedProductsRaw.map((relatedProduct) => relatedProduct.id),
  );
  const relatedProducts = relatedProductsRaw.map((relatedProduct) => ({
    ...relatedProduct,
    quantity: relatedProduct.trackUnits
      ? (relatedQuantities.get(relatedProduct.id) ?? 0)
      : relatedProduct.quantity,
  }));

  const basePath = await getStorefrontPathPrefix(slug);
  const effectivePricingMode = product.pricingMode ?? 'day';
  const depositAmount = product.deposit ? parseFloat(product.deposit) : 0;
  // A forfait is billed per booking: the price carries no period, no tiers.
  const isFixedPricing = isFixedPriceProduct(product);

  // Rate-based products price a custom period ("50 € / 2 heures"), not one
  // pricingMode unit — mirror what the catalog card and booking form charge.
  const basePeriod = minutesToPriceDuration(
    product.basePeriodMinutes && product.basePeriodMinutes > 0
      ? product.basePeriodMinutes
      : pricingModeToMinutes(effectivePricingMode),
  );
  const basePeriodLabel =
    basePeriod.unit === 'minute'
      ? `${basePeriod.duration} ${tCommon('minuteUnit', { count: basePeriod.duration })}`
      : basePeriod.duration === 1
        ? t(`pricingUnit.${basePeriod.unit}.singular`)
        : `${basePeriod.duration} ${t(`pricingUnit.${basePeriod.unit}.plural`)}`;
  const displayQuantity = product.trackUnits
    ? (product.units || []).filter(
        (unit) =>
          (unit.lifecycleStatus || 'active') === 'active' &&
          !currentDowntimeUnitIds.has(unit.id),
      ).length
    : effectiveQuantity;
  const isAvailable = effectiveQuantity > 0;
  const storedBookingAttributeAxes = [
    ...((product.bookingAttributeAxes as Array<{
      key: string;
      label: string;
      position: number;
    }> | null) || []),
  ].sort((a, b) => a.position - b.position);
  const inferredBookingAttributeAxes =
    storedBookingAttributeAxes.length > 0
      ? storedBookingAttributeAxes
      : (() => {
          const keys = new Set<string>();
          for (const unit of product.units || []) {
            const attributes = unit.attributes as
              | Record<string, string>
              | null
              | undefined;
            if (!attributes) continue;
            for (const key of Object.keys(attributes)) {
              if (key.trim()) {
                keys.add(key.trim());
              }
            }
          }
          return [...keys]
            .sort((a, b) => a.localeCompare(b, 'en'))
            .map((key, index) => ({
              key,
              label: key,
              position: index,
            }));
        })();
  const bookingAttributeAxes = filterActiveVariantAxes(
    inferredBookingAttributeAxes,
    variantActivity,
  );
  const bookingAttributeValues = bookingAttributeAxes.reduce<
    Record<string, string[]>
  >((acc, axis) => {
    const values = new Set<string>();
    for (const unit of product.units || []) {
      if ((unit.lifecycleStatus || 'active') !== 'active') continue;
      if (currentDowntimeUnitIds.has(unit.id)) continue;
      const raw = (
        unit.attributes as Record<string, string> | null | undefined
      )?.[axis.key];
      if (raw && raw.trim()) {
        values.add(raw.trim());
      }
    }
    acc[axis.key] = [...values].sort((a, b) => a.localeCompare(b, 'en'));
    return acc;
  }, {});
  const bookingCombinations = (() => {
    const byCombination = new Map<
      string,
      { selectedAttributes: Record<string, string>; availableQuantity: number }
    >();

    for (const unit of product.units || []) {
      if ((unit.lifecycleStatus || 'active') !== 'active') continue;
      if (currentDowntimeUnitIds.has(unit.id)) continue;

      const selectedAttributes =
        (unit.attributes as Record<string, string> | null | undefined) || {};
      const combinationKey = buildCombinationKey(
        bookingAttributeAxes,
        selectedAttributes,
      );
      const current = byCombination.get(combinationKey);
      if (!current) {
        byCombination.set(combinationKey, {
          selectedAttributes,
          availableQuantity: 1,
        });
      } else {
        current.availableQuantity += 1;
        byCombination.set(combinationKey, current);
      }
    }

    return [...byCombination.entries()]
      .map(([combinationKey, value]) => ({
        combinationKey,
        selectedAttributes: value.selectedAttributes,
        availableQuantity: value.availableQuantity,
      }))
      .sort((a, b) => {
        const sortA = getDeterministicCombinationSortValue(
          bookingAttributeAxes,
          a.selectedAttributes,
        );
        const sortB = getDeterministicCombinationSortValue(
          bookingAttributeAxes,
          b.selectedAttributes,
        );
        return sortA.localeCompare(sortB, 'en');
      });
  })();

  // Prepare data for JSON-LD schemas
  const storeForSchema = {
    id: store.id,
    name: store.name,
    slug: store.slug,
    settings: storeSettings as StoreSettings,
  };

  const productForSchema = {
    id: product.id,
    name: product.name,
    description: product.description,
    price: product.price,
    deposit: product.deposit,
    images: product.images,
    quantity: effectiveQuantity,
    pricingKind: product.pricingKind,
    pricingMode: effectivePricingMode,
    basePeriodMinutes: product.basePeriodMinutes,
    category: product.category
      ? { id: product.category.id, name: product.category.name }
      : null,
  };

  // Build breadcrumb items
  const breadcrumbItems: { name: string; url?: string }[] = [
    { name: store.name, url: getCanonicalUrl(slug) },
    { name: t('breadcrumb.catalog'), url: getCanonicalUrl(slug, '/catalog') },
  ];
  if (product.category) {
    breadcrumbItems.push({
      name: product.category.name,
      url: getCanonicalUrl(slug, `/catalog?category=${product.category.id}`),
    });
  }
  breadcrumbItems.push({ name: product.name });

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

      <div className="container mx-auto max-w-7xl px-4 py-6 md:py-8">
        {/* Breadcrumb */}
        <nav aria-label={t('breadcrumb.label')} className="mb-6">
          <ol className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <li>
              <Link href={basePath || '/'} className="hover:text-foreground">
                {t('breadcrumb.home')}
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link
                href={`${basePath}/catalog`}
                className="hover:text-foreground"
              >
                {t('breadcrumb.catalog')}
              </Link>
            </li>
            {product.category && (
              <>
                <li aria-hidden="true">/</li>
                <li>
                  <Link
                    href={`${basePath}/catalog?category=${product.category.id}`}
                    className="hover:text-foreground"
                  >
                    {product.category.name}
                  </Link>
                </li>
              </>
            )}
            <li aria-hidden="true">/</li>
            <li className="text-foreground font-medium">{product.name}</li>
          </ol>
        </nav>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:items-start lg:gap-12">
          {/* Gallery + description — the description fills the left column on
              desktop so it's visible without scrolling past the booking panel.
              On mobile it renders after the panel instead (see below). */}
          <div className="w-full space-y-10">
            <ProductGallery
              images={product.images || []}
              productName={product.name}
            />

            {product.description && (
              <section
                className="hidden lg:block"
                aria-labelledby="description"
              >
                <h2 id="description" className="mb-3 text-xl font-semibold">
                  {t('description')}
                </h2>
                <div
                  className="prose prose-sm dark:prose-invert prose-headings:text-foreground prose-a:text-primary prose-p:text-muted-foreground prose-li:text-muted-foreground wrap-break-word max-w-none"
                  dangerouslySetInnerHTML={{
                    __html: sanitizeProductDescriptionHtml(product.description),
                  }}
                />
              </section>
            )}
          </div>

          {/* Product Info */}
          <div className="space-y-6">
            <div className="space-y-3">
              {product.category && (
                <Badge
                  variant="tertiary"
                  render={
                    <Link
                      href={`${basePath}/catalog?category=${product.category.id}`}
                    />
                  }
                >
                  {product.category.name}
                </Badge>
              )}

              <h1 className="text-2xl font-bold tracking-tight text-balance md:text-3xl">
                {product.name}
              </h1>

              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-primary text-3xl font-bold">
                  {formatCurrency(parseFloat(product.price), currency, formatLocale)}
                </span>
                <span className="text-muted-foreground text-base">
                  {isFixedPricing
                    ? t('fixedPricingLabel')
                    : `/ ${basePeriodLabel}`}
                </span>
                {depositAmount > 0 && (
                  <span className="text-muted-foreground text-sm">
                    · {t('deposit')} {formatCurrency(depositAmount, currency, formatLocale)}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {isAvailable ? (
                  <>
                    <Check className="text-success size-4" />
                    <span className="text-success text-sm font-medium">
                      {t('availableCount', { count: displayQuantity })}
                    </span>
                  </>
                ) : (
                  <Badge variant="failed">{tCatalog('unavailable')}</Badge>
                )}
              </div>
            </div>

            {/* Pricing Tiers Display */}
            {product.pricingTiers && product.pricingTiers.length > 0 && (
              <PricingTiersDisplay
                basePrice={parseFloat(product.price)}
                pricingKind={product.pricingKind}
                pricingMode={effectivePricingMode}
                basePeriodMinutes={product.basePeriodMinutes}
                tiers={product.pricingTiers}
              />
            )}

            <Separator />

            {/* Add to Cart Form */}
            {isAvailable ? (
              <AddToCartForm
                productId={product.id}
                productName={product.name}
                productImage={product.images?.[0] || null}
                price={parseFloat(product.price)}
                deposit={product.deposit ? parseFloat(product.deposit) : 0}
                maxQuantity={displayQuantity}
                pricingKind={product.pricingKind}
                pricingMode={effectivePricingMode}
                basePeriodMinutes={product.basePeriodMinutes}
                storeSlug={slug}
                pricingTiers={product.pricingTiers?.map((tier) => ({
                  id: tier.id,
                  minDuration: tier.minDuration,
                  discountPercent: parseFloat(tier.discountPercent ?? '0'),
                  period: tier.period,
                  price: tier.price,
                }))}
                enforceStrictTiers={product.enforceStrictTiers ?? false}
                advanceNotice={storeSettings.advanceNoticeMinutes || 0}
                minRentalMinutes={getMinRentalMinutes(
                  storeSettings as StoreSettings,
                )}
                businessHours={
                  storeSettings.businessHours as BusinessHours | undefined
                }
                timezone={storeSettings.timezone}
                accessories={availableAccessories}
                trackUnits={Boolean(
                  product.trackUnits || bookingAttributeAxes.length > 0,
                )}
                bookingAttributeAxes={bookingAttributeAxes}
                bookingAttributeValues={bookingAttributeValues}
                productUnits={(product.units || []).map((unit) => ({
                  lifecycleStatus: unit.lifecycleStatus || 'active',
                  inDowntimeNow: currentDowntimeUnitIds.has(unit.id),
                  attributes:
                    (unit.attributes as Record<string, string> | null) || null,
                }))}
                bookingCombinations={bookingCombinations}
                seasonalPricings={seasonalPricings}
              />
            ) : (
              <div className="bg-muted/40 space-y-3 rounded-xl border p-4">
                <p className="text-muted-foreground text-sm">
                  {t('unavailableHelp')}
                </p>
                <Button
                  variant="outline"
                  render={<Link href={`${basePath}/catalog`} />}
                >
                  {t('backToCatalog')}
                  <ArrowRight className="ml-2 size-4" />
                </Button>
              </div>
            )}

            {/* Characteristics — the crawlable summary of the booking panel */}
            <div>
              <h2 className="mb-3 text-base font-semibold">
                {t('characteristics')}
              </h2>
              <dl className="divide-border divide-y text-sm">
                {product.category && (
                  <div className="flex items-baseline justify-between gap-4 py-2">
                    <dt className="text-muted-foreground">
                      {t('specs.category')}
                    </dt>
                    <dd className="text-right font-medium">
                      {product.category.name}
                    </dd>
                  </div>
                )}
                <div className="flex items-baseline justify-between gap-4 py-2">
                  <dt className="text-muted-foreground">
                    {t('specs.basePrice')}
                  </dt>
                  <dd className="text-right font-medium">
                    {formatCurrency(parseFloat(product.price), currency, formatLocale)}
                    {isFixedPricing
                      ? ` · ${t('fixedPricingLabel')}`
                      : ` / ${basePeriodLabel}`}
                  </dd>
                </div>
                {depositAmount > 0 && (
                  <div className="flex items-baseline justify-between gap-4 py-2">
                    <dt className="text-muted-foreground">{t('deposit')}</dt>
                    <dd className="text-right font-medium">
                      {formatCurrency(depositAmount, currency, formatLocale)}
                    </dd>
                  </div>
                )}
                <div className="flex items-baseline justify-between gap-4 py-2">
                  <dt className="text-muted-foreground">
                    {t('specs.availability')}
                  </dt>
                  <dd className="text-right font-medium">
                    {isAvailable
                      ? t('availableCount', { count: displayQuantity })
                      : tCatalog('unavailable')}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>

        {/* Description, mobile placement — after the booking panel so renting
            stays one scroll away. Same content as the desktop copy above. */}
        {product.description && (
          <section className="mt-12 lg:hidden" aria-labelledby="description-mobile">
            <h2 id="description-mobile" className="mb-3 text-xl font-semibold">
              {t('description')}
            </h2>
            <div
              className="prose prose-sm dark:prose-invert prose-headings:text-foreground prose-a:text-primary prose-p:text-muted-foreground prose-li:text-muted-foreground wrap-break-word max-w-none"
              dangerouslySetInnerHTML={{
                __html: sanitizeProductDescriptionHtml(product.description),
              }}
            />
          </section>
        )}

        {/* Related Products */}
        {relatedProducts.length > 0 && (
          <section className="mt-16">
            <h2 className="mb-6 text-xl font-semibold md:text-2xl">
              {t('relatedProducts')}
            </h2>
            <div className="grid grid-cols-2 gap-4 md:gap-6 lg:grid-cols-4">
              {relatedProducts.map((relatedProduct) => (
                <ProductCard
                  key={relatedProduct.id}
                  product={relatedProduct}
                  storeSlug={slug}
                  basePath={basePath}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
