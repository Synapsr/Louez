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
import { ANSWER_PAGE_MAX, ANSWER_PAGE_MCP_DEFAULT, answerPage } from "../../platform/answer-pages";
import type { Consequences } from "../../platform/approval-rule";
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

/** The REST reference's own texts (`.route({ description })`), for a developer. */
const REST_UNIT_ID = "A unit's id is in `GET /products/{id}/units`.";

const REST_DOWNTIME_ID = "A downtime's id is in `GET /products/units/{unitId}/history`.";

const REST_CONFIRM =
  "it asks for a confirmation first (412 `CONFIRMATION_REQUIRED`) on a key that asks for confirmations, with a preview of those reservations.";

const REST_CONFLICTS =
  "keep it, and come back in `conflicts`, each with the units that could serve it instead (`replacementCandidates`).";

const REST_EXCLUDE =
  "`excludeReservationItemIds` (100 at most) leaves out of `conflicts` the lines of reservations whose return inspection is done, the unit being back; any other line is refused with `DOWNTIME_EXCLUSION_INVALID`, and a confirmation still names every booking.";

const REST_BOOKING_ACCESS =
  "With a key that cannot read reservations, a booking's `reservationId` and `reservationNumber` are null; with one that cannot read customers, so is its `customerName`. Its dates are always given.";

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
  (context: ProductContext, options: { showWindow: boolean; consequences: Consequences }) =>
  (preview: UnitAvailabilityPreview) => {
    const access = bookingAccess(context);
    return {
      consequences: options.consequences,
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
      description: `The history of one unit: its events (created, changed, retired, reinstated, downtimes, assignments), newest first, with who did them, and its downtimes (current, upcoming, past). Without a limit, a page holds ${ANSWER_PAGE_MCP_DEFAULT} events over MCP and every one over the REST API; nextCursor, when not null, reads on, and every page holds the downtimes. ${UNIT_HELP} It shows the reservations and customers the unit served: it needs read access to products, reservations and customers; without the last two it answers PERMISSION_DENIED.`,
      bundle: "catalog",
    },
  })
  .route({
    method: "GET",
    path: "/products/units/{unitId}/history",
    description: `Returns a unit's history. \`timeline\` holds, newest first, its events (created, changed, retired, reinstated, downtimes declared, changed, closed or deleted) with who did them, and the reservations it was assigned to, with their number, customer and dates. \`downtimes\` holds its downtimes, current first, then upcoming, then past. Without \`limit\`, the timeline comes whole; with one (${ANSWER_PAGE_MAX} at most), pass \`nextCursor\` back as \`cursor\` to read on, and every page holds the downtimes. As it shows the reservations and customers the unit served, it needs a key that can read reservations and customers, else \`PERMISSION_DENIED\`. ${REST_UNIT_ID}`,
  })
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
  .route({
    method: "POST",
    path: "/products/units/{unitId}/downtimes",
    description: `Takes a unit out of service for a \`reason\` (\`maintenance\`, \`repair\` or \`other\`) from \`startsAt\` until \`endsAt\`, ISO 8601 dates; without \`endsAt\`, or with null, until \`POST /products/downtimes/{downtimeId}/close\` ends it. The unit cannot be booked then. \`endsAt\` must come after \`startsAt\` (\`DOWNTIME_DATES_INVALID\`); \`note\` holds up to 2,000 characters. Reservations that already hold the unit then ${REST_CONFLICTS} When there are any, ${REST_CONFIRM} ${REST_EXCLUDE} ${REST_BOOKING_ACCESS} Returns the downtime's id and the conflicts. ${REST_UNIT_ID}`,
  })
  .input(declareDowntimeInput)
  .output(declareDowntimeOutput)
  .handler(({ context, input, path }) =>
    units
      .declareDowntime(productActor(context), input, {
        confirm: confirmUnderLock(
          context,
          path,
          input,
          // A downtime can be closed or deleted.
          availabilityConfirmation(context, { showWindow: true, consequences: ["change"] }),
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
  .route({
    method: "PATCH",
    path: "/products/downtimes/{downtimeId}",
    description: `Changes a downtime's \`reason\`, \`startsAt\`, \`endsAt\` or \`note\`. Send only the fields to change; \`endsAt: null\` makes it last until closed, \`note: null\` clears the note. The end must still come after the start (\`DOWNTIME_DATES_INVALID\`). Reservations that hold the unit over the new dates ${REST_CONFLICTS} When there are any, ${REST_CONFIRM} ${REST_EXCLUDE} ${REST_BOOKING_ACCESS} Returns the downtime's id and the conflicts. ${REST_DOWNTIME_ID}`,
  })
  .input(updateDowntimeInput)
  .output(updateDowntimeOutput)
  .handler(({ context, input, path }) =>
    units
      .updateDowntime(productActor(context), input, {
        confirm: confirmUnderLock(
          context,
          path,
          input,
          availabilityConfirmation(context, { showWindow: true, consequences: ["change"] }),
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
  .route({
    method: "POST",
    path: "/products/downtimes/{downtimeId}/close",
    description: `Ends a downtime: the unit is back in service from \`endsAt\`, now by default. \`endsAt\` must come after the downtime's start (\`DOWNTIME_DATES_INVALID\`) and not after its current end: closing only ends a downtime earlier, and a later end answers \`DOWNTIME_CLOSE_EXTENDS\` (\`PATCH /products/downtimes/{downtimeId}\` moves it, and checks the bookings it would overlap). Returns the downtime's id and when it ends. ${REST_DOWNTIME_ID}`,
  })
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
  .route({
    method: "DELETE",
    path: "/products/downtimes/{downtimeId}",
    description: `Deletes a downtime entered by mistake, as if it never was: the unit is available on its days again, and the unit's history keeps a record of it. To end a downtime, use \`POST /products/downtimes/{downtimeId}/close\`. It asks for a confirmation first (412 \`CONFIRMATION_REQUIRED\`) on a key that asks for confirmations, with a preview of the unit, its product and the downtime. Returns the downtime's id. ${REST_DOWNTIME_ID}`,
  })
  .input(downtimeIdInput)
  .output(deleteDowntimeOutput)
  .handler(({ context, input, path }) =>
    units.deleteDowntime(productActor(context), input.downtimeId, {
      confirm: confirmUnderLock(context, path, input, (preview) => ({
        // The unit's history keeps a record of it.
        consequences: ["change"],
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
  .route({
    method: "POST",
    path: "/products/units/{unitId}/retire",
    description: `Retires a unit for good, with a \`reason\` (\`sold\`, \`lost\`, \`broken\` or \`other\`) and an optional \`note\`: it leaves the stock from now on and can no longer be booked. \`POST /products/units/{unitId}/reinstate\` undoes it. Refused with \`UNIT_ALREADY_RETIRED\` for a retired unit. Current and future reservations that hold it ${REST_CONFLICTS} Even when there are none, ${REST_CONFIRM} ${REST_BOOKING_ACCESS} Returns the unit's id and the conflicts. ${REST_UNIT_ID}`,
  })
  .input(retireUnitInput)
  .output(retireUnitOutput)
  .handler(({ context, input, path }) =>
    units
      .retireUnit(productActor(context), input, {
        confirm: confirmUnderLock(
          context,
          path,
          input,
          // products_reinstate_unit undoes it.
          availabilityConfirmation(context, { showWindow: false, consequences: ["change"] }),
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
  .route({
    method: "POST",
    path: "/products/units/{unitId}/reinstate",
    description:
      "Puts a retired unit back in service: it can be booked again. Refused with `UNIT_NOT_RETIRED` for a unit in service. Returns the unit's id.",
  })
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
  .route({
    method: "PATCH",
    path: "/products/units/{unitId}",
    description: `Changes a unit's \`notes\` (up to 1,000 characters), \`purchasePrice\` (a decimal string with at most 2 decimals, e.g. \`"450.00"\`) or \`purchasedAt\`. Send only the fields to change; null clears one. A unit's name and variant values change through \`PATCH /products/{id}\`. Returns the unit's notes and purchase details. ${REST_UNIT_ID}`,
  })
  .input(updateUnitDetailsInput)
  .output(updateUnitDetailsOutput)
  .handler(({ context, input }) => units.updateUnitDetails(productActor(context), input));
