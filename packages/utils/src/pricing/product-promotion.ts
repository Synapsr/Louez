import { formatInTimeZone } from "date-fns-tz";

import type { AppliedProductPromotion, ProductPromotion } from "@louez/types";

export const getProductPromotionStatus = (
  promotion: ProductPromotion | null | undefined,
  timezone = "Europe/Paris",
  now = new Date(),
): "none" | "scheduled" | "active" | "expired" => {
  if (
    !promotion ||
    !Number.isInteger(promotion.percentage) ||
    promotion.percentage <= 0 ||
    promotion.percentage > 99
  )
    return "none";
  const today = formatInTimeZone(now, timezone, "yyyy-MM-dd");
  if (promotion.startsOn && today < promotion.startsOn) return "scheduled";
  if (promotion.endsOn && today > promotion.endsOn) return "expired";
  return "active";
};

/** Apply an offer to the actual rental price, after duration and seasonal rates. */
export const applyProductPromotion = (
  subtotal: number,
  promotion: ProductPromotion | null | undefined,
  timezone?: string,
  now?: Date,
): { subtotal: number; promotion: AppliedProductPromotion | null } => {
  if (
    !promotion ||
    subtotal <= 0 ||
    getProductPromotionStatus(promotion, timezone, now) !== "active"
  ) {
    return { subtotal, promotion: null };
  }
  const originalSubtotal = Math.round(subtotal * 100) / 100;
  const discountAmount = Math.round(originalSubtotal * promotion.percentage) / 100;
  return {
    subtotal: Math.round((originalSubtotal - discountAmount) * 100) / 100,
    promotion:
      discountAmount > 0
        ? { percentage: promotion.percentage, originalSubtotal, discountAmount }
        : null,
  };
};
