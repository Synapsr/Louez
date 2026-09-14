"use client";

import { useTranslations } from "next-intl";

import { cn } from "@louez/utils";

import type {
  StoreHeroAlign,
  StoreHeroLayout,
  StoreHeroVerticalAlign,
} from "@/lib/utils/util.store-hero";

import { PanelRow } from "../panel/panel-row";

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
    <PanelRow label={t("title")}>
      <div
        role="radiogroup"
        aria-label={t("title")}
        className="grid shrink-0 grid-cols-3 gap-0.5 rounded-lg bg-muted p-1"
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
                  "group flex size-7 items-center justify-center rounded-md transition-colors hover:bg-background/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30",
                  selected && "bg-background shadow-xs hover:bg-background",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-2 rounded-full transition-[scale,background-color]",
                    selected
                      ? "bg-primary"
                      : "scale-50 bg-muted-foreground/50 group-hover:scale-75 group-hover:bg-muted-foreground",
                  )}
                />
              </button>
            );
          }),
        )}
      </div>
    </PanelRow>
  );
};
