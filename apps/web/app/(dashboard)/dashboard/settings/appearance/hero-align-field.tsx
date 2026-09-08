"use client";

import { useTranslations } from "next-intl";

import { Label, ToggleGroup, ToggleGroupItem } from "@louez/ui";
import { AlignCenter, AlignLeft, AlignRight } from "lucide-react";

import type { StoreHeroAlign, StoreHeroLayout } from "@/lib/utils/util.store-hero";

interface HeroAlignFieldProps {
  value: StoreHeroAlign;
  layout: StoreHeroLayout;
  onChange: (next: StoreHeroAlign) => void;
}

const OPTIONS: { value: StoreHeroAlign; icon: typeof AlignLeft }[] = [
  { value: "start", icon: AlignLeft },
  { value: "center", icon: AlignCenter },
  { value: "end", icon: AlignRight },
];

const isAlign = (value: unknown): value is StoreHeroAlign =>
  value === "start" || value === "center" || value === "end";

/** Left, centre or right; the split layout has no centre, its text always sits in a column. */
export const HeroAlignField = ({ value, layout, onChange }: HeroAlignFieldProps) => {
  const t = useTranslations("dashboard.settings.appearanceSettings.heroAlign");

  return (
    <div className="flex flex-col gap-2">
      <Label>{t("title")}</Label>
      <ToggleGroup
        variant="outline"
        value={[value]}
        onValueChange={(next) => {
          const [picked] = next;
          if (isAlign(picked)) onChange(picked);
        }}
        aria-label={t("title")}
      >
        {OPTIONS.map(({ value: option, icon: Icon }) => (
          <ToggleGroupItem
            key={option}
            value={option}
            disabled={layout === "split" && option === "center"}
            className="px-3"
          >
            <Icon aria-hidden />
            {t(option)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p className="text-muted-foreground text-xs">{t("hint")}</p>
    </div>
  );
};
