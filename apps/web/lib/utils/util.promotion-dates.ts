import type { ProductPromotion } from "@louez/types";

type PromotionDates = Pick<ProductPromotion, "startsOn" | "endsOn">;

/**
 * One click per edit on a single calendar. The first day opens an offer with
 * no end; after that a click before the start moves the start and any other
 * click sets the end, so extending or shortening a running offer never resets
 * it. An offer that only has an end keeps "starting now" and moves its end.
 */
export const pickPromotionDay = (dates: PromotionDates, day: string): PromotionDates => {
  if (!dates.startsOn && !dates.endsOn) return { startsOn: day, endsOn: null };
  if (!dates.startsOn) return { startsOn: null, endsOn: day };
  if (day < dates.startsOn) return { startsOn: day, endsOn: dates.endsOn };
  return { startsOn: dates.startsOn, endsOn: day };
};

/** A `yyyy-MM-dd` calendar day as a local midnight, the shape the day picker works in. */
export const promotionDayToDate = (day: string) => {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date);
};
