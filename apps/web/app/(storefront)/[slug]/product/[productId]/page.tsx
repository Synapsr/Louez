import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ArrowLeftIcon, PackageIcon } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

import { Button } from "@louez/ui";
import { formatCurrency } from "@louez/utils";

import { PageTracker } from "@/components/storefront/page-tracker";
import { SeasonalRatesDisplay } from "@/components/storefront/product/seasonal-rates-display";
import { PricingTiersDisplay } from "@/components/storefront/pricing-tiers-display";
import { EmptyState } from "@/components/storefront/ui/empty-state";
import { StorefrontLink } from "@/components/storefront/ui/storefront-link";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";

import { getConfiguredFormatLocale } from "@/lib/i18n/configured-format-locale";
import {
  JsonLd,
  generateBreadcrumbSchema,
  generateProductMetadata,
  generateProductSchema,
  getCanonicalUrl,
} from "@/lib/seo";
import { loadProductForMetadata, loadProductPage } from "@/lib/storefront/product-page.loader";

import { ProductRentalInformation } from "@/components/storefront/product/product-rental-information";
import { BookingPanel } from "./booking-panel";

import { ProductBreadcrumb } from "./product-breadcrumb";
import { ProductDescription } from "./product-description";
import { ProductGallery } from "./product-gallery";
import { ProductSummary } from "./product-summary";
import { RelatedProducts } from "./related-products";

interface ProductPageProps {
  params: Promise<{ slug: string; productId: string }>;
}

// Keep product pages in the router cache for five minutes.
export const unstable_dynamicStaleTime = 300;

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug, productId } = await params;
  const t = await getTranslations("storefront.product");
  const locale = await getLocale();
  const { intl: formatLocale } = getConfiguredFormatLocale(locale);
  const { store, product } = await loadProductForMetadata(slug, productId);

  if (!store) {
    return { title: t("meta.storeNotFound") };
  }
  if (!product) {
    return { title: t("meta.productNotFound") };
  }

  return generateProductMetadata(
    {
      id: store.id,
      name: store.name,
      slug: store.slug,
      settings: store.settings,
      theme: store.theme,
    },
    {
      id: product.id,
      name: product.name,
      description: product.description,
      price: product.price,
      deposit: product.deposit,
      images: product.images,
      // Effective quantity is irrelevant for metadata (only the JSON-LD
      // schema reads availability), so the stored one is enough here.
      quantity: product.quantity,
      pricingKind: product.pricingKind,
      pricingMode: product.pricingMode,
      basePeriodMinutes: product.basePeriodMinutes,
      category: product.category ? { id: product.category.id, name: product.category.name } : null,
    },
    {
      path: `/product/${productId}`,
      locale,
      title: t("meta.title", { product: product.name, store: store.name }),
      description: t("meta.description", {
        product: product.name,
        store: store.name,
        price: formatCurrency(parseFloat(product.price), store.currency, formatLocale),
      }),
    },
  );
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug, productId } = await params;
  const t = await getTranslations("storefront.product");
  const page = await loadProductPage(slug, productId);

  if (!page) {
    notFound();
  }

  const { store, product, booking, accessories, relatedProducts } = page;
  const storeForSchema = {
    id: store.id,
    name: store.name,
    slug: store.slug,
    settings: store.settings,
  };
  const productForSchema = {
    id: product.id,
    name: product.name,
    description: product.description,
    price: product.price,
    deposit: product.deposit,
    images: product.images,
    quantity: booking.maxQuantity ?? 1,
    pricingKind: product.pricingKind,
    pricingMode: product.pricingMode,
    basePeriodMinutes: product.basePeriodMinutes,
    category: product.category,
  };
  const breadcrumbItems = [
    { name: store.name, url: getCanonicalUrl(slug) },
    { name: t("breadcrumb.catalog"), url: getCanonicalUrl(slug, "/catalog") },
    ...(product.category
      ? [
          {
            name: product.category.name,
            url: getCanonicalUrl(slug, `/catalog?category=${product.category.id}`),
          },
        ]
      : []),
    { name: product.name },
  ];
  const summary = <ProductSummary product={product} booking={booking} />;

  return (
    <>
      <PageTracker page="product" productId={productId} />
      <JsonLd
        data={[
          generateProductSchema(storeForSchema, productForSchema),
          generateBreadcrumbSchema(storeForSchema, breadcrumbItems),
        ]}
      />

      <StorefrontSection spacing="tight" contentClassName="flex flex-col gap-6 sm:gap-8">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="tertiary"
            size="icon-sm"
            aria-label={t("backToCatalog")}
            render={<StorefrontLink href="/catalog" />}
          >
            <ArrowLeftIcon />
          </Button>
          <ProductBreadcrumb
            productName={product.name}
            category={product.category}
            className="flex-1"
          />
        </div>

        <div className="grid min-w-0 gap-6 sm:gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start lg:gap-x-12">
          <ProductGallery
            images={product.images}
            videoUrl={product.videoUrl}
            productName={product.name}
            className="lg:col-start-1 lg:row-start-1"
          />

          {booking.isAvailable ? (
            <BookingPanel
              product={product}
              booking={booking}
              accessories={accessories}
              information={<ProductRentalInformation store={store} />}
            />
          ) : (
            <div className="flex flex-col gap-6 lg:col-start-2 lg:row-span-2 lg:row-start-1">
              {summary}
              <EmptyState
                icon={<PackageIcon />}
                title={t(`unavailableReason.${booking.unavailableReason ?? "unavailable"}`)}
                description={t("unavailableHelp")}
                action={
                  <Button variant="outline" render={<StorefrontLink href="/catalog" />}>
                    {t("backToCatalog")}
                  </Button>
                }
                tone="card"
              />
            </div>
          )}

          <div className="flex flex-col gap-6 sm:gap-8 lg:col-start-1 lg:row-start-2">
            <ProductDescription html={product.description} />
            {product.seasonalPricings.length > 0 ? (
              <SeasonalRatesDisplay product={product} />
            ) : product.pricingTiers.length > 0 ? (
              <PricingTiersDisplay
                basePrice={parseFloat(product.price)}
                pricingKind={product.pricingKind}
                pricingMode={product.pricingMode}
                basePeriodMinutes={product.basePeriodMinutes}
                tiers={product.pricingTiers.map((tier) => ({
                  id: tier.id,
                  minDuration: tier.minDuration,
                  discountPercent: tier.discountPercent,
                  period: tier.period,
                  price: typeof tier.price === "number" ? String(tier.price) : (tier.price ?? null),
                  displayOrder: tier.displayOrder ?? null,
                }))}
              />
            ) : null}
          </div>
        </div>
        <RelatedProducts products={relatedProducts} className="min-w-0 border-t pt-8 sm:pt-10" />
      </StorefrontSection>
    </>
  );
}
