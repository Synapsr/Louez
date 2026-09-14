"use client";

import { useTranslations } from "next-intl";

import { Label } from "@louez/ui";

import type { StoreHeroLayout } from "@/lib/utils/util.store-hero";

import { PanelTilePicker } from "../panel/panel-tile-picker";
import { HeroLayoutSketch } from "./hero-layout-sketch";

interface HeroLayoutFieldProps {
  value: StoreHeroLayout;
  onChange: (next: StoreHeroLayout) => void;
}

const LAYOUTS: StoreHeroLayout[] = ["cover", "split"];

/** The two hero layouts as thumbnails. */
export const HeroLayoutField = ({ value, onChange }: HeroLayoutFieldProps) => {
  const t = useTranslations("dashboard.settings.appearanceSettings.heroLayout");

  return (
    <div className="flex flex-col gap-2">
      <Label id="hero-layout-label">{t("title")}</Label>
      <PanelTilePicker
        aria-labelledby="hero-layout-label"
        value={value}
        onChange={onChange}
        options={LAYOUTS.map((layout) => ({
          value: layout,
          label: t(layout),
          preview: <HeroLayoutSketch layout={layout} className="rounded-lg border-0" />,
        }))}
      />
    </div>
  );
};
