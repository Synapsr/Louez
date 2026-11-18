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
  .handler(({ context }) => getTestReservationState(context.store, context.ports.urls));

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
    return { deleted };
  });

export const dashboardTestReservationsRouter = {
  get,
  start,
  delete: remove,
};
