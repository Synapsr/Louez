import { addMonths, format } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

import { roundToMinorUnit } from "@louez/utils";

import type {
  PartnerBooking,
  PartnerCommissionState,
  PartnerCommissionType,
  PartnerMonthTotals,
} from "../contracts/partners";

/**
 * The arithmetic of Liens partenaires (docs/product/liens-partenaires.md),
 * without a database: the base a commission is computed on, its amount, its
 * state, and the month it belongs to.
 */

/** The amounts of a reservation that make its commission base, as stored (decimal strings). */
export interface CommissionAmounts {
  subtotalAmount: string | number;
  discountAmount: string | number | null;
  tulipInsuranceAmount: string | number | null;
}

const toNumber = (value: string | number | null | undefined): number => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};

/**
 * The rental the commission is computed on: the lines as the store priced
 * them, after the discount; never the deposit, the delivery or the insurance.
 * `subtotal_amount` holds the lines plus the insurance, and neither the
 * delivery fee nor the deposit.
 */
export function commissionBase(amounts: CommissionAmounts, currency: string): number {
  const base =
    toNumber(amounts.subtotalAmount) -
    toNumber(amounts.tulipInsuranceAmount) -
    toNumber(amounts.discountAmount);
  return Math.max(0, roundToMinorUnit(base, currency));
}

/**
 * What a rule gives on a base: a percentage of it, or a fixed amount per
 * booking. Never more than the base, never negative, rounded to the
 * currency's minor unit.
 */
export function computeCommission(
  rule: { type: PartnerCommissionType; value: number },
  base: number,
  currency: string,
): number {
  if (base <= 0 || rule.value <= 0) return 0;
  const raw = rule.type === "percent" ? (base * Math.min(rule.value, 100)) / 100 : rule.value;
  return roundToMinorUnit(Math.min(raw, base), currency);
}

/**
 * Where a commission stands. Due once the rental is completed, or once its
 * end has passed while it is confirmed or ongoing: many stores never close a
 * reservation, and the partner should not wait on that. Cancelled when it
 * never happened; upcoming otherwise (a request or a quote is not a rental yet).
 */
export function commissionState(status: string, endDate: Date, now: Date): PartnerCommissionState {
  switch (status) {
    case "completed":
      return "due";
    case "confirmed":
    case "ongoing":
      return endDate.getTime() <= now.getTime() ? "due" : "upcoming";
    case "cancelled":
    case "rejected":
    case "declined":
      return "cancelled";
    default:
      return "upcoming";
  }
}

/** The month (`YYYY-MM`) an instant falls in, in the store's timezone. */
export function monthOf(instant: Date, timezone: string): string {
  return format(toZonedTime(instant, timezone), "yyyy-MM");
}

/** The instants a month covers in the store's timezone: `[start, end)`. */
export function monthRange(month: string, timezone: string): { start: Date; end: Date } {
  const [year, monthIndex] = month.split("-").map(Number);
  const localStart = new Date(year, monthIndex - 1, 1);
  return {
    start: fromZonedTime(localStart, timezone),
    end: fromZonedTime(addMonths(localStart, 1), timezone),
  };
}

/** The current month and the `count − 1` before it, most recent first. */
export function recentMonths(now: Date, timezone: string, count: number): string[] {
  const local = toZonedTime(now, timezone);
  const current = new Date(local.getFullYear(), local.getMonth(), 1);
  return Array.from({ length: count }, (_, index) => format(addMonths(current, -index), "yyyy-MM"));
}

/** A month's totals over its bookings, what was paid and the link's visits. */
export function monthTotals(
  bookings: readonly Pick<PartnerBooking, "commission" | "state">[],
  paid: number,
  visits: number,
  currency: string,
): PartnerMonthTotals {
  let due = 0;
  let upcoming = 0;
  for (const booking of bookings) {
    if (booking.state === "due") due += booking.commission;
    if (booking.state === "upcoming") upcoming += booking.commission;
  }
  const roundedDue = roundToMinorUnit(due, currency);
  const roundedPaid = roundToMinorUnit(paid, currency);
  return {
    bookings: bookings.length,
    due: roundedDue,
    upcoming: roundToMinorUnit(upcoming, currency),
    paid: roundedPaid,
    remaining: roundToMinorUnit(roundedDue - roundedPaid, currency),
    visits,
  };
}
