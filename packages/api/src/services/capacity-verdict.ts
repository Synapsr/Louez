import { eq, max } from "drizzle-orm";

import { reservationActivity, type Transaction } from "@louez/db";

import type { CapacityShortfall } from "../contracts/reservations";

/**
 * A capacity verdict, for the activity row of a write that checked the stock
 * (`CAPACITY_VERDICT_ACTIVITY_TYPES`, contracts/reservations.ts).
 */
export const capacityVerdictMetadata = (
  shortfalls: readonly CapacityShortfall[],
): { overbooked: true; overbookingShortfalls: CapacityShortfall[] } | { overbooked: false } =>
  shortfalls.length > 0
    ? { overbooked: true, overbookingShortfalls: [...shortfalls] }
    : { overbooked: false };

/**
 * The date of a new verdict row, under the reservation's lock. Activity rows
 * are dated to the second: a verdict is dated at least one second after every
 * earlier row of its reservation, so the latest verdict is never a tie.
 */
export const nextCapacityVerdictDate = async (
  tx: Transaction,
  reservationId: string,
  now: Date = new Date(),
): Promise<Date> => {
  const [latest] = await tx
    .select({ at: max(reservationActivity.createdAt) })
    .from(reservationActivity)
    .where(eq(reservationActivity.reservationId, reservationId));
  return latest?.at ? new Date(Math.max(now.getTime(), latest.at.getTime() + 1000)) : now;
};
