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
  type UnitConflictOutput,
} from "../../contracts/product-units";
import { ANSWER_PAGE_MCP_DEFAULT, answerPage } from "../../platform/answer-pages";
import { storeProcedure } from "../../platform/procedures";
import * as units from "../../services/product-units";
import type { UnitAvailabilityPreview } from "../../services/product-units";
import type { UnitConflict } from "../../services/unit-conflicts";
import {
  confirmUnderLock,
  mayRead,
  productActor,
  requireReservationsAndCustomers,
  type ProductContext,
} from "./product-context";

/**
 * A product's units and their downtimes, on every transport, as part of the
 * products router (`dashboard.products.*`). The logic is in
 * services/product-units.ts.
 */

const UNIT_HELP =
  "A unit is one tracked item of a product (products_get lists them in units[], with their id).";
const CONFIRM_HELP =
  "the first call answers CONFIRMATION_REQUIRED with a preview of those reservations.";
const BOOKING_ACCESS_HELP =
  "A booking's number and id are null without read access to reservations, and its customer's name without read access to customers; its dates are always given.";

interface BookingAccess {
  reservations: boolean;
  customers: boolean;
}

/** What the caller may see of the bookings that hold a unit: the member's role, cut down to the connection's scopes. */
const bookingAccess = (context: ProductContext): BookingAccess => ({
  reservations: mayRead(context, "reservations"),
  customers: mayRead(context, "reservations") && mayRead(context, "customers"),
});

/**
 * A booking as the caller may see it. Without reservations read, its dates
 * and line only (a confirmation still counts it); without customers read, no
 * name. Replacements come in a stable order.
 */
function visibleConflict(conflict: UnitConflict, access: BookingAccess): UnitConflictOutput {
  return {
    ...conflict,
    reservationId: access.reservations ? conflict.reservationId : null,
    reservationNumber: access.reservations ? conflict.reservationNumber : null,
    customerName: access.customers ? conflict.customerName : null,
    replacementCandidates: [...conflict.replacementCandidates].sort(
      (left, right) =>
        left.identifier.localeCompare(right.identifier) || left.id.localeCompare(right.id),
    ),
  };
}

/**
 * What the preview of a unit leaving availability shows, redacted to what
 * the caller may see. `confirmUnderLock` binds the token to these details
 * and the summary, so any of them that changes voids it: a booking moved, a
 * replacement taken or renamed, the product renamed. A retirement starts
 * now: its window is not shown, and so not bound.
 */
const availabilityConfirmation =
  (context: ProductContext, options: { showWindow: boolean }) =>
  (preview: UnitAvailabilityPreview) => {
    const access = bookingAccess(context);
    return {
      state: { unitId: preview.unit.id },
      details: {
        unit: preview.unit,
        product: preview.product,
        ...(options.showWindow
          ? {
              from: preview.window.start.toISOString(),
              until: preview.window.end?.toISOString() ?? null,
            }
          : {}),
        reservations: preview.conflicts.map((raw) => {
          const conflict = visibleConflict(raw, access);
          return {
            reservationItemId: conflict.reservationItemId,
            id: conflict.reservationId,
            number: conflict.reservationNumber,
            customerName: conflict.customerName,
            startDate: conflict.startDate.toISOString(),
            endDate: conflict.endDate.toISOString(),
            replacementUnits: conflict.replacementCandidates.map((candidate) => ({
              id: candidate.id,
              identifier: candidate.identifier,
            })),
          };
        }),
      },
    };
  };

/** The answer's bookings, redacted as the preview was. */
const withVisibleConflicts =
  (context: ProductContext) =>
  <T extends { conflicts: UnitConflict[] }>(
    result: T,
  ): Omit<T, "conflicts"> & { conflicts: UnitConflictOutput[] } => {
    const access = bookingAccess(context);
    return {
      ...result,
      conflicts: result.conflicts.map((conflict) => visibleConflict(conflict, access)),
    };
  };

export const getUnitHistory = storeProcedure
  .meta({
    capability: "products.getUnitHistory",
    scope: { domain: "products", level: "read" },
    mcp: {
      name: "products_get_unit_history",
      title: "Get Unit History",
      description: `The history of one unit: its events (created, changed, retired, reinstated, downtimes, assignments), newest first, with who did them, and its downtimes (current, upcoming, past). An agent gets ${ANSWER_PAGE_MCP_DEFAULT} events a page without a limit (the API, every one); nextCursor, when not null, reads on, and every page holds the downtimes. ${UNIT_HELP} It shows the reservations and customers the unit served: it needs read access to products, reservations and customers; without the last two it answers PERMISSION_DENIED.`,
      bundle: "catalog",
    },
  })
  .route({ method: "GET", path: "/products/units/{unitId}/history" })
  .input(unitHistoryInput)
  .output(unitHistoryOutput)
  .handler(async ({ context, input }) => {
    requireReservationsAndCustomers(context);
    const history = await units.getUnitHistory(context.actor.storeId, input.unitId);
    // Newest first, as the history reads; its kind and id tell entries of one instant apart.
    const order = {
      key: (entry: (typeof history.timeline)[number]) =>
        `${entry.createdAt}\u0000${entry.kind}\u0000${entry.id}`,
      descending: true,
    };
    const page = answerPage(history.timeline, order, input, {
      transport: context.actor.transport,
      tool: "products_get_unit_history",
    });
    return { ...history, timeline: page.items, nextCursor: page.nextCursor };
  });

export const declareDowntime = storeProcedure
  .meta({
    capability: "products.declareDowntime",
    scope: { domain: "products", level: "write" },
    sensitive: "destructive",
    mcp: {
      name: "products_declare_downtime",
      title: "Declare Unit Downtime",
      description: `Take a unit out of service for maintenance, a repair or another reason, from startsAt until endsAt (or until closed with products_close_downtime). It cannot be booked then. ${UNIT_HELP} Reservations that already hold the unit then keep it and are returned in conflicts, with the units that could serve them instead; when there are any, ${CONFIRM_HELP} ${BOOKING_ACCESS_HELP} Returns the downtime's id.`,
      bundle: "catalog",
      effect: "additive",
      reach: "public",
    },
  })
  .route({ method: "POST", path: "/products/units/{unitId}/downtimes" })
  .input(declareDowntimeInput)
  .output(declareDowntimeOutput)
  .handler(({ context, input, path }) =>
    units
      .declareDowntime(productActor(context), input, {
        confirm: confirmUnderLock(
          context,
          path,
          input,
          availabilityConfirmation(context, { showWindow: true }),
        ),
      })
      .then(withVisibleConflicts(context)),
  );

export const updateDowntime = storeProcedure
  .meta({
    capability: "products.updateDowntime",
    scope: { domain: "products", level: "write" },
    sensitive: "destructive",
    mcp: {
      name: "products_update_downtime",
      title: "Update Unit Downtime",
      description: `Change a downtime's reason, dates or note. Send only the fields to change; endsAt null makes it last until closed. Reservations that hold the unit over the new dates are returned in conflicts; when there are any, ${CONFIRM_HELP} ${BOOKING_ACCESS_HELP}`,
      bundle: "catalog",
      effect: "overwrite",
      reach: "public",
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "PATCH", path: "/products/downtimes/{downtimeId}" })
  .input(updateDowntimeInput)
  .output(updateDowntimeOutput)
  .handler(({ context, input, path }) =>
    units
      .updateDowntime(productActor(context), input, {
        confirm: confirmUnderLock(
          context,
          path,
          input,
          availabilityConfirmation(context, { showWindow: true }),
        ),
      })
      .then(withVisibleConflicts(context)),
  );

export const closeDowntime = storeProcedure
  .meta({
    capability: "products.closeDowntime",
    scope: { domain: "products", level: "write" },
    mcp: {
      name: "products_close_downtime",
      title: "Close Unit Downtime",
      description:
        "End a downtime: the unit is back in service from endsAt, now by default. Returns when it ends.",
      bundle: "catalog",
      effect: "overwrite",
      reach: "public",
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
      title: "Delete Unit Downtime",
      description:
        "Delete a downtime entered by mistake, as if it never was: the unit is available on its days again (the unit's history keeps a record). Ending one that is over is products_close_downtime. The first call answers CONFIRMATION_REQUIRED with a preview.",
      bundle: "catalog",
      effect: "delete",
      reach: "public",
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
      title: "Retire Unit",
      description: `Retire a unit for good (sold, lost, broken or other): it leaves the stock from now on and can no longer be booked; products_reinstate_unit undoes it. ${UNIT_HELP} Current and future reservations that hold it keep it and are returned in conflicts, with the units that could serve them instead. The first call answers CONFIRMATION_REQUIRED with a preview of those reservations. ${BOOKING_ACCESS_HELP}`,
      bundle: "catalog",
      effect: "overwrite",
      reach: "public",
    },
  })
  .route({ method: "POST", path: "/products/units/{unitId}/retire" })
  .input(retireUnitInput)
  .output(retireUnitOutput)
  .handler(({ context, input, path }) =>
    units
      .retireUnit(productActor(context), input, {
        confirm: confirmUnderLock(
          context,
          path,
          input,
          availabilityConfirmation(context, { showWindow: false }),
        ),
      })
      .then(withVisibleConflicts(context)),
  );

export const reinstateUnit = storeProcedure
  .meta({
    capability: "products.reinstateUnit",
    scope: { domain: "products", level: "write" },
    mcp: {
      name: "products_reinstate_unit",
      title: "Reinstate Unit",
      description: "Put a retired unit back in service: it can be booked again.",
      bundle: "catalog",
      effect: "overwrite",
      reach: "public",
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
      title: "Update Unit Details",
      description: `Change a unit's notes, purchase price or purchase date. Send only the fields to change; null clears one. A unit's name and variant values change through products_update. ${UNIT_HELP} Returns the unit's details.`,
      bundle: "catalog",
      effect: "overwrite",
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "PATCH", path: "/products/units/{unitId}" })
  .input(updateUnitDetailsInput)
  .output(updateUnitDetailsOutput)
  .handler(({ context, input }) => units.updateUnitDetails(productActor(context), input));
