"use client";

/**
 * Seasonal rates over the same maths as base rates.
 *
 * Seasonal pricing is not part of the product form: it lives in its own rows and
 * saves itself as you type. So the state is local and debounced here, while the
 * ladder, the curve and the tier economics come from `usePricingMath` — which is
 * why that hook is separate from where its state lives. VAT, deposit and the
 * calculation mode stay product-level and are read-only from a season.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { toastManager } from "@louez/ui";
import { minutesToPriceDuration } from "@louez/utils";

import type { PriceDurationValue } from "@/components/ui/price-duration-input";

import { updateSeasonalPricing } from "../seasonal-actions";
import type { RateTierInput, SeasonalPricingData } from "../types";
import { usePricingMath } from "./use-pricing-draft";

export type SeasonalSaveStatus = "idle" | "saving" | "saved";

const AUTOSAVE_DELAY_MS = 1500;

/** Stored seasonal tiers as editable rows. Exported because saving a period's
 *  metadata has to resend its rates, even for a period you are not editing. */
export function toStoredTiers(period: SeasonalPricingData): RateTierInput[] {
  return toFormTiers(period.tiers);
}

function toFormTiers(tiers: SeasonalPricingData["tiers"]): RateTierInput[] {
  return tiers
    .filter((tier) => tier.period !== null && tier.price !== null)
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
    .map((tier) => {
      const { duration, unit } = minutesToPriceDuration(tier.period!);
      return { id: tier.id, price: tier.price!, duration, unit };
    });
}

export function useSeasonalPricingDraft({
  period,
  fallbackUnit,
  fallbackDuration,
  isProrated,
  onPriceSaved,
}: {
  period: SeasonalPricingData | null;
  fallbackUnit: PriceDurationValue["unit"];
  fallbackDuration: number;
  /** Product-level, so a season only reads it — the curve still has to be right. */
  isProrated: boolean;
  onPriceSaved: (periodId: string, price: string) => void;
}) {
  const [baseRate, setBaseRateState] = useState<PriceDurationValue>({
    price: "",
    duration: fallbackDuration,
    unit: fallbackUnit,
  });
  const [tiers, setTiersState] = useState<RateTierInput[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [status, setStatus] = useState<SeasonalSaveStatus>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest values, so a save fired from a callback never reads a stale closure.
  const latest = useRef({ baseRate, tiers, period });
  latest.current = { baseRate, tiers, period };

  useEffect(() => {
    if (!period) return;
    setBaseRateState({
      price: period.price,
      duration: fallbackDuration,
      unit: fallbackUnit,
    });
    setTiersState(toFormTiers(period.tiers));
    setIsDirty(false);
    setStatus("idle");
    // Reloading on anything but the period id would fight the user's typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period?.id]);

  const save = useCallback(async () => {
    const { period: current, baseRate: rate, tiers: rows } = latest.current;
    if (!current) return false;

    const result = await updateSeasonalPricing(current.id, {
      name: current.name,
      startDate: current.startDate,
      endDate: current.endDate,
      price: rate.price.replace(",", "."),
      rateTiers: rows.map((tier) => ({
        price: tier.price.replace(",", "."),
        duration: tier.duration,
        unit: tier.unit,
      })),
    });

    if (result && "error" in result) {
      toastManager.add({ title: result.error, type: "error" });
      return false;
    }
    onPriceSaved(current.id, rate.price.replace(",", "."));
    return true;
  }, [onPriceSaved]);

  useEffect(() => {
    if (!isDirty || !period) return;
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      setStatus("saving");
      const ok = await save();
      if (!ok) {
        setStatus("idle");
        return;
      }
      setIsDirty(false);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    }, AUTOSAVE_DELAY_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isDirty, baseRate, tiers, period, save]);

  /** Commit anything pending — before leaving the season or duplicating it. */
  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!isDirty) return;
    await save();
    setIsDirty(false);
    setStatus("idle");
  }, [isDirty, save]);

  const setBaseRate = useCallback((next: PriceDurationValue) => {
    setBaseRateState(next);
    setIsDirty(true);
  }, []);

  const setTiers = useCallback((next: RateTierInput[]) => {
    setTiersState(next);
    setIsDirty(true);
  }, []);

  const noop = useCallback(() => {}, []);

  const draft = usePricingMath({
    baseRate,
    tiers,
    isProrated,
    setBaseRate,
    setTiers,
    setProrated: noop,
  });

  return { draft, status, flush, isDirty };
}
