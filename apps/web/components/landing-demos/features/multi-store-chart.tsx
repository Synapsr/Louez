"use client";

import type { FeatureSceneProps } from "@/components/landing-demos/feature-demo.types";
import { MultiStoreDemoPage } from "@/components/landing-demos/features/multi-store-demo-page";

export const MultiStoreChartScene = ({ period }: FeatureSceneProps) => (
  <MultiStoreDemoPage period={period} showChart />
);
