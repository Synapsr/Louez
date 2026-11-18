import { db, isTestReservation, payments, reservations } from "@louez/db";
import { and, eq } from "drizzle-orm";

import type { AccountActor } from "./actor";

/**
 * Test reservations (and their test customers) are seen only by a person in
 * the dashboard: a session that is not the in-app assistant. A key, an OAuth
 * or MCP connection and the assistant never see one: reads leave them out,
 * and a call that names one answers the "not found" it answers for an id the
 * store does not have (`@louez/db` `test-reservations.ts`).
 */
export function canSeeTestReservations(actor: Pick<AccountActor, "credential">): boolean {
  return actor.credential.kind === "session" && actor.credential.assistant !== true;
}

/** The reservation is a test one the actor may not see: the caller answers "not found". */
export async function hidesTestReservation(
  actor: Pick<AccountActor, "credential">,
  reservationId: string,
): Promise<boolean> {
  if (canSeeTestReservations(actor)) return false;
  return isTestReservation(db, reservationId);
}

/** The payment belongs to a test reservation the actor may not see: the caller answers "not found". */
export async function hidesTestPayment(
  actor: Pick<AccountActor, "credential">,
  paymentId: string,
): Promise<boolean> {
  if (canSeeTestReservations(actor)) return false;
  const [row] = await db
    .select({ id: payments.id })
    .from(payments)
    .innerJoin(reservations, eq(reservations.id, payments.reservationId))
    .where(and(eq(payments.id, paymentId), eq(reservations.isTest, true)))
    .limit(1);
  return row !== undefined;
}
