"use client";

import { useTranslations } from "next-intl";

import { Label } from "@louez/ui";
import { cn } from "@louez/utils";

import type {
  StoreHeroAlign,
  StoreHeroLayout,
  StoreHeroVerticalAlign,
} from "@/lib/utils/util.store-hero";

interface HeroPosition {
  align: StoreHeroAlign;
  verticalAlign: StoreHeroVerticalAlign;
}

interface HeroPositionFieldProps extends HeroPosition {
  layout: StoreHeroLayout;
  onChange: (next: HeroPosition) => void;
}

const ROWS: StoreHeroVerticalAlign[] = ["start", "center", "end"];
const COLUMNS: StoreHeroAlign[] = ["start", "center", "end"];

const LABEL_KEYS = {
  start: { start: "topStart", center: "topCenter", end: "topEnd" },
  center: { start: "middleStart", center: "middleCenter", end: "middleEnd" },
  end: { start: "bottomStart", center: "bottomCenter", end: "bottomEnd" },
} as const;

const BAR_ITEMS: Record<StoreHeroVerticalAlign, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
};

/**
 * Nine cells, one per position of the text on the photo, the way a design
 * tool places a layer. The split layout has no horizontal centre, so its
 * middle column is off.
 */
export const HeroPositionField = ({
  align,
  verticalAlign,
  layout,
  onChange,
}: HeroPositionFieldProps) => {
  const t = useTranslations("dashboard.settings.appearanceSettings.heroAlign");

  return (
    <div className="flex flex-col gap-2">
      <Label id="hero-position-label">{t("title")}</Label>
      <div
        role="radiogroup"
        aria-labelledby="hero-position-label"
        className="grid w-fit grid-cols-3 gap-1 rounded-xl bg-muted p-2"
      >
        {ROWS.map((row) =>
          COLUMNS.map((column) => {
            const selected = row === verticalAlign && column === align;
            const disabled = layout === "split" && column === "center";
            return (
              <button
                key={`${row}-${column}`}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={t(LABEL_KEYS[row][column])}
                disabled={disabled}
                onClick={() => onChange({ align: column, verticalAlign: row })}
                className={cn(
                  "group relative flex size-10 items-center justify-center rounded-lg transition-colors hover:bg-background/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex h-5 gap-0.5 group-hover:opacity-100",
                    BAR_ITEMS[row],
                    selected ? "opacity-100" : "opacity-0",
                  )}
                >
                  <span
                    className={cn(
                      "h-3 w-0.5 rounded-full",
                      selected ? "bg-primary" : "bg-muted-foreground",
                    )}
                  />
                  <span
                    className={cn(
                      "h-5 w-0.5 rounded-full",
                      selected ? "bg-primary" : "bg-muted-foreground",
                    )}
                  />
                  <span
                    className={cn(
                      "h-2.5 w-0.5 rounded-full",
                      selected ? "bg-primary" : "bg-muted-foreground",
                    )}
                  />
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "absolute size-1.5 rounded-full bg-muted-foreground/50 group-hover:opacity-0",
                    selected && "opacity-0",
                  )}
                />
              </button>
            );
          }),
        )}
      </div>
      <p className="text-muted-foreground text-xs">{t("hint")}</p>
    </div>
  );
};
