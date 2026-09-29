"use client";

import { useState } from "react";

import { PromoCodesSettingsContent } from "@/app/(dashboard)/dashboard/settings/promo-codes/promo-codes-settings-content";
import type { FeatureSceneProps } from "@/components/landing-demos/feature-demo.types";
import { PricingEditor } from "@/components/landing-demos/features/pricing-editor";
import { SettingsSceneFrame } from "@/components/landing-demos/settings-scene-frame";
import { useDemoCue } from "@/components/landing-demos/use-demo-cue";
import { createDemoPromoCodes } from "@/lib/landing-demos/pricing";

export const PricingSeasonsPromosScene = ({ period }: FeatureSceneProps) => {
  const [showPromos, setShowPromos] = useState(false);
  const [codes] = useState(() => createDemoPromoCodes(period));
  useDemoCue("pricing-show-promos", () => setShowPromos(true));

  if (!showPromos) return <PricingEditor period={period} />;
  return (
    <SettingsSceneFrame pathname="/dashboard/settings/promo-codes">
      <PromoCodesSettingsContent codes={codes} currency="EUR" readOnly />
    </SettingsSceneFrame>
  );
};
