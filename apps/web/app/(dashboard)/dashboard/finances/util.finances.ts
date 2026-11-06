import type { inferParserType } from "nuqs/server";

import { getFinanceDayKey, resolveFinanceTimezone } from "@louez/utils";
import type {
  FinanceMovement,
  FinanceMovementsInput,
  FinanceMovementsOutput,
  FinanceOutstandingInput,
  FinancePeriodInput,
} from "@louez/validations";

import { isDay } from "@/lib/utils/util.day-range";

import type { financeSearchParams } from "./finances.constants";

export type FinanceSearchState = inferParserType<typeof financeSearchParams>;

const DAY_MS = 86_400_000;

/** An authorisation hold this close to its expiry is worth a warning. */
export const HOLD_EXPIRY_WARNING_DAYS = 2;

/** A custom range only reaches the server whole; anything else falls back to the preset. */
export const toPeriodInput = ({ period, from, to }: FinanceSearchState): FinancePeriodInput =>
  period === "custom" && isDay(from) && isDay(to) ? { period, from, to } : { period };

const toAmountBound = (value: number | null): number | undefined =>
  value !== null && Number.isFinite(value) && value >= 0 ? value : undefined;

export const toMovementsInput = (state: FinanceSearchState): FinanceMovementsInput => ({
  ...toPeriodInput(state),
  direction: state.direction ?? undefined,
  method: state.method ?? undefined,
  nature: state.nature ?? undefined,
  status: state.status ?? undefined,
  minAmount: toAmountBound(state.min),
  maxAmount: toAmountBound(state.max),
  search: state.q?.trim() || undefined,
  page: Math.max(1, state.page),
  pageSize: state.pageSize,
});

export const toOutstandingInput = (state: FinanceSearchState): FinanceOutstandingInput => ({
  page: Math.max(1, state.page),
  pageSize: state.pageSize,
});

/**
 * Server-rendered data only seeds the query it was fetched for: once a filter
 * moves, handing it over as `initialData` would show the old rows under the
 * new filters.
 */
export const isSameInput = (current: unknown, initial: unknown): boolean =>
  JSON.stringify(current) === JSON.stringify(initial);

export interface FinanceMovementDay {
  key: string;
  net: number;
  movements: FinanceMovement[];
}

/** Rows arrive newest first; each day keeps that order under a header carrying its net. */
export const groupMovementsByDay = ({
  movements,
  days,
}: Pick<FinanceMovementsOutput, "movements" | "days">): FinanceMovementDay[] => {
  const netByDay = new Map(days.map((day) => [day.key, day.net]));
  const groups = new Map<string, FinanceMovementDay>();
  for (const movement of movements) {
    const group = groups.get(movement.dayKey) ?? {
      key: movement.dayKey,
      net: netByDay.get(movement.dayKey) ?? 0,
      movements: [],
    };
    group.movements.push(movement);
    groups.set(movement.dayKey, group);
  }
  return [...groups.values()];
};

/** "+ 320,00 €" / "− 150,00 €": the sign is spelled out, a till is read by direction. */
export const formatSignedAmount = (
  amount: number,
  formatMoney: (value: number) => string,
): string => {
  const formatted = formatMoney(Math.abs(amount));
  if (amount === 0) return formatted;
  return `${amount < 0 ? "−" : "+"} ${formatted}`;
};

const toEpochDay = (date: Date, timezone: string): number =>
  Date.parse(`${getFinanceDayKey(date, timezone)}T00:00:00Z`) / DAY_MS;

export type OutstandingAge =
  | { kind: "upcoming" }
  | { kind: "today" }
  | { kind: "days"; count: number };

/** How long the balance has been due: a rental is payable the day it starts, in the store's calendar. */
export const getOutstandingAge = (
  startDate: Date,
  now: Date,
  timezone: string | undefined,
): OutstandingAge => {
  const resolved = resolveFinanceTimezone(timezone);
  const days = toEpochDay(now, resolved) - toEpochDay(startDate, resolved);
  if (days < 0) return { kind: "upcoming" };
  return days === 0 ? { kind: "today" } : { kind: "days", count: days };
};

export type HoldExpiry =
  | { kind: "unknown" }
  | { kind: "expired" }
  | { kind: "soon"; days: number }
  | { kind: "later" };

/** Stripe releases an authorisation hold on its own: the last days before that deserve a warning. */
export const getHoldExpiry = (expiresAt: Date | null, now: Date): HoldExpiry => {
  if (!expiresAt) return { kind: "unknown" };
  const remaining = expiresAt.getTime() - now.getTime();
  if (remaining <= 0) return { kind: "expired" };
  return remaining <= HOLD_EXPIRY_WARNING_DAYS * DAY_MS
    ? { kind: "soon", days: Math.floor(remaining / DAY_MS) }
    : { kind: "later" };
};

/** Filters hidden behind the "Filtres" popover: their count badges its trigger. */
export const countPopoverFilters = (state: FinanceSearchState): number =>
  [state.nature, state.status, state.min, state.max].filter((value) => value !== null).length;

export const hasActiveFilters = (state: FinanceSearchState): boolean =>
  countPopoverFilters(state) > 0 ||
  state.direction !== null ||
  state.method !== null ||
  Boolean(state.q?.trim());
