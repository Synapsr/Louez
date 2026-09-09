import type { StoreSettings } from "@louez/types";

import { validateRentalPeriod } from "@/lib/utils/business-hours";
import { validateAdvanceNotice } from "@/lib/utils/duration";
import {
  formatDurationFromMinutes,
  getMaxRentalMinutes,
  getMinRentalMinutes,
  validateMaxRentalDurationMinutes,
  validateMinRentalDurationMinutes,
} from "@/lib/utils/rental-duration";

import { failReservation, type ReservationFailure } from "./reservation.types";

export interface RentalWindow {
  start: Date;
  end: Date;
}

/** The reservation period spans the earliest start and the latest end of the lines. */
export const getRentalWindow = (
  items: ReadonlyArray<{ startDate: string; endDate: string }>,
): RentalWindow => {
  const startTimes = items.map((item) => new Date(item.startDate).getTime());
  const endTimes = items.map((item) => new Date(item.endDate).getTime());
  return {
    start: new Date(Math.min(...startTimes)),
    end: new Date(Math.max(...endTimes)),
  };
};

/**
 * Opening hours (closures included) and advance notice. Runs before the
 * catalog is loaded, so a badly placed window is reported before stock.
 */
export const validateRentalWindow = ({
  window,
  settings,
  now = new Date(),
}: {
  window: RentalWindow;
  settings: StoreSettings | null | undefined;
  now?: Date;
}): { ok: true } | ReservationFailure => {
  const businessHours = validateRentalPeriod(
    window.start,
    window.end,
    settings?.businessHours,
    settings?.timezone,
  );
  if (!businessHours.valid) {
    return failReservation("errors.businessHoursViolation", {
      reasons: businessHours.errors.join(", "),
    });
  }

  const advanceNoticeMinutes = settings?.advanceNoticeMinutes || 0;
  const advanceNotice = validateAdvanceNotice(window.start, advanceNoticeMinutes, now);
  if (!advanceNotice.valid) {
    return failReservation("errors.advanceNoticeViolation", {
      duration: formatDurationFromMinutes(advanceNoticeMinutes),
      advanceNoticeMinutes,
      minimumStartTime: advanceNotice.minimumStartTime.toISOString(),
    });
  }

  return { ok: true };
};

/**
 * Minimum and maximum rental duration. Fixed-price products impose no duration
 * of their own: a cart made only of them skips both limits.
 */
export const validateRentalDuration = ({
  window,
  settings,
  hasDurationProduct,
}: {
  window: RentalWindow;
  settings: StoreSettings | null | undefined;
  hasDurationProduct: boolean;
}): { ok: true } | ReservationFailure => {
  if (!hasDurationProduct) {
    return { ok: true };
  }

  const minRentalMinutes = getMinRentalMinutes(settings);
  if (minRentalMinutes > 0) {
    const minimum = validateMinRentalDurationMinutes(window.start, window.end, minRentalMinutes);
    if (!minimum.valid) {
      return failReservation("errors.minRentalDurationViolation", {
        duration: formatDurationFromMinutes(minRentalMinutes),
      });
    }
  }

  const maxRentalMinutes = getMaxRentalMinutes(settings);
  if (maxRentalMinutes !== null) {
    const maximum = validateMaxRentalDurationMinutes(window.start, window.end, maxRentalMinutes);
    if (!maximum.valid) {
      return failReservation("errors.maxRentalDurationViolation", {
        duration: formatDurationFromMinutes(maxRentalMinutes),
      });
    }
  }

  return { ok: true };
};
