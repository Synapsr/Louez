import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { PackageIcon } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

import { Button } from "@louez/ui";
import { formatCurrency } from "@louez/utils";

import { PageTracker } from "@/components/storefront/page-tracker";
import { EmptyState } from "@/components/storefront/ui/empty-state";
import { StorefrontLink } from "@/components/storefront/ui/storefront-link";

import { getConfiguredFormatLocale } from "@/lib/i18n/configured-format-locale";
import {
  JsonLd,
  generateBreadcrumbSchema,
  generateProductMetadata,
  generateProductSchema,
  getCanonicalUrl,
  getProductPath,
} from "@/lib/seo";
import { getStorefrontUrl } from "@/lib/storefront-url";
import { loadProductForMetadata, loadProductPage } from "@/lib/storefront/product-page.loader";
import { buildProductSlugPath, toSearchParams } from "@/lib/storefront/util.legacy-storefront-url";
import {
  buildCategoryBrowseHref,
  getCategoryToken,
} from "@/lib/utils/util.category-browse-entries";
import { getStorefrontPricingSummary } from "@/lib/utils/util.storefront-pricing";

import { ProductRentalInformation } from "@/components/storefront/product/product-rental-information";
import { BookingPanel } from "./booking-panel";

import { ProductSummary } from "./product-summary";
import { ProductPageContent } from "./product-page-content";
import { RelatedProducts } from "./related-products";

interface ProductPageProps {
  /** `productId` is the URL segment: the product's slug, or its id on older links. */
  params: Promise<{ slug: string; productId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
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

  // The rate the page prints today, promotion included.
  const { displayPrice } = getStorefrontPricingSummary(product, {
    timezone: store.settings?.timezone,
  });

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
      slug: product.slug,
      description: product.description,
      price: String(displayPrice),
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
      path: getProductPath(product),
      locale,
      title: t("meta.title", { product: product.name, store: store.name }),
      description: t("meta.description", {
        product: product.name,
        store: store.name,
        price: formatCurrency(displayPrice, store.currency, formatLocale),
      }),
    },
  );
}

export default async function ProductPage({ params, searchParams }: ProductPageProps) {
  const { slug, productId } = await params;
  const t = await getTranslations("storefront.product");
  const page = await loadProductPage(slug, productId);

  if (!page) {
    notFound();
  }

  const { store, product, booking, accessories, relatedProducts } = page;

  // A link written before slugs existed (or by id from the dashboard) lands
  // here; the readable URL is the one search engines should keep. The layout
  // already answered 308 on proxied hosts; this is the fallback.
  if (product.slug && productId !== product.slug) {
    permanentRedirect(
      getStorefrontUrl(
        slug,
        buildProductSlugPath(product.slug, toSearchParams(await searchParams)),
      ),
    );
  }
  const { displayPrice } = getStorefrontPricingSummary(product, {
    timezone: store.settings.timezone,
  });
  const storeForSchema = {
    id: store.id,
    name: store.name,
    slug: store.slug,
    settings: store.settings,
  };
  const productForSchema = {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    price: String(displayPrice),
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
            url: getCanonicalUrl(slug, buildCategoryBrowseHref(getCategoryToken(product.category))),
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

      <ProductPageContent
        product={product}
        bookingColumn={
          booking.isAvailable ? (
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
          )
        }
        relatedProducts={
          <RelatedProducts products={relatedProducts} className="min-w-0 border-t pt-8 sm:pt-10" />
        }
      />
    </>
  );
}
