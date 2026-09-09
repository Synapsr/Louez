"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@louez/ui";
import type { StockQuantityLimit } from "@louez/utils";
import { cn } from "@louez/utils";

export type AvailabilityStatus =
  | "available"
  | "limited"
  | "unavailable"
  | "out_of_stock"
  | "required_accessory_out_of_stock"
  | "in_cart";

interface AvailabilityBadgeProps {
  status: AvailabilityStatus;
  /** Units free for the period; shown for `available` and `limited`. */
  availableQuantity?: StockQuantityLimit;
  className?: string;
}

const VARIANT_BY_STATUS = {
  available: "success",
  limited: "warning",
  unavailable: "failed",
  out_of_stock: "failed",
  required_accessory_out_of_stock: "failed",
  in_cart: "tertiary",
} as const satisfies Record<AvailabilityStatus, string>;

/**
 * How many units a product has left, as a pill: the shared badge in the
 * status colour, over the card image or next to a product title. Status
 * tokens only, so it reads the same on every tenant theme.
 */
export const AvailabilityBadge = ({
  status,
  availableQuantity = null,
  className,
}: AvailabilityBadgeProps) => {
  const t = useTranslations("storefront.availability.badge");

  const label =
    status === "available"
      ? availableQuantity === null
        ? t("available")
        : availableQuantity === 1
          ? t("lastOne")
          : t("availableCount", { count: availableQuantity })
      : status === "limited"
        ? t("limited", { count: availableQuantity ?? 0 })
        : status === "out_of_stock"
          ? t("outOfStock")
          : status === "required_accessory_out_of_stock"
            ? t("requiredAccessoryOutOfStock")
            : status === "in_cart"
              ? t("inCart")
              : t("unavailable");

  return (
    <Badge
      variant={VARIANT_BY_STATUS[status]}
      className={cn("px-1.5", className)}
      data-slot="availability-badge"
      data-status={status}
    >
      {label}
    </Badge>
  );
};
