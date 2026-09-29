"use client";

import { useState } from "react";
import { DashboardSceneFrame } from "@/components/landing-demos/dashboard-scene-frame";
import type { FeatureSceneProps } from "@/components/landing-demos/feature-demo.types";
import { ProductDetail } from "./product-detail";
import { ProductsCatalog } from "./products-catalog";

export const ProductsListScene = ({ period, booking, onOpenReservation }: FeatureSceneProps) => {
  const [productId, setProductId] = useState<string | null>(null);
  return (
    <DashboardSceneFrame
      key={productId ?? "catalog"}
      page="products"
      pages={["products"]}
      pathname={productId ? `/dashboard/products/${productId}` : undefined}
      onNavigate={() => setProductId(null)}
    >
      {productId ? (
        <ProductDetail
          productId={productId}
          period={period}
          booking={booking}
          onOpenReservation={onOpenReservation}
          onBack={() => setProductId(null)}
        />
      ) : (
        <ProductsCatalog onOpenProduct={setProductId} />
      )}
    </DashboardSceneFrame>
  );
};
