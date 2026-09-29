"use client";

import type { FeatureSceneProps } from "@/components/landing-demos/feature-demo.types";
import { PricingEditor } from "@/components/landing-demos/features/pricing-editor";

export const PricingLadderScene = ({ period }: FeatureSceneProps) => (
  <PricingEditor period={period} />
);
