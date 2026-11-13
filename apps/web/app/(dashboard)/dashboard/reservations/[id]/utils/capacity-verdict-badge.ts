import { CAPACITY_VERDICT_ACTIVITY_TYPES } from "@louez/api/contracts/reservations";

const VERDICT_TYPES: ReadonlySet<string> = new Set(CAPACITY_VERDICT_ACTIVITY_TYPES);

/**
 * Whether a history row shows the "overbooked" badge: a row that carries a
 * capacity verdict (a creation, an edit, a confirmation) whose write booked
 * over the stock.
 */
export const showsOverbookedBadge = (activity: {
  activityType: string;
  metadata: Record<string, unknown> | null;
}): boolean => VERDICT_TYPES.has(activity.activityType) && activity.metadata?.overbooked === true;

/**
 * Whether a history row shows the "turnover buffer reduced" badge: a row that
 * carries a capacity verdict whose write confirmed lines past the turnover
 * buffer, on purpose (`overrideTurnoverBuffer`). A row sent with the flag
 * that the buffer stopped nothing on (`turnoverBufferOverridden: false`)
 * shows none.
 */
export const showsTurnoverBufferOverriddenBadge = (activity: {
  activityType: string;
  metadata: Record<string, unknown> | null;
}): boolean =>
  VERDICT_TYPES.has(activity.activityType) && activity.metadata?.turnoverBufferOverridden === true;
