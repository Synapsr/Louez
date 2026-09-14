"use client";

import { useState } from "react";

import { useTranslations } from "next-intl";

import { Slider } from "@louez/ui";

import { useFormatMoney } from "@/hooks/use-format-money";
import type { CatalogPriceBounds } from "@/lib/storefront/catalog.queries";

type PriceRange = [number, number];

/** Roughly a hundred stops across the range, never finer than one unit. */
const stepOf = ({ min, max }: CatalogPriceBounds): number =>
  Math.max(1, Math.round((max - min) / 100));

/** The slider types its value for one or many thumbs; this one always has two. */
const toRange = (value: number | readonly number[], fallback: PriceRange): PriceRange =>
  typeof value === "number"
    ? [value, fallback[1]]
    : [value[0] ?? fallback[0], value[1] ?? fallback[1]];

interface CatalogPriceFilterProps {
  /** The range the store's prices span; both thumbs stay inside it. */
  bounds: CatalogPriceBounds;
  /** The bounds from the URL; null means the thumb sits at the end of the range. */
  min: number | null;
  max: number | null;
  /** With dates the amounts are period totals, the numbers on the cards; without, base rates. */
  hasPeriod: boolean;
  onChange: (range: { min: number | null; max: number | null }) => void;
}

/**
 * The price range of the sidebar. Dragging only moves the thumbs; the URL
 * is patched once on release, so one drag is one server round trip. A thumb
 * left at its end of the range writes nothing, keeping the address clean.
 * Whole amounts only: cents on a range label are noise.
 */
export const CatalogPriceFilter = ({
  bounds,
  min,
  max,
  hasPeriod,
  onChange,
}: CatalogPriceFilterProps) => {
  const t = useTranslations("storefront.catalog");
  const formatMoney = useFormatMoney();
  const formatWhole = (amount: number) => formatMoney(amount, { fractionDigits: 0 });

  const committed: PriceRange = [min ?? bounds.min, max ?? bounds.max];
  // Held only while a thumb is being dragged; cleared on release so the
  // slider follows the URL again (a reset, a shared link).
  const [dragged, setDragged] = useState<PriceRange | null>(null);
  const [low, high] = dragged ?? committed;

  const handleCommit = ([nextLow, nextHigh]: PriceRange) => {
    setDragged(null);
    onChange({
      min: nextLow === bounds.min ? null : nextLow,
      max: nextHigh === bounds.max ? null : nextHigh,
    });
  };

  return (
    <div className="flex flex-col gap-3" data-slot="catalog-price-filter">
      <Slider
        aria-label={t("price")}
        min={bounds.min}
        max={bounds.max}
        step={stepOf(bounds)}
        value={[low, high]}
        onValueChange={(value) => setDragged(toRange(value, [low, high]))}
        onValueCommitted={(value) => handleCommit(toRange(value, [low, high]))}
        className="px-1"
      />
      <div className="flex flex-col gap-0.5">
        <p className="text-sm tabular-nums text-foreground">
          {t("priceRange", { min: formatWhole(low), max: formatWhole(high) })}
        </p>
        <p className="text-xs text-muted-foreground">
          {hasPeriod ? t("pricePeriodHint") : t("priceBaseHint")}
        </p>
      </div>
    </div>
  );
};
