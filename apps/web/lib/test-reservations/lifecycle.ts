import "server-only";

import {
  purgeExpiredTestReservations,
  recordTestReservationEvent,
  testReservationAnalytics,
} from "@louez/api/services/test-reservations";
import { isTestReservation, db } from "@louez/db";

import { dispatchApiEffects } from "@/lib/api/effects";
import { auth } from "@/lib/auth";

/**
 * The app's side of a test reservation's life (packages/api
 * services/test-reservations.ts): the daily cleanup, and the event of an
 * inspection made on one, as the dashboard's inspection actions are still
 * server actions.
 */

/** The cron's daily cleanup of the test reservations past their lifetime. */
export async function runTestReservationsPurge() {
  const result = await purgeExpiredTestReservations();
  dispatchApiEffects(result.effectIds);
  return { deleted: result.deleted, failed: result.failed };
}

/**
 * `test_reservation_managed` for an inspection created or completed on a
 * test reservation, counted on the signed-in user; nothing for any other
 * reservation. Never throws.
 */
export async function captureTestInspection(params: {
  storeId: string;
  reservationId: string;
  type: "departure" | "return";
  step: "created" | "completed";
}) {
  try {
    if (!(await isTestReservation(db, params.reservationId))) return;
    const userId = (await auth())?.user?.id;
    if (!userId) return;
    const ids = await recordTestReservationEvent(
      testReservationAnalytics("test_reservation_managed", {
        storeId: params.storeId,
        distinctId: userId,
        properties: { action: `inspection_${params.type}_${params.step}` },
      }),
    );
    dispatchApiEffects(ids);
  } catch (error) {
    console.error("A test inspection's analytics event failed:", error);
  }
}
