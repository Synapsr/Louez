import { getStoreDayOffset, type StoreDay } from "./util.store-day";

/** Requests starting further out than this carry no deadline marker. */
const SOON_DAYS = 7;

/**
 * How close a pending request is to its start, on the store's calendar. `null`
 * when there is no real deadline yet, so the row stays plain.
 */
export type PendingUrgency =
  | { kind: "past" }
  | { kind: "today" }
  | { kind: "tomorrow" }
  | { kind: "soon"; days: number };

export const getPendingUrgency = (day: StoreDay, startDate: Date): PendingUrgency | null => {
  if (startDate < day.now) return { kind: "past" };
  const days = getStoreDayOffset(day, startDate);
  if (days <= 0) return { kind: "today" };
  if (days === 1) return { kind: "tomorrow" };
  if (days <= SOON_DAYS) return { kind: "soon", days };
  return null;
};
