"use client";

import type { FeatureSceneProps } from "@/components/landing-demos/feature-demo.types";
import { StorefrontProductDemo } from "./storefront-product-demo";

export const StorefrontProductScene = ({ period }: FeatureSceneProps) => (
  <StorefrontProductDemo period={period} variant="product" />
);
