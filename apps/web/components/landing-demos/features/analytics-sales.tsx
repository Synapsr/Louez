"use client";

import { AnalyticsDemoPage } from "@/components/landing-demos/features/analytics-demo-page";
import type { FeatureSceneProps } from "@/components/landing-demos/feature-demo.types";

export const AnalyticsSalesScene = ({ period }: FeatureSceneProps) => (
  <AnalyticsDemoPage period={period} />
);
