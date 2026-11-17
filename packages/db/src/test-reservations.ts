import { and, eq, type SQL } from "drizzle-orm";

import type { Database, Transaction } from "./index";
import { customers, reservations } from "./schema";

/**
 * Test reservations: a store owner rehearses the customer journey on their own
 * store (`reservations.is_test`, `customers.is_test`, migration 0112). A test
 * reservation:
 *
 * - holds no stock: it is left out of the availability rule and takes or gives
 *   back no consumable (`mutateReservationStock`);
 * - is never billed: no `billableAt`, no fee effect, no billing mark, no snapshot;
 * - stays out of every count, export, calendar, reminder, public API and MCP read;
 * - sends nothing to anyone but the owner who made it, and no SMS.
 *
 * Every place that leaves test reservations out uses one of the helpers below,
 * so the whole feature is found, and removed, by searching for `TestReservation`
 * and `isTest`.
 */

/** Rows that are not test reservations. Combine with `and(...)` on any read of `reservations`. */
export function excludeTestReservations(): SQL {
  return eq(reservations.isTest, false);
}

/** Rows that are not test customers. Combine with `and(...)` on any read of `customers`. */
export function excludeTestCustomers(): SQL {
  return eq(customers.isTest, false);
}

/** Whether the reservation is a test one. False when it does not exist. */
export async function isTestReservation(
  executor: Pick<Database, "select"> | Transaction,
  reservationId: string,
): Promise<boolean> {
  const [row] = await executor
    .select({ isTest: reservations.isTest })
    .from(reservations)
    .where(eq(reservations.id, reservationId))
    .limit(1);
  return row?.isTest === true;
}

/** The store's test reservation, if it has one. */
export async function findStoreTestReservation(
  executor: Pick<Database, "select"> | Transaction,
  storeId: string,
): Promise<{
  id: string;
  status: (typeof reservations.$inferSelect)["status"];
  createdAt: Date;
} | null> {
  const [row] = await executor
    .select({ id: reservations.id, status: reservations.status, createdAt: reservations.createdAt })
    .from(reservations)
    .where(and(eq(reservations.storeId, storeId), eq(reservations.isTest, true)))
    .limit(1);
  return row ?? null;
}

/** Thrown by a write that must never run on a test reservation (a provider call, an invoice). */
export class TestReservationRefusedError extends Error {
  readonly code = "TEST_RESERVATION_REFUSED";
  constructor(readonly action: string) {
    super(`Refused on a test reservation: ${action}`);
    this.name = "TestReservationRefusedError";
  }
}

/** Throws `TestReservationRefusedError` when the reservation is a test one. */
export async function refuseOnTestReservation(
  executor: Pick<Database, "select"> | Transaction,
  reservationId: string,
  action: string,
): Promise<void> {
  if (await isTestReservation(executor, reservationId)) {
    throw new TestReservationRefusedError(action);
  }
}

/** How long a test reservation lives before the daily cleanup deletes it. */
export const TEST_RESERVATION_LIFETIME_DAYS = 7;
