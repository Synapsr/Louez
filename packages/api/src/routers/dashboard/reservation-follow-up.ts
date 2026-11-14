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
  type CalendarEntry,
  type PlanningEntry,
} from "../../contracts/reservations";
import { ANSWER_PAGE_MCP_DEFAULT, answerPage } from "../../platform/answer-pages";
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
import type { Consequences } from "../../platform/approval-rule";
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
  credential: { kind: context.actor.credential.kind, id: context.actor.credential.id },
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
 * status it starts from, the dates, the amounts, the messages, the money and
 * the shortfalls booked over or confirmed past the turnover buffer, and that
 * buffer) and to where the messages go. A change since (the reservation
 * moved, a payment recorded, a setting that stops a message, the customer's
 * email or phone, a shortfall that grew or changed) voids the token. A
 * confirmation sent with either override is a stock override, even when
 * nothing is short (decision D2 and slice 5,
 * docs/domain/reservation-changes.md); a message to the customer is one too.
 */
const statusConfirmation = (context: ProductContext, path: readonly string[], input: unknown) =>
  confirmUnderLock(context, path, input, (preview: StatusChangePreview) => {
    const { summary: _summary, recipientsHash, ...details } = preview;
    // The recipients are bound even where the preview may not show them.
    return {
      state: { ...details, recipientsHash },
      details,
      consequences: statusChangeConsequences(preview),
    };
  });

/** What the status change the preview shows does, branch by branch. */
function statusChangeConsequences(preview: StatusChangePreview): Consequences {
  // A flag the change passes is set on the preview, even with nothing short.
  const overrides = preview.overbooking !== null || preview.turnoverBuffer !== null;
  const message = preview.messages.length > 0;
  if (overrides && message) return ["stock_override", "customer_message"];
  if (overrides) return ["stock_override"];
  if (message) return ["customer_message"];
  return ["change"];
}

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

/** The REST reference's own texts (`.route({ description })`), for a developer. */
const REST_LINKS_NOTE =
  "Each reservation, and its customer when shown, comes with `links.dashboard`: its page in the Louez dashboard.";

const REST_CUSTOMER_NOTE =
  "With a key that cannot read customers, the customer's name, email, addresses and notes are left out; with one that cannot read payments, so are the payment rows and Stripe ids (`rentalPaid` stays).";

const REST_WINDOW_NOTE =
  "`from` and `to` are ISO 8601 dates at most 400 days apart. Without `limit`, the answer holds the whole window; with one, pass `nextCursor` back as `cursor` to read on.";

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
    },
  })
  .route({
    method: "GET",
    path: "/reservations",
    description: `Lists the store's reservations, by start date, newest first. Filter by \`status\` (by default, every open one), \`period\` (today, this week or this month, on the start date or, with \`operation: return\`, the end date), \`paymentMethod\` (with a key that can read payments) or \`search\` (part of the number, or of the customer's name with a key that can read customers); \`sort\` and \`sortDirection\` change the order. Returns up to \`limit\` reservations (25 by default, 100 at most), the count per status and the total that match. To read on, pass \`nextCursor\` back as \`cursor\` with the same filters and sort; it is null on the last page. Numbered pages (\`page\`) stop at the first 10,000 reservations. A reservation's lines, payments and history are in \`GET /reservations/{id}\`. ${REST_LINKS_NOTE} ${REST_CUSTOMER_NOTE}`,
  })
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
    },
  })
  .route({
    method: "GET",
    path: "/reservations/{id}",
    description: `Returns one reservation with everything its dashboard page shows: status and dates, customer, lines with their products and assigned units, amounts and taxes, payments, deposit, delivery or pickup, insurance, notes, documents and history (newest first). ${REST_LINKS_NOTE} ${REST_CUSTOMER_NOTE}`,
  })
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
    },
  })
  .route({
    method: "GET",
    path: "/reservations/counters",
    description:
      "Counters cheap enough to poll: the requests waiting for an answer (with the five newest), the reservations per status, and the supplier invoices to handle. Each reservation listed comes with `links.dashboard`, its page in the Louez dashboard.",
  })
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

/** The windows' lists come a page at a time to an agent (`answerPage`). */
const WINDOW_PAGE_NOTE = `Without a limit, a page holds ${ANSWER_PAGE_MCP_DEFAULT} entries over MCP and every entry over the REST API; nextCursor, when not null, reads on.`;

const listCalendarPeriodProcedure = storeProcedure
  .meta({
    capability: "reservations.listCalendarPeriod",
    scope: { domain: "reservations", level: "read" },
    mcp: {
      name: "reservations_list_calendar_period",
      title: "List Calendar Period",
      description: `The reservations that overlap a window (from, to: ISO 8601, at most 400 days apart), by start date, as the calendar shows them: status, dates, amounts, customer, lines and delivery legs. ${WINDOW_PAGE_NOTE} ${LINKS_NOTE} ${CUSTOMER_NOTE}`,
      bundle: "daily",
    },
  })
  .route({
    method: "GET",
    path: "/reservations/calendar",
    description: `Lists the reservations that overlap a window, by start date, as the dashboard's calendar shows them: status, dates, amounts, customer, lines and delivery legs. ${REST_WINDOW_NOTE} ${REST_LINKS_NOTE} ${REST_CUSTOMER_NOTE}`,
  })
  .input(reservationWindowInput)
  .output(listCalendarPeriodOutput)
  .handler(async ({ context, input }) => {
    const link = linker(context);
    const period = await listCalendarPeriod(reader(context), { from: input.from, to: input.to });
    // By start date, then id: the calendar's order, total.
    const order = {
      key: (item: CalendarEntry) => `${item.startDate.toISOString()}\u0000${item.id}`,
    };
    const page = answerPage(period.items, order, input, {
      transport: context.actor.transport,
      tool: "reservations_list_calendar_period",
    });
    return {
      ...period,
      items: page.items.map((item) => withLinks(link, item)),
      nextCursor: page.nextCursor,
    };
  });

const getPlanningTimelineProcedure = storeProcedure
  .meta({
    capability: "reservations.getPlanningTimeline",
    scope: { domain: "reservations", level: "read" },
    mcp: {
      name: "reservations_get_planning_timeline",
      title: "Get Planning Timeline",
      description: `The planning of a window (from, to: ISO 8601, at most 400 days apart): one entry per reservation and product, with the quantity, the assigned units and the delivery legs. ${WINDOW_PAGE_NOTE} Each entry has \`links\`, its reservation's dashboard page, to give the user. ${CUSTOMER_NOTE}`,
      bundle: "daily",
    },
  })
  .route({
    method: "GET",
    path: "/reservations/planning",
    description: `Returns the planning of a window: one entry per reservation and product, with the quantity, the assigned units and the delivery legs. ${REST_WINDOW_NOTE} Each entry comes with \`links.dashboard\`, its reservation's page in the Louez dashboard. ${REST_CUSTOMER_NOTE}`,
  })
  .input(reservationWindowInput)
  .output(getPlanningTimelineOutput)
  .handler(async ({ context, input }) => {
    const link = linker(context);
    const planning = await getPlanningTimeline(reader(context), { from: input.from, to: input.to });
    // By start date, then the reservation and the product of the entry.
    const order = {
      key: (item: PlanningEntry) =>
        `${item.startDate.toISOString()}\u0000${item.id}\u0000${item.productId}`,
    };
    const page = answerPage(planning.items, order, input, {
      transport: context.actor.transport,
      tool: "reservations_get_planning_timeline",
    });
    return { ...planning, items: page.items.map(link.reservation), nextCursor: page.nextCursor };
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
    },
  })
  .route({
    method: "GET",
    path: "/reservations/upcoming",
    description: `Lists what is due from the start of today over the next \`days\` (7 by default, 1 for today only, 90 at most), soonest first: the confirmed reservations to hand over (\`pickups\`) and the ongoing ones due back (\`returns\`). ${REST_LINKS_NOTE} ${REST_CUSTOMER_NOTE}`,
  })
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
    },
  })
  .route({
    method: "GET",
    path: "/reservations/overdue",
    description: `Lists the late returns: ongoing reservations past their end date, the longest overdue first, with the number of days late. ${REST_LINKS_NOTE} ${REST_CUSTOMER_NOTE}`,
  })
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
        "Change a reservation's status as the dashboard does: confirm a request or a quote (its items leave the stock, the customer gets the acceptance message, the insurance contract is created), reject a request (the customer gets the rejection message, with rejectionReason), mark it picked up (ongoing; refused with CONTRACT_UNSIGNED when the store requires the signed contract and the customer has not signed) or returned (completed), or cancel it (as reservations_cancel: the customer gets the cancellation message). The customer's messages go out on the channels the store set for each, and the store's notifications follow as set. Confirming, rejecting and cancelling first answer CONFIRMATION_REQUIRED with a preview of the messages and the stock. A confirmation the stock cannot cover answers RESERVATION_INSUFFICIENT_CAPACITY with each line short (details.shortfalls: each short line by its reservationItemId, with its product, its combination or the attributes it chose, requested, available). The same input with allowOverbooking: true books over the stock, for when the user chose to: it always answers CONFIRMATION_REQUIRED first, even on a connection whose confirmations are off, with a preview listing every shortfall, and its token holds only while the shortfalls stay as previewed. The token proves the preview was seen, not that a person approved it. A confirmation refused with RESERVATION_TURNOVER_BUFFER_CONFLICT (lines that fit the stock but not the turnover buffer the store keeps between rentals, details.shortfalls counted with the buffer) is confirmed all the same with overrideTurnoverBuffer: true, for when the user chose a shorter turnaround: it asks the same way, its preview lists those lines and the buffer, and it covers this confirmation only. Neither flag passes the other's refusal: a reservation short both ways needs both, and one preview lists both. Neither passes RESERVATION_UNITS_UNAVAILABLE or a consumable out of stock. Returns the change, the warnings the dashboard shows (opening hours, notice, durations, insurance) and the reservation's `links`, its dashboard page to give the user.",
      bundle: "daily",
      effect: "overwrite",
      reach: "customer",
    },
  })
  .route({
    method: "POST",
    path: "/reservations/{id}/status",
    description: [
      "Changes a reservation's status, with the same effects as in the dashboard:",
      "",
      "- `confirmed` confirms a request or a quote: its items leave the stock and the customer gets the acceptance message. For a reservation with insurance, Louez then creates the insurance contract; a failure comes back in `warnings`, and the confirmation stands.",
      "- `rejected` rejects a request; the customer gets the rejection message, with `rejectionReason`.",
      "- `ongoing` marks it picked up. Refused with `CONTRACT_UNSIGNED` when the store requires a signed contract and the customer has not signed.",
      "- `completed` marks it returned.",
      "- `cancelled` cancels it, as `POST /reservations/{id}/cancel` does.",
      "",
      "The customer's messages go out on the channels the store set for each. On a key set to ask for confirmations (the default), confirming a request or a quote, rejecting and cancelling first answer 412 `CONFIRMATION_REQUIRED`, with a preview of the messages and the stock; on a key whose confirmations are off, they run at once.",
      "",
      "A confirmation the stock cannot cover answers `RESERVATION_INSUFFICIENT_CAPACITY`, with each short line in `details.shortfalls`. The same request with `allowOverbooking: true` confirms over the stock: it always answers 412 `CONFIRMATION_REQUIRED` first, even on a key whose confirmations are off, and its token holds only while the shortfalls stay as previewed. Lines that fit the stock but not the turnover buffer the store keeps between rentals answer `RESERVATION_TURNOVER_BUFFER_CONFLICT`; `overrideTurnoverBuffer: true` passes it the same way, for this confirmation only. Each flag passes only its own refusal, and neither passes `RESERVATION_UNITS_UNAVAILABLE` or a consumable out of stock.",
      "",
      "Returns the change, the warnings the dashboard shows (opening hours, notice, durations, insurance) and the reservation's `links.dashboard`.",
    ].join("\n"),
  })
  .input(updateReservationStatusInput)
  .output(statusChangeOutput)
  .handler(async ({ context, input, path }) =>
    linker(context).reservation(
      await changeStoreReservationStatus(
        statusCaller(context),
        {
          id: input.id,
          to: input.status,
          rejectionReason: input.rejectionReason,
          allowOverbooking: input.allowOverbooking,
          overrideTurnoverBuffer: input.overrideTurnoverBuffer,
        },
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
        "Cancel a reservation that is not over (pending, quote, confirmed or ongoing): its items go back to the stock, its insurance contract is cancelled, the customer gets the cancellation message on the channels the store set for it, and the store's notifications follow. Nothing is refunded or released by itself, and the message says nothing of a refund. The first call answers CONFIRMATION_REQUIRED with a preview (the customer, the dates, what was paid, and the message the customer gets or that none goes). Returns the change and the reservation's `links`, its dashboard page to give the user.",
      bundle: "daily",
      effect: "overwrite",
      reach: "customer",
    },
  })
  .route({
    method: "POST",
    path: "/reservations/{id}/cancel",
    description:
      "Cancels a reservation that is not over (pending, quote, confirmed or ongoing): its items go back to the stock and the customer gets the cancellation message on the channels the store set. If the reservation has an insurance contract, Louez asks the insurer to cancel it; if that fails, the reservation is cancelled all the same and the answer does not say so. Nothing is refunded or released, and the message does not mention a refund. On a key set to ask for confirmations (the default), it first answers 412 `CONFIRMATION_REQUIRED`, with a preview of the customer, the dates, what was paid and the message; on a key whose confirmations are off, it runs at once. Returns the change and the reservation's `links.dashboard`.",
  })
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
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "PATCH",
    path: "/reservations/{id}/notes",
    description:
      "Replaces a reservation's internal notes, which only the store's team sees; an empty string clears them. Returns the notes and the reservation's `links.dashboard`.",
  })
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
        "Search the store at once, as the dashboard's search bar does: up to 5 products by name, 5 reservations by number or customer name, and 5 customers by name, company, email, phone or a searchable custom field the store has not flagged sensitive. Products need read access to products, customers to customers; a section the connection may not read comes back empty. Each hit has `links`, its dashboard page to give the user.",
      bundle: "daily",
    },
  })
  .route({
    method: "GET",
    path: "/search",
    description:
      "Searches the store at once, as the dashboard's search bar does, for `query` (1 to 100 characters, matched anywhere in the field). Returns up to 5 products by name, A to Z; up to 5 reservations by number, or by the customer's name or company with a key that can read customers, newest first; and up to 5 customers by name, company, email, phone or a searchable custom field the store has not flagged sensitive, newest first. With a key that cannot read products, `products` comes back empty; with one that cannot read customers, so does `customers`, and each reservation's `customerName` is null. Each hit comes with `links.dashboard`, its page in the Louez dashboard.",
  })
  .input(globalSearchInput)
  .output(globalSearchOutput)
  .handler(async ({ context, input }) => {
    const link = linker(context);
    const hits = await globalSearch(
      {
        ...reader(context),
        products: mayRead(context, "products"),
        // An API key or an agent's grant never searches sensitive fields.
        sensitiveFields: context.actor.credential.kind === "session",
      },
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
