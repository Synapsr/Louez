"use client";

import { useMemo } from "react";
import { Card } from "@louez/ui";
import { ProductActivityFeed } from "@/app/(dashboard)/dashboard/products/[id]/components/product-activity-feed";
import { ProductHeader } from "@/app/(dashboard)/dashboard/products/[id]/components/product-header";
import { ProductStatsSectionView } from "@/app/(dashboard)/dashboard/products/[id]/components/product-stats-section-view";
import { ProductInventorySectionView } from "@/app/(dashboard)/dashboard/products/[id]/components/product-inventory-section-view";
import { ProductInfoSectionView } from "@/app/(dashboard)/dashboard/products/[id]/components/product-info-section-view";
import { ProductQuickFactsView } from "@/app/(dashboard)/dashboard/products/[id]/components/product-quick-facts-view";
import { ProductReservationsSectionBody } from "@/app/(dashboard)/dashboard/products/[id]/components/product-reservations-section-body";
import { DashboardBreadcrumbLabel } from "@/components/dashboard/dashboard-breadcrumbs-context";
import type { FeatureSceneProps } from "@/components/landing-demos/feature-demo.types";
import { useDemoLocale } from "@/components/landing-demos/use-demo-locale";
import { createDemoProductDetail } from "@/lib/landing-demos/products";

export const ProductDetail = ({
  period,
  booking,
  onOpenReservation,
  productId = "demo-city-bike",
  onBack,
}: FeatureSceneProps & { productId?: string; onBack?: () => void }) => {
  const locale = useDemoLocale();
  const data = useMemo(
    () => createDemoProductDetail(period, booking, locale, productId),
    [period, booking, locale, productId],
  );
  const openReservation = (id: string) => {
    const index = data.pages.rows.findIndex((row) => row.id === id);
    if (index < 0) return;
    const row = data.pages.rows[index];
    onOpenReservation(
      index,
      data.pages.bookings[index],
      { start: row.startDate, end: row.endDate },
      row.status ?? "confirmed",
    );
  };
  return (
    <div className="space-y-4 sm:space-y-6" data-demo-target="product-detail">
      <DashboardBreadcrumbLabel label={data.product.name} />
      <ProductHeader
        product={{
          ...data.product,
          categories: data.product.category ? [data.product.category] : [],
        }}
        storeSlug="maison-du-velo"
        readOnly
        onBack={onBack}
      />
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 sm:space-y-6 lg:col-span-2">
          <ProductStatsSectionView
            revenueStats={data.revenueStats}
            reservationCounts={data.counts}
            utilization={data.utilization}
            inventoryDetail={data.inventoryDetail}
            stockKind="returnable"
            currency="EUR"
          />
          <ProductInventorySectionView
            productId={data.product.id}
            inventoryDetail={data.inventoryDetail}
            stockKind="returnable"
            readOnly
          />
          <Card data-demo-target="product-reservations">
            <ProductReservationsSectionBody
              reservationsPage={data.reservationsPage}
              currency="EUR"
              timezone="Europe/Paris"
              productId={data.product.id}
              trackUnits
              stockKind="returnable"
              units={data.units}
              quantity={data.product.quantity}
              data={data.timeline}
              initialDate={data.today}
              readOnly
              onOpenReservation={openReservation}
              getReservationHref={() => "/demos/landing/reservation"}
            />
          </Card>
          <ProductInfoSectionView
            product={data.infoProduct}
            currency="EUR"
            timezone="Europe/Paris"
            readOnly
          />
        </div>
        <div className="min-w-0 space-y-4 sm:space-y-6">
          <ProductQuickFactsView product={data.quickFacts} currency="EUR" />
          <ProductActivityFeed
            initialPage={data.activity}
            locale={locale}
            productId={data.product.id}
            referenceDate={data.today.toISOString()}
            readOnly
          />
        </div>
      </div>
    </div>
  );
};
