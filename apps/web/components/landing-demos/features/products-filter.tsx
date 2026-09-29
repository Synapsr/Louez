"use client";

import { ProductsListScene } from "./products-list";
import type { FeatureSceneProps } from "@/components/landing-demos/feature-demo.types";

export const ProductsFilterScene = ({ period, booking, onOpenReservation }: FeatureSceneProps) => (
  <ProductsListScene period={period} booking={booking} onOpenReservation={onOpenReservation} />
);
