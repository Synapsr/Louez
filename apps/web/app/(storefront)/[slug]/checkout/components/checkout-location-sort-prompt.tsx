"use client";

import { Ban, Crosshair, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import type { MyLocationPermission } from "@/hooks/use-my-location";

interface CheckoutLocationSortPromptProps {
  permission: MyLocationPermission;
  isLocating: boolean;
  /** True once we have a position — the distances on the rows say the rest. */
  isLocated: boolean;
  onLocate: () => void;
}

/**
 * Offers to sort the pickup locations by distance, and explains itself when the
 * browser will not let us ask.
 */
export const CheckoutLocationSortPrompt = ({
  permission,
  isLocating,
  isLocated,
  onLocate,
}: CheckoutLocationSortPromptProps) => {
  const t = useTranslations("storefront.checkout");

  // Once the distances are on the rows they say it better than a banner would.
  if (isLocated) return null;

  // Blocked is a dead end: the browser will not re-open the prompt for a script,
  // so point at the only thing that can lift it instead of offering a button
  // that would quietly do nothing.
  if (permission === "denied" || permission === "unsupported") {
    return (
      <p className="flex items-start gap-2 rounded-xl bg-muted px-3 py-2.5 text-xs text-muted-foreground">
        <Ban aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <span>
          {permission === "unsupported" ? t("locationUnsupported") : t("locationBlocked")}
        </span>
      </p>
    );
  }

  return (
    <button
      type="button"
      onClick={onLocate}
      disabled={isLocating}
      className="flex items-center gap-2 rounded-xl border border-dashed px-3 py-2.5 text-start text-sm transition-colors duration-150 hover:border-primary hover:bg-primary/5 disabled:opacity-60 motion-reduce:transition-none"
    >
      {isLocating ? (
        <Loader2 aria-hidden className="size-4 shrink-0 motion-safe:animate-spin" />
      ) : (
        <Crosshair aria-hidden className="size-4 shrink-0 text-primary" />
      )}
      <span className="min-w-0">
        <span className="block font-medium">
          {isLocating ? t("locationLocating") : t("sortByDistance")}
        </span>
        <span className="block text-xs text-muted-foreground">{t("sortByDistanceHint")}</span>
      </span>
    </button>
  );
};
