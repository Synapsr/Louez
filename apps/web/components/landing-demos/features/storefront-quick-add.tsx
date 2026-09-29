"use client";

import type { FeatureSceneProps } from "@/components/landing-demos/feature-demo.types";
import { StorefrontProductDemo } from "./storefront-product-demo";

export const StorefrontQuickAddScene = ({ period }: FeatureSceneProps) => (
  <StorefrontProductDemo period={period} variant="quick-add" />
);
