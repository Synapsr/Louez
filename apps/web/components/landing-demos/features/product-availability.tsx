"use client";

import { DashboardSceneFrame } from "@/components/landing-demos/dashboard-scene-frame";
import type { FeatureSceneProps } from "@/components/landing-demos/feature-demo.types";
import { ProductDetail } from "./product-detail";

export const ProductAvailabilityScene = ({
  period,
  booking,
  onOpenReservation,
}: FeatureSceneProps) => (
  <DashboardSceneFrame
    page="products"
    pages={["products"]}
    pathname="/dashboard/products/demo-city-bike"
  >
    <ProductDetail period={period} booking={booking} onOpenReservation={onOpenReservation} />
  </DashboardSceneFrame>
);
