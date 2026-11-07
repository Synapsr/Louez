import {
  closeDowntimeInput,
  closeDowntimeOutput,
  declareDowntimeInput,
  declareDowntimeOutput,
  deleteDowntimeOutput,
  downtimeIdInput,
  reinstateUnitInput,
  reinstateUnitOutput,
  retireUnitInput,
  retireUnitOutput,
  unitHistoryInput,
  unitHistoryOutput,
  updateDowntimeInput,
  updateDowntimeOutput,
  updateUnitDetailsInput,
  updateUnitDetailsOutput,
} from "../../contracts/product-units";
import { storeProcedure } from "../../platform/procedures";
import * as units from "../../services/product-units";
import type { UnitAvailabilityPreview } from "../../services/product-units";
import { confirmUnderLock, productActor } from "./product-context";

/**
 * A product's units and their downtimes, on every transport, as part of the
 * products router (`dashboard.products.*`). The logic is in
 * services/product-units.ts.
 */

const UNIT_HELP =
  "A unit is one tracked item of a product (products_get lists them in units[], with their id).";
const CONFIRM_HELP =
  "the first call answers CONFIRMATION_REQUIRED with a preview naming those reservations: show it to the user, and once they confirm, call again with the same arguments and the confirmationToken.";

/** What a confirmation of a unit leaving availability binds: the unit, and the bookings named. */
const availabilityConfirmation = (preview: UnitAvailabilityPreview) => ({
  state: {
    unitId: preview.unit.id,
    identifier: preview.unit.identifier,
    reservationItemIds: preview.conflicts.map((conflict) => conflict.reservationItemId).sort(),
  },
  details: {
    unit: preview.unit,
    product: preview.product,
    reservations: preview.conflicts.map((conflict) => ({
      id: conflict.reservationId,
      number: conflict.reservationNumber,
      customerName: conflict.customerName,
      startDate: conflict.startDate.toISOString(),
      endDate: conflict.endDate.toISOString(),
      replacementUnits: conflict.replacementCandidates.map((candidate) => candidate.identifier),
    })),
  },
});

export const getUnitHistory = storeProcedure
  .meta({
    capability: "products.getUnitHistory",
    scope: { domain: "products", level: "read" },
    mcp: {
      name: "products_get_unit_history",
      description: `The history of one unit: its events (created, changed, retired, reinstated, downtimes, assignments), newest first, with who did them, and its downtimes (current, upcoming, past). ${UNIT_HELP}`,
      bundle: "catalog",
      annotations: { readOnlyHint: true },
    },
  })
  .route({ method: "GET", path: "/products/units/{unitId}/history" })
  .input(unitHistoryInput)
  .output(unitHistoryOutput)
  .handler(({ context, input }) => units.getUnitHistory(context.actor.storeId, input.unitId));

export const declareDowntime = storeProcedure
  .meta({
    capability: "products.declareDowntime",
    scope: { domain: "products", level: "write" },
    sensitive: "destructive",
    mcp: {
      name: "products_declare_downtime",
      description: `Take a unit out of service for maintenance, a repair or another reason, from startsAt until endsAt (or until closed with products_close_downtime). It cannot be booked then. ${UNIT_HELP} Reservations that already hold the unit then keep it and are returned in conflicts, with the units that could serve them instead; when there are any, ${CONFIRM_HELP} Returns the downtime's id.`,
      bundle: "catalog",
      annotations: { destructiveHint: true },
    },
  })
  .route({ method: "POST", path: "/products/units/{unitId}/downtimes" })
  .input(declareDowntimeInput)
  .output(declareDowntimeOutput)
  .handler(({ context, input, path }) =>
    units.declareDowntime(productActor(context), input, {
      confirm: confirmUnderLock(context, path, input, availabilityConfirmation),
    }),
  );

export const updateDowntime = storeProcedure
  .meta({
    capability: "products.updateDowntime",
    scope: { domain: "products", level: "write" },
    sensitive: "destructive",
    mcp: {
      name: "products_update_downtime",
      description: `Change a downtime's reason, dates or note. Send only the fields to change; endsAt null makes it last until closed. Reservations that hold the unit over the new dates are returned in conflicts; when there are any, ${CONFIRM_HELP}`,
      bundle: "catalog",
      annotations: { destructiveHint: true, idempotentHint: true },
    },
  })
  .route({ method: "PATCH", path: "/products/downtimes/{downtimeId}" })
  .input(updateDowntimeInput)
  .output(updateDowntimeOutput)
  .handler(({ context, input, path }) =>
    units.updateDowntime(productActor(context), input, {
      confirm: confirmUnderLock(context, path, input, availabilityConfirmation),
    }),
  );

export const closeDowntime = storeProcedure
  .meta({
    capability: "products.closeDowntime",
    scope: { domain: "products", level: "write" },
    mcp: {
      name: "products_close_downtime",
      description:
        "End a downtime: the unit is back in service from endsAt, now by default. Returns when it ends.",
      bundle: "catalog",
    },
  })
  .route({ method: "POST", path: "/products/downtimes/{downtimeId}/close" })
  .input(closeDowntimeInput)
  .output(closeDowntimeOutput)
  .handler(({ context, input }) => units.closeDowntime(productActor(context), input));

export const deleteDowntime = storeProcedure
  .meta({
    capability: "products.deleteDowntime",
    scope: { domain: "products", level: "write", role: "delete" },
    sensitive: "destructive",
    mcp: {
      name: "products_delete_downtime",
      description:
        "Delete a downtime entered by mistake, as if it never was: the unit is available on its days again (the unit's history keeps a record). To end one that is over, use products_close_downtime instead. The first call answers CONFIRMATION_REQUIRED with a preview: show it to the user, and once they confirm, call again with the same arguments and the confirmationToken.",
      bundle: "catalog",
      annotations: { destructiveHint: true },
    },
  })
  .route({ method: "DELETE", path: "/products/downtimes/{downtimeId}" })
  .input(downtimeIdInput)
  .output(deleteDowntimeOutput)
  .handler(({ context, input, path }) =>
    units.deleteDowntime(productActor(context), input.downtimeId, {
      confirm: confirmUnderLock(context, path, input, (preview) => ({
        state: {
          ...preview.downtime,
          startsAt: preview.downtime.startsAt.toISOString(),
          endsAt: preview.downtime.endsAt?.toISOString() ?? null,
          unitId: preview.unit.id,
        },
        details: {
          unit: preview.unit,
          product: preview.product,
          downtime: {
            id: preview.downtime.id,
            reason: preview.downtime.reason,
            startsAt: preview.downtime.startsAt.toISOString(),
            endsAt: preview.downtime.endsAt?.toISOString() ?? null,
          },
        },
      })),
    }),
  );

export const retireUnit = storeProcedure
  .meta({
    capability: "products.retireUnit",
    scope: { domain: "products", level: "write" },
    sensitive: "destructive",
    mcp: {
      name: "products_retire_unit",
      description: `Retire a unit for good (sold, lost, broken or other): it leaves the stock from now on and can no longer be booked; products_reinstate_unit undoes it. ${UNIT_HELP} Current and future reservations that hold it keep it and are returned in conflicts, with the units that could serve them instead. The first call answers CONFIRMATION_REQUIRED with a preview naming those reservations: show it to the user, and once they confirm, call again with the same arguments and the confirmationToken.`,
      bundle: "catalog",
      annotations: { destructiveHint: true },
    },
  })
  .route({ method: "POST", path: "/products/units/{unitId}/retire" })
  .input(retireUnitInput)
  .output(retireUnitOutput)
  .handler(({ context, input, path }) =>
    units.retireUnit(productActor(context), input, {
      confirm: confirmUnderLock(context, path, input, availabilityConfirmation),
    }),
  );

export const reinstateUnit = storeProcedure
  .meta({
    capability: "products.reinstateUnit",
    scope: { domain: "products", level: "write" },
    mcp: {
      name: "products_reinstate_unit",
      description: "Put a retired unit back in service: it can be booked again.",
      bundle: "catalog",
    },
  })
  .route({ method: "POST", path: "/products/units/{unitId}/reinstate" })
  .input(reinstateUnitInput)
  .output(reinstateUnitOutput)
  .handler(({ context, input }) => units.reinstateUnit(productActor(context), input.unitId));

export const updateUnitDetails = storeProcedure
  .meta({
    capability: "products.updateUnitDetails",
    scope: { domain: "products", level: "write" },
    mcp: {
      name: "products_update_unit_details",
      description: `Change a unit's notes, purchase price or purchase date. Send only the fields to change; null clears one. To rename a unit or change its variant values, use products_update. ${UNIT_HELP} Returns the unit's details.`,
      bundle: "catalog",
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "PATCH", path: "/products/units/{unitId}" })
  .input(updateUnitDetailsInput)
  .output(updateUnitDetailsOutput)
  .handler(({ context, input }) => units.updateUnitDetails(productActor(context), input));
