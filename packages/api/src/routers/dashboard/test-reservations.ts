import { findStoreTestReservation, db } from "@louez/db";

import {
  deleteTestReservationInput,
  deleteTestReservationOutput,
  getTestReservationInput,
  getTestReservationOutput,
  startTestReservationInput,
  startTestReservationOutput,
} from "../../contracts/test-reservations";
import type { ApiPorts } from "../../platform/ports";
import { storeProcedure } from "../../platform/procedures";
import { sanitizeError } from "../../platform/sanitize-error";
import { dismissNotice } from "../../services/dismissed-notices";
import {
  deleteTestReservation,
  getTestReservationState,
  startTestReservation,
} from "../../services/test-reservations";

/** Sends the outbox rows once committed; they stay for the cron if this fails. */
function dispatch(ports: ApiPorts, effectIds: string[]) {
  try {
    ports.dispatchEffects(effectIds);
  } catch (error) {
    console.error("Dispatching a test reservation's effects failed:", error);
  }
}

/**
 * Deleting the test's data ends the test for this user: the home's test card
 * is closed, so it does not come back offering a new one. The deletion is
 * done already; a failed close is logged, never thrown.
 */
async function closeHomeCard(ports: ApiPorts, userId: string, storeId: string) {
  try {
    await dismissNotice({ userId, noticeId: "test-reservation" });
  } catch (error) {
    const event = {
      event: "test_reservation.home_card_close_failed",
      storeId,
      error: sanitizeError(error),
    };
    if (ports.log) ports.log.error(event);
    else console.error(JSON.stringify(event));
  }
}

/**
 * The store's test reservation (services/test-reservations.ts): the guide's
 * state, the pass that opens the storefront in test mode, and its deletion.
 * The dashboard's onboarding only: a person in a dashboard session, never a
 * key, an OAuth or MCP connection or the in-app assistant (`actors`, which
 * `callerRefusal` also closes to the assistant), and never exposed.
 */
const testReservations = storeProcedure.meta({
  actors: ["session"],
  mcp: { exclude: "dashboard onboarding, human session only" },
});

const get = testReservations
  .meta({
    capability: "reservations.getTestReservation",
    scope: { domain: "reservations", level: "read" },
  })
  .input(getTestReservationInput)
  .output(getTestReservationOutput)
  .handler(({ context }) => getTestReservationState(context.store));

const start = testReservations
  .meta({
    capability: "reservations.startTestReservation",
    scope: { domain: "reservations", level: "write" },
  })
  .input(startTestReservationInput)
  .output(startTestReservationOutput)
  .handler(async ({ context }) => {
    const { result, effectIds } = await startTestReservation({
      store: context.store,
      userId: context.actor.credential.userId,
      urls: context.ports.urls,
    });
    dispatch(context.ports, effectIds);
    return result;
  });

const remove = testReservations
  .meta({
    capability: "reservations.deleteTestReservation",
    scope: { domain: "reservations", level: "write" },
  })
  .input(deleteTestReservationInput)
  .output(deleteTestReservationOutput)
  .handler(async ({ context, input }) => {
    const storeId = context.actor.storeId;
    const reservationId =
      input.reservationId ?? (await findStoreTestReservation(db, storeId))?.id ?? null;
    if (!reservationId) return { deleted: false };
    const { deleted, effectIds } = await deleteTestReservation({
      storeId,
      reservationId,
      analytics: { distinctId: context.actor.credential.userId, trigger: "manual" },
    });
    dispatch(context.ports, effectIds);
    if (deleted) await closeHomeCard(context.ports, context.actor.credential.userId, storeId);
    return { deleted };
  });

export const dashboardTestReservationsRouter = {
  get,
  start,
  delete: remove,
};
