"use client";

import { useTranslations } from "next-intl";

import { Label, Radio, RadioGroup } from "@louez/ui";

import type { StoreHeroLayout } from "@/lib/utils/util.store-hero";

import { HeroLayoutSketch } from "./hero-layout-sketch";

interface HeroLayoutFieldProps {
  value: StoreHeroLayout;
  onChange: (next: StoreHeroLayout) => void;
}

const LAYOUTS: StoreHeroLayout[] = ["cover", "split"];

/** Two cards, one per hero layout, each with its thumbnail. */
export const HeroLayoutField = ({ value, onChange }: HeroLayoutFieldProps) => {
  const t = useTranslations("dashboard.settings.appearanceSettings.heroLayout");

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Label>{t("title")}</Label>
        <p className="text-muted-foreground text-xs">{t("description")}</p>
      </div>
      <RadioGroup
        value={value}
        onValueChange={(next) => onChange(next === "split" ? "split" : "cover")}
        className="grid grid-cols-2 gap-3"
      >
        {LAYOUTS.map((layout) => (
          <Label
            key={layout}
            className="flex cursor-pointer flex-col gap-2 rounded-lg border p-3 hover:bg-accent/50 has-data-checked:border-primary/48 has-data-checked:bg-accent/50"
          >
            <HeroLayoutSketch layout={layout} />
            <span className="flex items-start gap-2">
              <Radio value={layout} className="mt-0.5" />
              <span className="flex flex-col gap-0.5">
                <span className="font-semibold text-sm">{t(layout)}</span>
                <span className="font-normal text-muted-foreground text-xs">
                  {t(`${layout}Description`)}
                </span>
              </span>
            </span>
          </Label>
        ))}
      </RadioGroup>
    </div>
  );
};
