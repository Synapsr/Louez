"use client";

import { useTranslations } from "next-intl";
import { cn } from "@louez/utils";
import { Badge } from "@louez/ui";
import type { StockQuantityLimit } from "@louez/utils";
import {
  CartSolidIcon,
  ReviewSolidIcon,
  SuccessSolidIcon,
  XCircleSolidIcon,
} from "@louez/ui/icons";

export type AvailabilityStatus =
  | "available"
  | "limited"
  | "unavailable"
  | "out_of_stock"
  | "required_accessory_out_of_stock"
  | "in_cart";

interface AvailabilityBadgeProps {
  status: AvailabilityStatus;
  availableQuantity?: StockQuantityLimit;
  totalQuantity?: StockQuantityLimit;
  cartQuantity?: number;
  className?: string;
  showIcon?: boolean;
  size?: "sm" | "md";
}

export function AvailabilityBadge({
  status,
  availableQuantity = 0,
  totalQuantity: _totalQuantity = 0,
  cartQuantity = 0,
  className,
  showIcon = true,
  size = "md",
}: AvailabilityBadgeProps) {
  const t = useTranslations("storefront.availability.badge");

  const config = {
    available: {
      icon: SuccessSolidIcon,
      label:
        availableQuantity !== null && availableQuantity > 1
          ? t("availableCount", { count: availableQuantity })
          : t("available"),
      variant: "success" as const,
    },
    limited: {
      icon: ReviewSolidIcon,
      label: t("limited", { count: availableQuantity ?? 0 }),
      variant: "review" as const,
    },
    unavailable: {
      icon: XCircleSolidIcon,
      label: t("unavailable"),
      variant: "failed" as const,
    },
    out_of_stock: {
      icon: XCircleSolidIcon,
      label: t("outOfStock"),
      variant: "failed" as const,
    },
    required_accessory_out_of_stock: {
      icon: XCircleSolidIcon,
      label: t("requiredAccessoryOutOfStock"),
      variant: "failed" as const,
    },
    in_cart: {
      icon: CartSolidIcon,
      label: t("inCart"),
      variant: "progress" as const,
    },
  };

  const { icon: Icon, label, variant } = config[status];

  return (
    <Badge
      variant={variant}
      className={cn(
        "font-medium",
        size === "sm" ? "text-xs px-2 py-0.5" : "text-xs px-2.5 py-1",
        className,
      )}
    >
      {showIcon && <Icon className={cn("mr-1", size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5")} />}
      {label}
      {status === "in_cart" && cartQuantity > 0 && ` (${cartQuantity})`}
    </Badge>
  );
}
