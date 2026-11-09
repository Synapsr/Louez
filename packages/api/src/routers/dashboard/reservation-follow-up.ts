import {
  RESERVATION_AGENT_OFFSET_MAX,
  RESERVATION_PAGE_DEFAULT,
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
  reservationErrors,
  reservationOutput,
  reservationWindowInput,
  statusChangeOutput,
  updateReservationNotesInput,
  updateReservationNotesOutput,
  updateReservationStatusInput,
} from "../../contracts/reservations";
import { customerLinks, productLinks, reservationLinks } from "../../platform/links";
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
  payments: mayRead(context, "payments"),
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
  },
  ports: context.ports,
});

/**
 * The confirmation of a status change, bound to what its preview shows (the
 * status it starts from, the dates, the amounts, the messages and the money)
 * and to where the messages go. A change since (the reservation moved, a
 * payment recorded, a setting that stops a message, the customer's email or
 * phone) voids the token.
 */
const statusConfirmation = (context: ProductContext, path: readonly string[], input: unknown) =>
  confirmUnderLock(context, path, input, (preview: StatusChangePreview) => {
    const { summary: _summary, recipientsHash, ...details } = preview;
    // The recipients are bound even where the preview may not show them.
    return { state: { ...details, recipientsHash }, details };
  });

/**
 * The links an answer's records get: each reservation its dashboard page,
 * each customer shown its own. A customer is shown only to a caller who may
 * read customers (null otherwise), so its link follows the same rule.
 */
const linker = (context: ProductContext) => {
  const { urls } = context.ports;
  const { store } = context;
  return {
    reservation: <T extends { id: string }>(record: T) => ({
      ...record,
      links: reservationLinks(urls, store, record),
    }),
    customer: <T extends { id: string }>(customer: T | null) =>
      customer && { ...customer, links: customerLinks(urls, store, customer) },
    product: <T extends { id: string }>(product: T) => ({
      ...product,
      links: productLinks(urls, store, product),
    }),
  };
};

/** A reservation with its links, and its customer's when it is shown. */
const withLinks = <T extends { id: string; customer: { id: string } | null }>(
  link: ReturnType<typeof linker>,
  record: T,
) => ({ ...link.reservation(record), customer: link.customer(record.customer) });

const LINKS_NOTE =
  "Each reservation has `links` (its dashboard page) and each customer shown its own, the URLs to give the user.";

const CUSTOMER_NOTE =
  "Without read access to customers, the customer's name, email, addresses and notes are left out; without read access to payments, so are payment rows and Stripe ids (rentalPaid stays).";

// --- Reads -------------------------------------------------------------------

const list = storeProcedure
  .meta({
    capability: "reservations.list",
    scope: { domain: "reservations", level: "read" },
    mcp: {
      name: "reservations_list",
      title: "List Reservations",
      description: `List the store's reservations as the dashboard does: by status (default: every open one), by period (today, this week, this month, on the start or the end date), by payment method (needs read access to payments), or by part of the number or the customer's name. Sorted by start date (newest first) unless sort says otherwise. Returns up to \`limit\` reservations (default 25, at most 100), the counts per status, the total that match and a nextCursor: passed back as cursor, with the same filters and sort, it gives the next page; it is null on the last page. Page numbers stop at the first 10,000 reservations. One reservation's lines, payments and history are in reservations_get. ${LINKS_NOTE} ${CUSTOMER_NOTE}`,
      bundle: "daily",
      aliases: [{ name: "list_reservations", renamedArgs: { pageSize: "limit" } }],
    },
  })
  .route({ method: "GET", path: "/reservations" })
  .input(listReservationsInput)
  .output(listReservationsOutput)
  .handler(async ({ context, input }) => {
    // The dashboard's numbered pages go as deep as the list; an agent follows the cursor.
    const offset = (input.page ?? 1) * (input.limit ?? RESERVATION_PAGE_DEFAULT);
    if (
      context.actor.credential.kind !== "session" &&
      !input.cursor &&
      offset > RESERVATION_AGENT_OFFSET_MAX
    ) {
      throw reservationErrors.pageTooDeep();
    }
    const link = linker(context);
    const page = await listReservations(reader(context), input);
    return { ...page, items: page.items.map((item) => withLinks(link, item)) };
  });

const get = storeProcedure
  .meta({
    capability: "reservations.get",
    scope: { domain: "reservations", level: "read" },
    mcp: {
      name: "reservations_get",
      title: "Get Reservation",
      description: `Get one reservation with everything its dashboard page shows: status and dates, customer, lines with their products and assigned units, amounts and taxes, payments, deposit, delivery or pickup, insurance, notes, documents and history (newest first). ${LINKS_NOTE} ${CUSTOMER_NOTE}`,
      bundle: "daily",
      aliases: [{ name: "get_reservation", renamedArgs: { reservationId: "id" } }],
    },
  })
  .route({ method: "GET", path: "/reservations/{id}" })
  .input(getReservationInput)
  .output(reservationOutput)
  .handler(async ({ context, input }) =>
    withLinks(linker(context), await getReservation(reader(context), input.id)),
  );

const poll = storeProcedure
  .meta({
    capability: "reservations.poll",
    scope: { domain: "reservations", level: "read" },
    mcp: {
      name: "reservations_poll",
      title: "Poll Reservation Changes",
      description:
        "Quick counters: requests waiting for an answer (with the five newest, each with `links`, its dashboard page to give the user), reservations per status, and supplier invoices to handle. Cheap to call often.",
      bundle: "daily",
      aliases: [{ name: "get_reservation_poll" }],
    },
  })
  .route({ method: "GET", path: "/reservations/counters" })
  .input(pollReservationsInput)
  .output(pollReservationsOutput)
  .handler(async ({ context }) => {
    const link = linker(context);
    const poll = await pollReservations(reader(context));
    return {
      ...poll,
      pendingReservations: poll.pendingReservations.map(link.reservation),
      latestReservation: poll.latestReservation && link.reservation(poll.latestReservation),
    };
  });

const listCalendarPeriodProcedure = storeProcedure
  .meta({
    capability: "reservations.listCalendarPeriod",
    scope: { domain: "reservations", level: "read" },
    mcp: {
      name: "reservations_list_calendar_period",
      title: "List Calendar Period",
      description: `The reservations that overlap a window (from, to: ISO 8601, at most 400 days apart), by start date, as the calendar shows them: status, dates, amounts, customer, lines and delivery legs. ${LINKS_NOTE} ${CUSTOMER_NOTE}`,
      bundle: "daily",
    },
  })
  .route({ method: "GET", path: "/reservations/calendar" })
  .input(reservationWindowInput)
  .output(listCalendarPeriodOutput)
  .handler(async ({ context, input }) => {
    const link = linker(context);
    const period = await listCalendarPeriod(reader(context), input);
    return { ...period, items: period.items.map((item) => withLinks(link, item)) };
  });

const getPlanningTimelineProcedure = storeProcedure
  .meta({
    capability: "reservations.getPlanningTimeline",
    scope: { domain: "reservations", level: "read" },
    mcp: {
      name: "reservations_get_planning_timeline",
      title: "Get Planning Timeline",
      description: `The planning of a window (from, to: ISO 8601, at most 400 days apart): one entry per reservation and product, with the quantity, the assigned units and the delivery legs. Each entry has \`links\`, its reservation's dashboard page, to give the user. ${CUSTOMER_NOTE}`,
      bundle: "daily",
    },
  })
  .route({ method: "GET", path: "/reservations/planning" })
  .input(reservationWindowInput)
  .output(getPlanningTimelineOutput)
  .handler(async ({ context, input }) => {
    const link = linker(context);
    const planning = await getPlanningTimeline(reader(context), input);
    return { ...planning, items: planning.items.map(link.reservation) };
  });

const listUpcomingProcedure = storeProcedure
  .meta({
    capability: "reservations.listUpcoming",
    scope: { domain: "reservations", level: "read" },
    mcp: {
      name: "reservations_list_upcoming",
      title: "List Upcoming Pickups and Returns",
      description: `What comes from the start of today over the next days (7 by default, 1 for today only, at most 90): confirmed reservations to hand over (pickups) and ongoing ones due back (returns), soonest first. ${LINKS_NOTE} ${CUSTOMER_NOTE}`,
      bundle: "daily",
      aliases: [{ name: "calendar_upcoming" }],
    },
  })
  .route({ method: "GET", path: "/reservations/upcoming" })
  .input(listUpcomingInput)
  .output(listUpcomingOutput)
  .handler(async ({ context, input }) => {
    const link = linker(context);
    const agenda = await listUpcoming(reader(context), input);
    return {
      ...agenda,
      pickups: agenda.pickups.map((item) => withLinks(link, item)),
      returns: agenda.returns.map((item) => withLinks(link, item)),
    };
  });

const listOverdueProcedure = storeProcedure
  .meta({
    capability: "reservations.listOverdue",
    scope: { domain: "reservations", level: "read" },
    mcp: {
      name: "reservations_list_overdue",
      title: "List Overdue Reservations",
      description: `Late returns: ongoing reservations past their end date, the longest overdue first, with the days late. ${LINKS_NOTE} ${CUSTOMER_NOTE}`,
      bundle: "daily",
      aliases: [{ name: "calendar_overdue" }],
    },
  })
  .route({ method: "GET", path: "/reservations/overdue" })
  .input(listOverdueInput)
  .output(listOverdueOutput)
  .handler(async ({ context, input }) => {
    const link = linker(context);
    const overdue = await listOverdue(reader(context), input);
    return { ...overdue, items: overdue.items.map((item) => withLinks(link, item)) };
  });

// --- Writes ------------------------------------------------------------------

const updateStatus = storeProcedure
  .meta({
    capability: "reservations.updateStatus",
    scope: { domain: "reservations", level: "write" },
    sensitive: "send",
    mcp: {
      name: "reservations_update_status",
      title: "Change Reservation Status",
      description:
        "Change a reservation's status as the dashboard does: confirm a request or a quote (its items leave the stock, the customer gets the acceptance message, the insurance contract is created), reject a request (the customer gets the rejection message, with rejectionReason), mark it picked up (ongoing; refused with CONTRACT_UNSIGNED when the store requires the signed contract and the customer has not signed) or returned (completed), or cancel it (as reservations_cancel). The store's notifications follow as set. Confirming, rejecting and cancelling first answer CONFIRMATION_REQUIRED with a preview of the messages and the stock. Returns the change, the warnings the dashboard shows (opening hours, notice, durations, insurance) and the reservation's `links`, its dashboard page to give the user.",
      bundle: "daily",
      effect: "overwrite",
      reach: "customer",
      aliases: [{ name: "update_reservation_status", renamedArgs: { reservationId: "id" } }],
    },
  })
  .route({ method: "POST", path: "/reservations/{id}/status" })
  .input(updateReservationStatusInput)
  .output(statusChangeOutput)
  .handler(async ({ context, input, path }) =>
    linker(context).reservation(
      await changeStoreReservationStatus(
        statusCaller(context),
        { id: input.id, to: input.status, rejectionReason: input.rejectionReason },
        { confirm: statusConfirmation(context, path, input) },
      ),
    ),
  );

const cancel = storeProcedure
  .meta({
    capability: "reservations.cancel",
    scope: { domain: "reservations", level: "write" },
    sensitive: "destructive",
    mcp: {
      name: "reservations_cancel",
      title: "Cancel Reservation",
      description:
        "Cancel a reservation that is not over (pending, quote, confirmed or ongoing): its items go back to the stock, its insurance contract is cancelled and the store's notifications follow. Nothing is refunded or released by itself, and the customer gets no message. The first call answers CONFIRMATION_REQUIRED with a preview (the customer, the dates, what was paid). Returns the change and the reservation's `links`, its dashboard page to give the user.",
      bundle: "daily",
      effect: "overwrite",
      reach: "provider",
    },
  })
  .route({ method: "POST", path: "/reservations/{id}/cancel" })
  .input(cancelReservationInput)
  .output(statusChangeOutput)
  .handler(async ({ context, input, path }) =>
    linker(context).reservation(
      await changeStoreReservationStatus(
        statusCaller(context),
        { id: input.id, to: "cancelled" },
        { confirm: statusConfirmation(context, path, input) },
      ),
    ),
  );

const updateNotes = storeProcedure
  .meta({
    capability: "reservations.updateNotes",
    scope: { domain: "reservations", level: "write" },
    mcp: {
      name: "reservations_update_notes",
      title: "Update Reservation Notes",
      description:
        "Replace a reservation's internal notes, which only the store's team sees. An empty string clears them. Returns the notes and the reservation's `links`, its dashboard page to give the user.",
      bundle: "daily",
      effect: "overwrite",
      aliases: [{ name: "update_reservation_notes", renamedArgs: { reservationId: "id" } }],
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "PATCH", path: "/reservations/{id}/notes" })
  .input(updateReservationNotesInput)
  .output(updateReservationNotesOutput)
  .handler(async ({ context, input }) =>
    linker(context).reservation(
      await updateReservationNotes(
        {
          storeId: context.actor.storeId,
          store: statusCaller(context).store,
          transport: context.actor.transport,
          ports: context.ports,
        },
        input,
      ),
    ),
  );

// --- Global search -----------------------------------------------------------

export const globalSearchProcedure = storeProcedure
  .meta({
    capability: "ui.globalSearch",
    scope: { domain: "reservations", level: "read" },
    mcp: {
      name: "search_global",
      title: "Search Store",
      description:
        "Search the store at once, as the dashboard's search bar does: up to 5 products by name, 5 reservations by number or customer name, and 5 customers by name, company, email, phone or a searchable custom field. Products need read access to products, customers to customers; a section the connection may not read comes back empty. Each hit has `links`, its dashboard page to give the user.",
      bundle: "daily",
    },
  })
  .route({ method: "GET", path: "/search" })
  .input(globalSearchInput)
  .output(globalSearchOutput)
  .handler(async ({ context, input }) => {
    const link = linker(context);
    const hits = await globalSearch(
      { ...reader(context), products: mayRead(context, "products") },
      input.query,
    );
    return {
      products: hits.products.map(link.product),
      reservations: hits.reservations.map(link.reservation),
      customers: hits.customers.map((customer) => ({
        ...customer,
        links: customerLinks(context.ports.urls, context.store, customer),
      })),
    };
  });

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
