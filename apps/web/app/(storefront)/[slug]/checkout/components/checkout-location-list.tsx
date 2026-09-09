"use client";

import { useTranslations } from "next-intl";

import { RadioGroup, RadioGroupItem } from "@louez/ui";
import { cn } from "@louez/utils";

import type { CheckoutLocation } from "../util.checkout-locations";
import { fromLocationKey, toLocationKey } from "../util.checkout-locations";

interface CheckoutLocationListProps {
  leg: "outbound" | "return";
  locations: CheckoutLocation[];
  selectedLocationId: string | null;
  onLocationChange: (locationId: string | null) => void;
}

/**
 * The store's pickup points, nearest first once the customer has shared their
 * position. Each row leads with the number of its pin on the map.
 */
export const CheckoutLocationList = ({
  leg,
  locations,
  selectedLocationId,
  onLocationChange,
}: CheckoutLocationListProps) => {
  const t = useTranslations("storefront.checkout");
  const selectedKey = toLocationKey(selectedLocationId);

  return (
    <RadioGroup
      name={`fulfillment-${leg}-location`}
      aria-label={leg === "outbound" ? t("pickupAtLocation") : t("returnAtLocation")}
      value={selectedKey}
      onValueChange={(value) => onLocationChange(fromLocationKey(String(value)))}
      className="gap-0"
    >
      {locations.map((location) => {
        const isSelected = location.key === selectedKey;

        return (
          <label
            key={location.key}
            className={cn(
              "relative flex cursor-pointer items-center gap-3 rounded-xl py-2.5 pe-2 ps-2",
              // An inset rule with rounded ends, drawn between rows only, so the
              // list reads as a group without a hard frame around it.
              "not-first:before:absolute not-first:before:inset-x-3 not-first:before:top-0 not-first:before:h-px not-first:before:rounded-full not-first:before:bg-border",
              // A rule touching a selected row would cut into its corner.
              isSelected && "bg-primary/5 before:hidden [&+label]:before:hidden",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-lg border text-xs font-semibold tabular-nums",
                isSelected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground",
              )}
            >
              {location.number}
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{location.name}</span>
              {location.fullAddress ? (
                <span className="block truncate text-xs text-muted-foreground">
                  {location.fullAddress}
                </span>
              ) : null}
            </span>

            {location.distanceKm !== null ? (
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {t("distanceKm", { distance: location.distanceKm.toFixed(1) })}
              </span>
            ) : null}

            <RadioGroupItem value={location.key} />
          </label>
        );
      })}
    </RadioGroup>
  );
};
