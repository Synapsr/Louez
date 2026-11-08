import {
  cancelReservationInput,
  getPlanningTimelineOutput,
  getReservationInput,
  globalSearchInput,
  globalSearchOutput,
  listCalendarPeriodOutput,
  listOverdueInput,
  listOverdueOutput,
  listReservationsInput,
  listReservationsOutput,
  listUpcomingInput,
  listUpcomingOutput,
  pollReservationsInput,
  pollReservationsOutput,
  reservationSchema,
  reservationWindowInput,
  statusChangeOutput,
  updateReservationNotesInput,
  updateReservationNotesOutput,
  updateReservationStatusInput,
} from "../../contracts/reservations";
import { storeProcedure } from "../../platform/procedures";
import {
  changeStoreReservationStatus,
  type StatusChangeCaller,
  type StatusChangePreview,
} from "../../services/reservation-status";
import {
  getPlanningTimeline,
  getReservation,
  globalSearch,
  listCalendarPeriod,
  listOverdue,
  listReservations,
  listUpcoming,
  pollReservations,
  updateReservationNotes,
  type ReservationReader,
} from "../../services/reservations";
import { confirmUnderLock, mayRead, type ProductContext } from "./product-context";

/**
 * Reservation follow-up, on every transport: the dashboard (RPC),
 * `/api/v1/reservations` (OpenAPI) and the `reservations_*` MCP tools. The
 * logic is in services/reservations.ts and services/reservation-status.ts;
 * this file holds the contract, the rights and the confirmations.
 *
 * A caller that may read reservations but not customers gets every answer
 * without the customer's data (contracts/reservations.ts).
 */

const reader = (context: ProductContext): ReservationReader => ({
  storeId: context.actor.storeId,
  currency: context.store.settings?.currency ?? "EUR",
  customers: mayRead(context, "customers"),
});

const statusCaller = (context: ProductContext): StatusChangeCaller => ({
  storeId: context.actor.storeId,
  userId: context.actor.credential.userId,
  transport: context.actor.transport,
  customers: mayRead(context, "customers"),
  store: {
    id: context.store.id,
    name: context.store.name,
    slug: context.store.slug,
    ownerUserId: context.store.userId,
    settings: context.store.settings ?? null,
    customerNotificationSettings: context.store.customerNotificationSettings ?? null,
  },
  ports: context.ports,
});

/**
 * The confirmation of a status change, bound to what its preview shows: the
 * status it starts from, the dates, the amounts, the messages and the money.
 * A change since (the reservation moved, a payment recorded, a setting that
 * stops a message) voids the token.
 */
const statusConfirmation = (context: ProductContext, path: readonly string[], input: unknown) =>
  confirmUnderLock(context, path, input, (preview: StatusChangePreview) => {
    const { summary: _summary, ...details } = preview;
    return { state: details, details };
  });

const CUSTOMER_NOTE =
  "Without read access to customers, the customer's name, email, addresses and notes are left out.";

// --- Reads -------------------------------------------------------------------

const list = storeProcedure
  .meta({
    capability: "reservations.list",
    scope: { domain: "reservations", level: "read" },
    mcp: {
      name: "reservations_list",
      description: `List the store's reservations as the dashboard does: by status (default: every open one), by period (today, this week, this month, on the start or the end date), by payment method, or by part of the number or the customer's name. Sorted by start date (newest first) unless sort says otherwise. Returns up to \`limit\` reservations (default 25, at most 100), the counts per status, the total that match and a nextCursor; nextCursor is null on the last page. Use reservations_get for one reservation's lines, payments and history. ${CUSTOMER_NOTE}`,
      bundle: "daily",
      aliases: [{ name: "list_reservations", renamedArgs: { pageSize: "limit" } }],
      annotations: { readOnlyHint: true },
    },
  })
  .route({ method: "GET", path: "/reservations" })
  .input(listReservationsInput)
  .output(listReservationsOutput)
  .handler(({ context, input }) => listReservations(reader(context), input));

const get = storeProcedure
  .meta({
    capability: "reservations.get",
    scope: { domain: "reservations", level: "read" },
    mcp: {
      name: "reservations_get",
      description: `Get one reservation with everything its dashboard page shows: status and dates, customer, lines with their products and assigned units, amounts and taxes, payments, deposit, delivery or pickup, insurance, notes, documents and history (newest first). ${CUSTOMER_NOTE}`,
      bundle: "daily",
      aliases: [{ name: "get_reservation", renamedArgs: { reservationId: "id" } }],
      annotations: { readOnlyHint: true },
    },
  })
  .route({ method: "GET", path: "/reservations/{id}" })
  .input(getReservationInput)
  .output(reservationSchema)
  .handler(({ context, input }) => getReservation(reader(context), input.id));

const poll = storeProcedure
  .meta({
    capability: "reservations.poll",
    scope: { domain: "reservations", level: "read" },
    mcp: {
      name: "reservations_poll",
      description:
        "Quick counters: requests waiting for an answer (with the five newest), reservations per status, and supplier invoices to handle. Cheap to call often.",
      bundle: "daily",
      aliases: [{ name: "get_reservation_poll" }],
      annotations: { readOnlyHint: true },
    },
  })
  .route({ method: "GET", path: "/reservations/counters" })
  .input(pollReservationsInput)
  .output(pollReservationsOutput)
  .handler(({ context }) => pollReservations(reader(context)));

const listCalendarPeriodProcedure = storeProcedure
  .meta({
    capability: "reservations.listCalendarPeriod",
    scope: { domain: "reservations", level: "read" },
    mcp: {
      name: "reservations_list_calendar_period",
      description: `The reservations that overlap a window (from, to: ISO 8601, at most 400 days apart), by start date, as the calendar shows them: status, dates, amounts, customer, lines and delivery legs. ${CUSTOMER_NOTE}`,
      bundle: "daily",
      annotations: { readOnlyHint: true },
    },
  })
  .route({ method: "GET", path: "/reservations/calendar" })
  .input(reservationWindowInput)
  .output(listCalendarPeriodOutput)
  .handler(({ context, input }) => listCalendarPeriod(reader(context), input));

const getPlanningTimelineProcedure = storeProcedure
  .meta({
    capability: "reservations.getPlanningTimeline",
    scope: { domain: "reservations", level: "read" },
    mcp: {
      name: "reservations_get_planning_timeline",
      description: `The planning of a window (from, to: ISO 8601, at most 400 days apart): one entry per reservation and product, with the quantity, the assigned units and the delivery legs. ${CUSTOMER_NOTE}`,
      bundle: "daily",
      annotations: { readOnlyHint: true },
    },
  })
  .route({ method: "GET", path: "/reservations/planning" })
  .input(reservationWindowInput)
  .output(getPlanningTimelineOutput)
  .handler(({ context, input }) => getPlanningTimeline(reader(context), input));

const listUpcomingProcedure = storeProcedure
  .meta({
    capability: "reservations.listUpcoming",
    scope: { domain: "reservations", level: "read" },
    mcp: {
      name: "reservations_list_upcoming",
      description: `What comes from the start of today over the next days (7 by default, 1 for today only, at most 90): confirmed reservations to hand over (pickups) and ongoing ones due back (returns), soonest first. ${CUSTOMER_NOTE}`,
      bundle: "daily",
      aliases: [{ name: "calendar_upcoming" }],
      annotations: { readOnlyHint: true },
    },
  })
  .route({ method: "GET", path: "/reservations/upcoming" })
  .input(listUpcomingInput)
  .output(listUpcomingOutput)
  .handler(({ context, input }) => listUpcoming(reader(context), input));

const listOverdueProcedure = storeProcedure
  .meta({
    capability: "reservations.listOverdue",
    scope: { domain: "reservations", level: "read" },
    mcp: {
      name: "reservations_list_overdue",
      description: `Late returns: ongoing reservations past their end date, the longest overdue first, with the days late. ${CUSTOMER_NOTE}`,
      bundle: "daily",
      aliases: [{ name: "calendar_overdue" }],
      annotations: { readOnlyHint: true },
    },
  })
  .route({ method: "GET", path: "/reservations/overdue" })
  .input(listOverdueInput)
  .output(listOverdueOutput)
  .handler(({ context, input }) => listOverdue(reader(context), input));

// --- Writes ------------------------------------------------------------------

const updateStatus = storeProcedure
  .meta({
    capability: "reservations.updateStatus",
    scope: { domain: "reservations", level: "write" },
    sensitive: "send",
    mcp: {
      name: "reservations_update_status",
      description:
        "Change a reservation's status as the dashboard does: confirm a request or a quote (its items leave the stock, the customer gets the acceptance message, the insurance contract is created), reject a request (the customer gets the rejection message, with rejectionReason), mark it picked up (ongoing) or returned (completed), or cancel it (as reservations_cancel). The store's notifications follow as set. Confirming, rejecting and cancelling first answer CONFIRMATION_REQUIRED with a preview of the messages and the stock: show it to the user, and once they confirm, call again with the same arguments and the confirmationToken. Returns the change and the warnings the dashboard shows (opening hours, notice, durations, insurance).",
      bundle: "daily",
      aliases: [{ name: "update_reservation_status", renamedArgs: { reservationId: "id" } }],
      annotations: { destructiveHint: true },
    },
  })
  .route({ method: "POST", path: "/reservations/{id}/status" })
  .input(updateReservationStatusInput)
  .output(statusChangeOutput)
  .handler(({ context, input, path }) =>
    changeStoreReservationStatus(
      statusCaller(context),
      { id: input.id, to: input.status, rejectionReason: input.rejectionReason },
      { confirm: statusConfirmation(context, path, input) },
    ),
  );

const cancel = storeProcedure
  .meta({
    capability: "reservations.cancel",
    scope: { domain: "reservations", level: "write" },
    sensitive: "destructive",
    mcp: {
      name: "reservations_cancel",
      description:
        "Cancel a reservation that is not over (pending, quote, confirmed or ongoing): its items go back to the stock, its insurance contract is cancelled and the store's notifications follow. Nothing is refunded or released by itself, and the customer gets no message. The first call answers CONFIRMATION_REQUIRED with a preview (the customer, the dates, what was paid): show it to the user, and once they confirm, call again with the same arguments and the confirmationToken.",
      bundle: "daily",
      annotations: { destructiveHint: true },
    },
  })
  .route({ method: "POST", path: "/reservations/{id}/cancel" })
  .input(cancelReservationInput)
  .output(statusChangeOutput)
  .handler(({ context, input, path }) =>
    changeStoreReservationStatus(
      statusCaller(context),
      { id: input.id, to: "cancelled" },
      { confirm: statusConfirmation(context, path, input) },
    ),
  );

const updateNotes = storeProcedure
  .meta({
    capability: "reservations.updateNotes",
    scope: { domain: "reservations", level: "write" },
    mcp: {
      name: "reservations_update_notes",
      description:
        "Replace a reservation's internal notes, which only the store's team sees. An empty string clears them. Returns the notes.",
      bundle: "daily",
      aliases: [{ name: "update_reservation_notes", renamedArgs: { reservationId: "id" } }],
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "PATCH", path: "/reservations/{id}/notes" })
  .input(updateReservationNotesInput)
  .output(updateReservationNotesOutput)
  .handler(({ context, input }) =>
    updateReservationNotes(
      {
        storeId: context.actor.storeId,
        store: statusCaller(context).store,
        transport: context.actor.transport,
        afterCommit: context.ports.afterCommit,
      },
      input,
    ),
  );

// --- Global search -----------------------------------------------------------

export const globalSearchProcedure = storeProcedure
  .meta({
    capability: "ui.globalSearch",
    scope: { domain: "reservations", level: "read" },
    mcp: {
      name: "search_global",
      description:
        "Search the store at once, as the dashboard's search bar does: up to 5 products by name, 5 reservations by number or customer name, and 5 customers by name, company, email, phone or a searchable custom field. Products need read access to products, customers to customers; a section the connection may not read comes back empty.",
      bundle: "daily",
      annotations: { readOnlyHint: true },
    },
  })
  .route({ method: "GET", path: "/search" })
  .input(globalSearchInput)
  .output(globalSearchOutput)
  .handler(({ context, input }) =>
    globalSearch({ ...reader(context), products: mayRead(context, "products") }, input.query),
  );

// The follow-up procedures of `dashboard.reservations` (routers/dashboard/reservations.ts).
export {
  cancel,
  get,
  getPlanningTimelineProcedure as getPlanningTimeline,
  list,
  listCalendarPeriodProcedure as listCalendarPeriod,
  listOverdueProcedure as listOverdue,
  listUpcomingProcedure as listUpcoming,
  poll,
  updateNotes,
  updateStatus,
};
