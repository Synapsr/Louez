"use client";

import { Maximize2, Navigation, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@louez/utils";

import {
  CheckoutFulfillmentMap,
  type FulfillmentMapPin,
  type FulfillmentMapRadius,
} from "./checkout-fulfillment-map";

interface CheckoutFulfillmentMapPanelProps {
  pins: FulfillmentMapPin[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  radius: FulfillmentMapRadius | null;
  link: { from: [number, number]; to: [number, number] } | null;
  /** Google Maps directions for the selected location; null in delivery mode. */
  directionsHref: string | null;
  /** Distance and price for a delivery leg, once both are known. */
  summary: string | null;
  isExpanded: boolean;
  onExpandedChange: (isExpanded: boolean) => void;
  /**
   * Hidden panels stay mounted so the map is never torn down and rebuilt when
   * the customer moves between legs.
   */
  isHidden: boolean;
}

/** The map plus the controls that sit on top of it. */
export const CheckoutFulfillmentMapPanel = ({
  pins,
  selectedId,
  onSelect,
  radius,
  link,
  directionsHref,
  summary,
  isExpanded,
  onExpandedChange,
  isHidden,
}: CheckoutFulfillmentMapPanelProps) => {
  const t = useTranslations("storefront.checkout");

  return (
    <div
      hidden={isHidden}
      className={cn(isExpanded && "fixed inset-0 z-50 bg-background p-3", isHidden && "hidden")}
    >
      <CheckoutFulfillmentMap
        className={cn(
          "rounded-2xl border bg-muted",
          isExpanded ? "h-full" : "h-64 sm:h-72 lg:h-80",
        )}
        pins={pins}
        selectedId={selectedId}
        onSelect={onSelect}
        radius={radius}
        link={link}
        overlay={
          <div className="flex h-full flex-col justify-between gap-2 p-2">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => onExpandedChange(!isExpanded)}
                aria-label={isExpanded ? t("mapCollapse") : t("mapExpand")}
                className="pointer-events-auto flex size-8 shrink-0 items-center justify-center rounded-full bg-background/95 shadow-raised backdrop-blur hover:bg-accent"
              >
                {isExpanded ? (
                  <X aria-hidden className="size-4" />
                ) : (
                  <Maximize2 aria-hidden className="size-4" />
                )}
              </button>
            </div>

            <div className="flex items-end justify-between gap-2">
              {summary ? (
                <span className="rounded-full bg-background/95 px-2.5 py-1 text-xs font-medium tabular-nums shadow-raised backdrop-blur">
                  {summary}
                </span>
              ) : directionsHref ? (
                <a
                  href={directionsHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-background/95 px-3 py-1.5 text-xs font-medium shadow-raised backdrop-blur hover:bg-accent"
                >
                  <Navigation aria-hidden className="size-3.5" />
                  {t("getDirections")}
                </a>
              ) : null}
            </div>
          </div>
        }
      />
    </div>
  );
};
