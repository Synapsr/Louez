import { notFound, redirect } from "next/navigation";

import { and, eq } from "drizzle-orm";
import { getLocale } from "next-intl/server";

import { db } from "@louez/db";
import { products } from "@louez/db";
import { PRODUCT_ACTIVITY_PAGE_SIZE, getProductUnitActivityPage } from "@louez/api/services";

import { DashboardBreadcrumbLabel } from "@/components/dashboard/dashboard-breadcrumbs-context";

import { getCurrentStore } from "@/lib/store-context";

import { ProductActivityFeed } from "./components/product-activity-feed";
import { ProductHeader } from "./components/product-header";
import { ProductInfoSection } from "./components/product-info-section";
import { ProductInventorySection } from "./components/product-inventory-section";
import { ProductQuickFacts } from "./components/product-quick-facts";
import { ProductReservationsSection } from "./components/product-reservations-section";
import { ProductStatsSection } from "./components/product-stats-section";
import {
  getProductInventoryDetail,
  getProductReservationCounts,
  getProductReservationsPage,
  getProductRevenueStats,
  getProductUtilizationRate,
} from "./queries";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

const RESERVATIONS_PAGE_SIZE = 10;

interface ProductPageProps {
  params: Promise<{ id: string }>;
}

export default async function ProductPage({ params }: ProductPageProps) {
  const store = await getCurrentStore();

  if (!store) {
    redirect("/onboarding");
  }

  const { id } = await params;
  const locale = await getLocale();

  const product = await db.query.products.findFirst({
    where: and(eq(products.id, id), eq(products.storeId, store.id)),
    with: {
      category: true,
      categoryLinks: {
        orderBy: (links, { asc }) => [asc(links.position)],
        with: {
          category: true,
        },
      },
      pricingTiers: {
        orderBy: (tiers, { asc }) => [asc(tiers.displayOrder)],
      },
      seasonalPricings: {
        orderBy: (pricing, { asc }) => [asc(pricing.startDate)],
        with: {
          tiers: {
            orderBy: (tiers, { asc }) => [asc(tiers.displayOrder)],
          },
        },
      },
      accessories: {
        orderBy: (acc, { asc }) => [asc(acc.displayOrder)],
        with: {
          accessory: {
            columns: {
              id: true,
              name: true,
              price: true,
              images: true,
            },
          },
        },
      },
      tulipMapping: true,
    },
  });

  if (!product) {
    notFound();
  }

  const currency = store.settings?.currency || "EUR";

  // categoryLinks mirrors products.categoryId (see `replaceProductCategories`
  // in actions.ts) but legacy rows may only have the single `category`
  // relation populated — fall back to that so the header always has
  // something to show for categorized products.
  const categories =
    product.categoryLinks.length > 0
      ? product.categoryLinks.flatMap((link) => (link.category ? [link.category] : []))
      : product.category
        ? [product.category]
        : [];

  const [revenueStats, reservationCounts, inventoryDetail, reservationsPage, unitActivity] =
    await Promise.all([
      getProductRevenueStats({ storeId: store.id, productId: id }),
      getProductReservationCounts({ storeId: store.id, productId: id }),
      getProductInventoryDetail({
        storeId: store.id,
        productId: id,
        trackUnits: product.trackUnits,
      }),
      getProductReservationsPage({
        storeId: store.id,
        productId: id,
        page: 0,
        pageSize: RESERVATIONS_PAGE_SIZE,
      }),
      product.trackUnits
        ? getProductUnitActivityPage({
            storeId: store.id,
            productId: id,
            limit: PRODUCT_ACTIVITY_PAGE_SIZE,
          })
        : Promise.resolve({ items: [], nextCursor: null }),
    ]);

  const activeUnitCount =
    inventoryDetail.mode === "tracked"
      ? inventoryDetail.units.filter((unit) => unit.lifecycleStatus === "active").length
      : 0;

  const utilization =
    product.stockKind === "untracked"
      ? null
      : await getProductUtilizationRate({
          storeId: store.id,
          productId: id,
          trackUnits: product.trackUnits,
          totalUnits: product.trackUnits ? activeUnitCount : product.quantity,
        });

  return (
    <div className="space-y-4 sm:space-y-6">
      <DashboardBreadcrumbLabel label={product.name} />

      <ProductHeader
        product={{
          id: product.id,
          name: product.name,
          images: product.images,
          status: product.status,
          categories,
        }}
        storeSlug={store.slug}
      />

      {/* `min-w-0` on both columns: the timeline and the unit table are wider
          than a phone viewport, and grid items default to `min-width: auto` —
          without it their min-content pushes the whole page past the viewport
          instead of scrolling inside their own container. */}
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 sm:space-y-6 lg:col-span-2">
          <ProductStatsSection
            revenueStats={revenueStats}
            reservationCounts={reservationCounts}
            utilization={utilization}
            inventoryDetail={inventoryDetail}
            stockKind={product.stockKind}
            currency={currency}
          />

          {product.stockKind !== "untracked" ? (
            <ProductInventorySection
              productId={product.id}
              inventoryDetail={inventoryDetail}
              stockKind={product.stockKind}
            />
          ) : null}

          <ProductReservationsSection
            reservationsPage={reservationsPage}
            currency={currency}
            timezone={store.settings?.timezone}
            productId={product.id}
            trackUnits={product.trackUnits}
            stockKind={product.stockKind}
            units={
              inventoryDetail.mode === "tracked"
                ? inventoryDetail.units
                    .filter((unit) => unit.lifecycleStatus === "active")
                    .map((unit) => ({
                      id: unit.id,
                      identifier: unit.identifier,
                    }))
                : []
            }
            quantity={product.quantity}
          />

          <ProductInfoSection product={product} currency={currency} />
        </div>

        <div className="min-w-0 space-y-4 sm:space-y-6">
          <ProductQuickFacts product={product} currency={currency} />

          {product.trackUnits && (
            <ProductActivityFeed
              initialPage={unitActivity}
              locale={locale}
              productId={product.id}
              referenceDate={new Date().toISOString()}
            />
          )}
        </div>
      </div>
    </div>
  );
}
