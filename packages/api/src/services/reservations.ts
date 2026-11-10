import {
  customers,
  db,
  payments,
  products,
  productsTulip,
  receivedInvoices,
  reservationActivity,
  reservationItemUnits,
  reservationItems,
  reservations,
  storeIntegrations,
} from "@louez/db";
import { getSettledPaymentAmount, hasReservationInsuranceCoverage } from "@louez/utils";
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gt,
  gte,
  inArray,
  like,
  lt,
  lte,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { z } from "zod";

import {
  GLOBAL_SEARCH_LIMIT,
  RESERVATION_AGENDA_DEFAULT,
  RESERVATION_PAGE_DEFAULT,
  RESERVATION_WINDOW_MAX_DAYS,
  reservationErrors,
  type CalendarEntry,
  type ListReservationsInput,
  type PlanningEntry,
  type Reservation,
  type ReservationCounts,
  type ReservationListItem,
  type ReservationPoll,
  type globalSearchSchema,
  type listOverdueInput,
  type listUpcomingInput,
} from "../contracts/reservations";
import type { Transport } from "../platform/actor";
import { analyticsEventIdentity, enqueueEffects } from "../platform/effects";
import { platformErrors } from "../platform/errors";
import type { ApiEventStore, ApiPorts } from "../platform/ports";
import { customerFieldSearchCondition } from "./customer-fields";

/**
 * The reservations follow-up reads: the list, the detail, the counters, the
 * calendar and the planning, the agenda and the global search. Every query
 * filters on the caller's store. A caller that may not read customers gets
 * no customer data (contracts/reservations.ts).
 */

/** Who reads, and what they may see beyond reservations. */
export interface ReservationReader {
  storeId: string;
  /** The store's currency, for reservations created before they kept their own. */
  currency: string;
  /** The member's role, cut down to the connection's scopes, allows reading customers. */
  customers: boolean;
  /** The same for payments: their rows, notes and Stripe ids. */
  payments: boolean;
}

/** What was paid toward the rental, refunds taken off, as a decimal string. */
const rentalPaidOf = (rows: Parameters<typeof getSettledPaymentAmount>[0]) =>
  getSettledPaymentAmount(rows, "rental").toFixed(2);

/** Activity entries about payments and deposits: their text needs payments read. */
const isPaymentActivity = (activityType: string) =>
  activityType.startsWith("payment_") || activityType.startsWith("deposit_");

const STATUS_CHANGE_KEYS = [
  "previousStatus",
  "newStatus",
  "actor",
  "source",
  "rejectionReason",
  "validationWarnings",
  "validationWarningsCount",
] as const;

/**
 * The activity details a caller who may read reservations but not payments
 * sees, by activity type. Any other key may name a payment (a Stripe
 * session, an amount, a payment's state, as a rental extension writes on a
 * `modified` entry) and is left out; a type not listed shows none.
 */
const PAYMENT_FREE_ACTIVITY_KEYS: Readonly<Record<string, readonly string[]>> = {
  created: ["source", "status"],
  confirmed: STATUS_CHANGE_KEYS,
  rejected: STATUS_CHANGE_KEYS,
  cancelled: STATUS_CHANGE_KEYS,
  picked_up: STATUS_CHANGE_KEYS,
  returned: STATUS_CHANGE_KEYS,
  quote_accepted: STATUS_CHANGE_KEYS,
  quote_declined: STATUS_CHANGE_KEYS,
  modified: ["kind", "source", "validatedAt"],
  note_updated: [
    "kind",
    "status",
    "originalStartDate",
    "originalEndDate",
    "requestedEndDate",
    "reason",
    "reviewedAt",
  ],
  inspection_departure_started: ["inspectionId"],
  inspection_departure_completed: ["inspectionId"],
  inspection_return_started: ["inspectionId"],
  inspection_return_completed: ["inspectionId"],
  inspection_damage_detected: ["inspectionId"],
  inspection_signed: ["inspectionId"],
};

/** An activity entry's details, cut down to the keys its type shows without payments read. */
function paymentFreeMetadata(activityType: string, metadata: Record<string, unknown> | null) {
  if (!metadata) return null;
  const keys = PAYMENT_FREE_ACTIVITY_KEYS[activityType] ?? [];
  const kept = Object.fromEntries(Object.entries(metadata).filter(([key]) => keys.includes(key)));
  return Object.keys(kept).length > 0 ? kept : null;
}

const CLOSED_STATUSES = ["cancelled", "rejected", "declined"] as const;

const customerName = (row: { firstName: string | null; lastName: string | null }) =>
  [row.firstName, row.lastName].filter(Boolean).join(" ").trim();

// --- List --------------------------------------------------------------------

type SortKey = NonNullable<ListReservationsInput["sort"]>;

/** A status sorts by its place in the enum, as MySQL orders an ENUM. */
const statusPosition = sql<number>`(${reservations.status} + 0)`;

/** The column a sort reads. */
const sortColumn = (sort: SortKey) => {
  switch (sort) {
    case "amount":
      return reservations.totalAmount;
    case "status":
      return statusPosition;
    case "number":
      return reservations.number;
    case "startDate":
      return reservations.startDate;
  }
};

interface ListCursor {
  sort: SortKey;
  direction: "asc" | "desc";
  value: string | number;
  id: string;
}

const encodeCursor = (cursor: ListCursor) =>
  Buffer.from(JSON.stringify(cursor)).toString("base64url");

function decodeCursor(raw: string, sort: SortKey, direction: "asc" | "desc"): ListCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw reservationErrors.invalidCursor();
  }
  const cursor = parsed as Partial<ListCursor> | null;
  if (
    !cursor ||
    cursor.sort !== sort ||
    cursor.direction !== direction ||
    typeof cursor.id !== "string" ||
    (typeof cursor.value !== "string" && typeof cursor.value !== "number")
  ) {
    throw reservationErrors.invalidCursor();
  }
  return { sort, direction, value: cursor.value, id: cursor.id };
}

/** The rows after a cursor, in the sort's order: past its value, or at it with a later id. */
function afterCursor(cursor: ListCursor): SQL {
  const beyond = cursor.direction === "desc" ? lt : gt;
  const keyset = (past: SQL | undefined, same: SQL | undefined) =>
    or(past, and(same, beyond(reservations.id, cursor.id))) as SQL;
  const value = cursor.value;
  switch (cursor.sort) {
    case "startDate": {
      const date = new Date(String(value));
      return keyset(beyond(reservations.startDate, date), eq(reservations.startDate, date));
    }
    case "amount":
      return keyset(
        beyond(reservations.totalAmount, String(value)),
        eq(reservations.totalAmount, String(value)),
      );
    case "number":
      return keyset(
        beyond(reservations.number, String(value)),
        eq(reservations.number, String(value)),
      );
    case "status": {
      const index = Number(value);
      return keyset(beyond(statusPosition, index), eq(statusPosition, index));
    }
  }
}

/** The cursor value of a row, as the sort column holds it. */
function sortValueOf(
  sort: SortKey,
  row: { startDate: Date; totalAmount: string; status: string; number: string },
): string | number {
  switch (sort) {
    case "amount":
      return row.totalAmount;
    case "status":
      return reservationStatusIndex(row.status);
    case "number":
      return row.number;
    case "startDate":
      return row.startDate.toISOString();
  }
}

/** 1-based, as `status + 0` reads an ENUM in MySQL. */
const reservationStatusIndex = (status: string) =>
  reservations.status.enumValues.indexOf(
    status as (typeof reservations.status.enumValues)[number],
  ) + 1;

/** The bounds of today, this week (Monday to Sunday) or this month, in the server's time. */
function periodBounds(period: "today" | "week" | "month", now = new Date()) {
  if (period === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  if (period === "week") {
    const start = new Date(now);
    start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/** Reservations per dashboard tab, every filter left out. */
export async function countReservationsByTab(storeId: string): Promise<ReservationCounts> {
  const rows = await db
    .select({ status: reservations.status, count: count() })
    .from(reservations)
    .where(eq(reservations.storeId, storeId))
    .groupBy(reservations.status);
  const by = new Map(rows.map((row) => [row.status, row.count]));
  const of = (status: string) => by.get(status as (typeof rows)[number]["status"]) ?? 0;
  return {
    all: of("pending") + of("confirmed") + of("ongoing") + of("completed") + of("quote"),
    pending: of("pending"),
    confirmed: of("confirmed"),
    ongoing: of("ongoing"),
    completed: of("completed"),
    cancelled: CLOSED_STATUSES.reduce((sum, status) => sum + of(status), 0),
    quote: of("quote"),
  };
}

/**
 * One page of the store's reservations, with the dashboard's filters and
 * sorts. The order is total (the sort column, then the id), so a cursor (the
 * last row's sort value and id) never skips or repeats a row. A page number
 * reads by offset, for numbered pages.
 */
export async function listReservations(reader: ReservationReader, input: ListReservationsInput) {
  const { storeId } = reader;
  const limit = input.limit ?? RESERVATION_PAGE_DEFAULT;
  const sort = input.sort ?? "startDate";
  const direction = input.sortDirection ?? "desc";
  const search = input.search?.trim();

  // The filter would tell how a reservation was paid.
  if (input.paymentMethod && !reader.payments) {
    throw platformErrors.permissionDenied("payments:read");
  }
  const conditions: SQL[] = [eq(reservations.storeId, storeId)];
  if (input.paymentMethod) {
    conditions.push(
      exists(
        db
          .select({ id: payments.id })
          .from(payments)
          .where(
            and(
              eq(payments.reservationId, reservations.id),
              eq(payments.method, input.paymentMethod),
              eq(payments.status, "completed"),
            ),
          ),
      ),
    );
  }
  if (input.status && input.status !== "all") {
    conditions.push(
      input.status === "cancelled"
        ? inArray(reservations.status, [...CLOSED_STATUSES])
        : eq(reservations.status, input.status),
    );
  } else if (!search) {
    // The default view is the active workflow. A search still finds closed
    // reservations, whose status the user may not know.
    conditions.push(notInArray(reservations.status, [...CLOSED_STATUSES]));
  }
  if (input.period) {
    const { start, end } = periodBounds(input.period);
    const column = input.operation === "return" ? reservations.endDate : reservations.startDate;
    conditions.push(gte(column, start), lte(column, end));
  }
  if (search) {
    const term = `%${search}%`;
    const byNumber = like(reservations.number, term);
    // Names are customer data: only a caller who may read customers searches them.
    conditions.push(
      reader.customers
        ? (or(
            byNumber,
            like(customers.firstName, term),
            like(customers.lastName, term),
            sql`CONCAT(${customers.firstName}, ' ', ${customers.lastName}) LIKE ${term}`,
          ) as SQL)
        : byNumber,
    );
  }
  const filters = and(...conditions);

  const column = sortColumn(sort);
  const pageConditions = [...conditions];
  if (input.cursor) pageConditions.push(afterCursor(decodeCursor(input.cursor, sort, direction)));
  const order = direction === "desc" ? desc : asc;
  const offset = input.cursor || !input.page ? 0 : (input.page - 1) * limit;

  const [pageRows, [total], counts] = await Promise.all([
    db
      .select({
        id: reservations.id,
        startDate: reservations.startDate,
        totalAmount: reservations.totalAmount,
        status: reservations.status,
        number: reservations.number,
      })
      .from(reservations)
      .leftJoin(customers, eq(reservations.customerId, customers.id))
      .where(and(...pageConditions))
      .orderBy(order(column), order(reservations.id))
      .limit(limit + 1)
      .offset(offset),
    db
      .select({ count: count() })
      .from(reservations)
      .leftJoin(customers, eq(reservations.customerId, customers.id))
      .where(filters),
    countReservationsByTab(storeId),
  ]);

  const page = pageRows.slice(0, limit);
  const last = page.at(-1);
  const rows =
    page.length === 0
      ? []
      : await db.query.reservations.findMany({
          where: and(
            eq(reservations.storeId, storeId),
            inArray(
              reservations.id,
              page.map((row) => row.id),
            ),
          ),
          columns: {
            id: true,
            number: true,
            status: true,
            source: true,
            startDate: true,
            endDate: true,
            createdAt: true,
            subtotalAmount: true,
            depositAmount: true,
            totalAmount: true,
            signedAt: true,
            signatureMethod: true,
          },
          with: {
            customer: { columns: { id: true, firstName: true, lastName: true, email: true } },
            items: {
              columns: {
                id: true,
                quantity: true,
                isCustomItem: true,
                productSnapshot: true,
                selectedAttributes: true,
              },
              with: { product: { columns: { id: true, name: true } } },
            },
            payments: {
              columns: {
                id: true,
                amount: true,
                type: true,
                method: true,
                status: true,
                refundOfPaymentId: true,
                stripeRefundId: true,
                stripePaymentIntentId: true,
                stripeCheckoutSessionId: true,
              },
            },
          },
        });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const items: ReservationListItem[] = page.flatMap(({ id }) => {
    const row = byId.get(id);
    if (!row) return [];
    return [
      {
        ...row,
        customer: reader.customers ? row.customer : null,
        rentalPaid: rentalPaidOf(row.payments),
        payments: reader.payments ? row.payments : [],
        items: row.items.map((item) => ({
          ...item,
          productSnapshot: { name: item.productSnapshot.name },
          selectedAttributes: item.selectedAttributes ?? null,
        })),
      },
    ];
  });

  return {
    items,
    nextCursor:
      pageRows.length > limit && last
        ? encodeCursor({ sort, direction, value: sortValueOf(sort, last), id: last.id })
        : null,
    totalCount: total?.count ?? 0,
    counts,
    currency: reader.currency,
  };
}

// --- Detail ------------------------------------------------------------------

/** One reservation with everything its dashboard page shows. */
export async function getReservation(reader: ReservationReader, id: string): Promise<Reservation> {
  const row = await db.query.reservations.findFirst({
    where: and(eq(reservations.id, id), eq(reservations.storeId, reader.storeId)),
    columns: {
      storeId: false,
      signatureIp: false,
      depositPaymentIntentId: false,
      stripeCustomerId: false,
      billableAt: false,
      withdrawnAt: false,
      deliveryLatitude: false,
      deliveryLongitude: false,
      returnLatitude: false,
      returnLongitude: false,
      pickupLocationId: false,
      returnLocationId: false,
      promoCodeId: false,
    },
    with: {
      customer: {
        columns: {
          id: true,
          customerType: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          companyName: true,
          companyNumber: true,
          companyNumberScheme: true,
          vatNumber: true,
          address: true,
          city: true,
          postalCode: true,
          country: true,
        },
      },
      items: {
        columns: { reservationId: false, createdAt: false },
        with: {
          product: {
            columns: {
              id: true,
              name: true,
              images: true,
              price: true,
              deposit: true,
              quantity: true,
              stockKind: true,
              trackUnits: true,
              pricingKind: true,
              pricingMode: true,
              basePeriodMinutes: true,
              enforceStrictTiers: true,
              bookingAttributeAxes: true,
            },
          },
          assignedUnits: {
            columns: { id: true, productUnitId: true, identifierSnapshot: true, assignedAt: true },
          },
        },
      },
      payments: {
        columns: {
          id: true,
          amount: true,
          currency: true,
          type: true,
          method: true,
          status: true,
          notes: true,
          paidAt: true,
          createdAt: true,
          refundOfPaymentId: true,
          capturedAmount: true,
          authorizationExpiresAt: true,
          stripeRefundId: true,
          stripePaymentIntentId: true,
          stripeCheckoutSessionId: true,
        },
      },
      documents: {
        columns: { id: true, type: true, number: true, fileName: true, generatedAt: true },
      },
      activity: {
        columns: {
          id: true,
          activityType: true,
          description: true,
          metadata: true,
          createdAt: true,
        },
        with: { user: { columns: { name: true, email: true, image: true } } },
        orderBy: [desc(reservationActivity.createdAt)],
      },
    },
  });
  if (!row) throw reservationErrors.notFound(id);

  const productIds = row.items.flatMap((item) =>
    !item.isCustomItem && item.productId ? [item.productId] : [],
  );
  const insured =
    hasReservationInsuranceCoverage(row) && productIds.length > 0
      ? await db
          .selectDistinct({ productId: productsTulip.productId })
          .from(productsTulip)
          .innerJoin(products, eq(productsTulip.productId, products.id))
          .where(
            and(
              eq(products.storeId, reader.storeId),
              inArray(productsTulip.productId, productIds),
              sql`${productsTulip.tulipProductId} IS NOT NULL AND ${productsTulip.tulipProductId} <> ''`,
            ),
          )
      : [];

  const reservation: Reservation = {
    ...row,
    rentalPaid: rentalPaidOf(row.payments),
    currency: row.currency ?? reader.currency,
    insuredProductIds: insured.map((mapping) => mapping.productId),
    items: row.items.map((item) => ({
      ...item,
      selectedAttributes: item.selectedAttributes ?? null,
      pricingBreakdown: item.pricingBreakdown ? { ...item.pricingBreakdown } : null,
    })),
    activity: row.activity.map((entry) => ({
      ...entry,
      metadata: entry.metadata ?? null,
    })),
  };
  const visible = reader.payments ? reservation : withoutPayments(reservation);
  return reader.customers ? visible : withoutCustomer(visible);
}

/** The reservation without its payment rows, Stripe ids and the payment details of its history. */
function withoutPayments(reservation: Reservation): Reservation {
  return {
    ...reservation,
    payments: [],
    stripePaymentMethodId: null,
    activity: reservation.activity.map((entry) => ({
      ...entry,
      description: isPaymentActivity(entry.activityType) ? null : entry.description,
      metadata: paymentFreeMetadata(entry.activityType, entry.metadata),
    })),
  };
}

/**
 * The reservation without its customer's data: who, where, and every free
 * text that may name them (a capture reason with a phone number, a note).
 */
function withoutCustomer(reservation: Reservation): Reservation {
  return {
    ...reservation,
    internalNotes: null,
    payments: reservation.payments.map((payment) => ({ ...payment, notes: null })),
    customerId: null,
    customer: null,
    billingSnapshot: null,
    customerNotes: null,
    deliveryAddress: null,
    deliveryCity: null,
    deliveryPostalCode: null,
    deliveryCountry: null,
    returnAddress: null,
    returnCity: null,
    returnPostalCode: null,
    returnCountry: null,
    // Activity texts and details name emails, phones and what the customer asked.
    activity: reservation.activity.map((entry) => ({
      ...entry,
      description: null,
      metadata: null,
    })),
  };
}

/** The reservation's number, or not found in this store. */
export async function assertOwnedReservation(storeId: string, id: string) {
  const [row] = await db
    .select({ id: reservations.id, number: reservations.number })
    .from(reservations)
    .where(and(eq(reservations.id, id), eq(reservations.storeId, storeId)))
    .limit(1);
  if (!row) throw reservationErrors.notFound(id);
  return row;
}

// --- Notes -------------------------------------------------------------------

/**
 * Replaces a reservation's internal notes. Notes are in no billing snapshot,
 * so they need no mark (DL-13). An API or agent call adds its analytics
 * event to the outbox (the dashboard records its own in the browser); the
 * app then revalidates the page.
 */
export async function updateReservationNotes(
  caller: {
    storeId: string;
    store: ApiEventStore;
    transport: Transport;
    ports: Pick<ApiPorts, "afterCommit" | "dispatchEffects">;
  },
  input: { id: string; notes: string },
) {
  const { storeId, transport } = caller;
  const owned = await assertOwnedReservation(storeId, input.id);
  const updatedAt = new Date();
  const effectIds = await db.transaction(async (tx) => {
    await tx
      .update(reservations)
      .set({ internalNotes: input.notes, updatedAt })
      .where(and(eq(reservations.id, input.id), eq(reservations.storeId, storeId)));
    // The dashboard records its own event in the browser.
    if (transport === "rpc") return [];
    return enqueueEffects(tx, storeId, [
      {
        type: "reservation.notesAnalytics",
        payload: {
          ...analyticsEventIdentity(updatedAt),
          ownerUserId: caller.store.ownerUserId,
          storeId,
          reservationId: input.id,
          hasNotes: input.notes.trim().length > 0,
          transport,
        },
      },
    ]);
  });

  try {
    if (effectIds.length > 0) caller.ports.dispatchEffects(effectIds);
    caller.ports.afterCommit({
      type: "reservation.notesUpdated",
      store: caller.store,
      reservationId: input.id,
    });
  } catch (error) {
    console.error("A reservation effect failed after its commit:", error);
  }
  return { id: input.id, number: owned.number, internalNotes: input.notes, updatedAt };
}

// --- Counters ----------------------------------------------------------------

/** What the dashboard polls: pending requests, the newest one, and the counters. */
export async function pollReservations(reader: ReservationReader): Promise<ReservationPoll> {
  const { storeId } = reader;
  const pending = and(eq(reservations.storeId, storeId), eq(reservations.status, "pending"));

  const [[pendingCount], latest, pendingRows, [supplierInvoices], [total], counts] =
    await Promise.all([
      db.select({ count: count() }).from(reservations).where(pending),
      db.query.reservations.findFirst({
        where: and(pending, eq(reservations.source, "online")),
        orderBy: [desc(reservations.createdAt)],
        columns: { id: true, createdAt: true, status: true, number: true },
      }),
      db
        .select({
          id: reservations.id,
          number: reservations.number,
          status: reservations.status,
          createdAt: reservations.createdAt,
          startDate: reservations.startDate,
          firstName: customers.firstName,
          lastName: customers.lastName,
        })
        .from(reservations)
        .leftJoin(customers, eq(reservations.customerId, customers.id))
        .where(pending)
        .orderBy(desc(reservations.createdAt))
        .limit(5),
      db
        .select({ count: count() })
        .from(receivedInvoices)
        .innerJoin(
          storeIntegrations,
          and(
            eq(storeIntegrations.storeId, receivedInvoices.storeId),
            eq(storeIntegrations.providerKey, "superpdp"),
          ),
        )
        .where(and(eq(receivedInvoices.storeId, storeId), eq(receivedInvoices.ourAction, "none"))),
      db.select({ count: count() }).from(reservations).where(eq(reservations.storeId, storeId)),
      countReservationsByTab(storeId),
    ]);

  return {
    pendingCount: pendingCount?.count ?? 0,
    pendingSupplierInvoices: supplierInvoices?.count ?? 0,
    totalCount: total?.count ?? 0,
    counts,
    pendingReservations: pendingRows.map((row) => ({
      id: row.id,
      number: row.number,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      startDate: row.startDate.toISOString(),
      customerName: reader.customers ? customerName(row) || "Client" : null,
    })),
    latestReservation: latest
      ? {
          id: latest.id,
          number: latest.number,
          status: latest.status,
          createdAt: latest.createdAt.toISOString(),
        }
      : null,
    timestamp: new Date().toISOString(),
  };
}

// --- Calendar and planning ---------------------------------------------------

function assertWindow(window: { from: Date; to: Date }) {
  const days = (window.to.getTime() - window.from.getTime()) / 86_400_000;
  if (!(days >= 0) || days > RESERVATION_WINDOW_MAX_DAYS) throw reservationErrors.windowInvalid();
}

/** The reservations that overlap the window, by start, as the calendar shows them. */
export async function listCalendarPeriod(
  reader: ReservationReader,
  window: { from: Date; to: Date },
): Promise<{ items: CalendarEntry[]; currency: string }> {
  assertWindow(window);
  const rows = await db.query.reservations.findMany({
    where: and(
      eq(reservations.storeId, reader.storeId),
      lte(reservations.startDate, window.to),
      gte(reservations.endDate, window.from),
    ),
    columns: {
      id: true,
      number: true,
      status: true,
      startDate: true,
      endDate: true,
      subtotalAmount: true,
      depositAmount: true,
      totalAmount: true,
      outboundMethod: true,
      returnMethod: true,
      deliveryAddress: true,
      deliveryCity: true,
      deliveryPostalCode: true,
      deliveryCountry: true,
      returnAddress: true,
      returnCity: true,
      returnPostalCode: true,
      returnCountry: true,
    },
    with: {
      customer: { columns: { id: true, firstName: true, lastName: true } },
      items: {
        columns: { id: true, quantity: true, productSnapshot: true },
        with: {
          product: { columns: { id: true, name: true, images: true, displayOrder: true } },
        },
      },
    },
    orderBy: [asc(reservations.startDate), asc(reservations.id)],
  });

  const items = rows.map((row) => ({
    ...row,
    items: row.items.map((item) => ({
      ...item,
      productSnapshot: { name: item.productSnapshot.name, images: item.productSnapshot.images },
    })),
    ...(reader.customers
      ? {}
      : {
          customer: null,
          deliveryAddress: null,
          deliveryCity: null,
          deliveryPostalCode: null,
          deliveryCountry: null,
          returnAddress: null,
          returnCity: null,
          returnPostalCode: null,
          returnCountry: null,
        }),
  }));
  return { items, currency: reader.currency };
}

/** The reservations that overlap the window, one entry per reservation and product. */
export async function getPlanningTimeline(
  reader: ReservationReader,
  window: { from: Date; to: Date },
): Promise<{ items: PlanningEntry[]; currency: string }> {
  assertWindow(window);
  const rows = await db
    .select({
      reservationId: reservations.id,
      number: reservations.number,
      status: reservations.status,
      startDate: reservations.startDate,
      endDate: reservations.endDate,
      customerId: customers.id,
      customerFirstName: customers.firstName,
      customerLastName: customers.lastName,
      subtotalAmount: reservations.subtotalAmount,
      depositAmount: reservations.depositAmount,
      totalAmount: reservations.totalAmount,
      itemId: reservationItems.id,
      productId: reservationItems.productId,
      productName: products.name,
      productImages: products.images,
      quantity: reservationItems.quantity,
      outboundMethod: reservations.outboundMethod,
      returnMethod: reservations.returnMethod,
      deliveryAddress: reservations.deliveryAddress,
      deliveryCity: reservations.deliveryCity,
      deliveryPostalCode: reservations.deliveryPostalCode,
      deliveryCountry: reservations.deliveryCountry,
      returnAddress: reservations.returnAddress,
      returnCity: reservations.returnCity,
      returnPostalCode: reservations.returnPostalCode,
      returnCountry: reservations.returnCountry,
    })
    .from(reservationItems)
    .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
    .leftJoin(customers, eq(reservations.customerId, customers.id))
    .leftJoin(products, eq(reservationItems.productId, products.id))
    .where(
      and(
        eq(reservations.storeId, reader.storeId),
        lte(reservations.startDate, window.to),
        gte(reservations.endDate, window.from),
      ),
    )
    .orderBy(asc(reservations.startDate), asc(reservations.id), asc(reservationItems.id));

  const itemIds = rows.map((row) => row.itemId);
  const assignmentRows = itemIds.length
    ? await db
        .select({
          reservationItemId: reservationItemUnits.reservationItemId,
          productUnitId: reservationItemUnits.productUnitId,
        })
        .from(reservationItemUnits)
        .where(inArray(reservationItemUnits.reservationItemId, itemIds))
    : [];
  const assignmentsByItem = new Map<string, string[]>();
  for (const assignment of assignmentRows) {
    if (!assignment.productUnitId) continue;
    const unitIds = assignmentsByItem.get(assignment.reservationItemId) ?? [];
    unitIds.push(assignment.productUnitId);
    assignmentsByItem.set(assignment.reservationItemId, unitIds);
  }

  const byPair = new Map<string, PlanningEntry>();
  for (const row of rows) {
    if (!row.productId) continue;
    const assignedUnitIds = assignmentsByItem.get(row.itemId) ?? [];
    const key = `${row.reservationId}_${row.productId}`;
    const existing = byPair.get(key);
    if (existing) {
      existing.quantity += row.quantity;
      existing.assignedUnitIds.push(...assignedUnitIds);
      if (existing.items[0]) existing.items[0].quantity += row.quantity;
      continue;
    }

    const leg = (
      address: string | null,
      city: string | null,
      postal: string | null,
      country: string | null,
    ) => (reader.customers ? { address, city, postalCode: postal, country } : null);
    byPair.set(key, {
      id: row.reservationId,
      productId: row.productId,
      number: row.number,
      status: row.status,
      startDate: row.startDate,
      endDate: row.endDate,
      customerId: reader.customers ? row.customerId : null,
      customerName: reader.customers
        ? customerName({ firstName: row.customerFirstName, lastName: row.customerLastName }) || "—"
        : null,
      subtotalAmount: row.subtotalAmount,
      depositAmount: row.depositAmount,
      totalAmount: row.totalAmount,
      quantity: row.quantity,
      assignedUnitIds,
      items: row.productName
        ? [
            {
              productId: row.productId,
              name: row.productName,
              quantity: row.quantity,
              imageUrl: row.productImages?.[0] ?? null,
            },
          ]
        : [],
      outboundDelivery:
        row.outboundMethod === "address"
          ? leg(row.deliveryAddress, row.deliveryCity, row.deliveryPostalCode, row.deliveryCountry)
          : null,
      returnDelivery:
        row.returnMethod === "address"
          ? leg(row.returnAddress, row.returnCity, row.returnPostalCode, row.returnCountry)
          : null,
    });
  }

  return { items: Array.from(byPair.values()), currency: reader.currency };
}

// --- Agenda ------------------------------------------------------------------

const agendaColumns = {
  id: reservations.id,
  number: reservations.number,
  status: reservations.status,
  startDate: reservations.startDate,
  endDate: reservations.endDate,
  totalAmount: reservations.totalAmount,
  customerId: customers.id,
  firstName: customers.firstName,
  lastName: customers.lastName,
  email: customers.email,
};

interface AgendaRow {
  id: string;
  number: string;
  status: Reservation["status"];
  startDate: Date;
  endDate: Date;
  totalAmount: string;
  customerId: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}

function toAgendaEntry(reader: ReservationReader, row: AgendaRow) {
  const { customerId, firstName, lastName, email, ...entry } = row;
  return {
    ...entry,
    customer:
      reader.customers && customerId
        ? {
            id: customerId,
            firstName: firstName ?? "",
            lastName: lastName ?? "",
            email: email ?? "",
          }
        : null,
  };
}

/** Confirmed reservations that start, and ongoing ones due back, from today on. */
export async function listUpcoming(
  reader: ReservationReader,
  input: z.infer<typeof listUpcomingInput>,
) {
  const limit = input.limit ?? RESERVATION_AGENDA_DEFAULT;
  // From the start of today, not now: a pickup at 9am is still today's
  // business at 2pm, as the dashboard's "today" widgets count it.
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + (input.days ?? 7));

  const agenda = (
    status: "confirmed" | "ongoing",
    date: typeof reservations.startDate | typeof reservations.endDate,
  ) =>
    db
      .select(agendaColumns)
      .from(reservations)
      .leftJoin(customers, eq(reservations.customerId, customers.id))
      .where(
        and(
          eq(reservations.storeId, reader.storeId),
          eq(reservations.status, status),
          gte(date, from),
          lte(date, to),
        ),
      )
      .orderBy(asc(date), asc(reservations.id))
      .limit(limit + 1);

  const [pickups, returns] = await Promise.all([
    agenda("confirmed", reservations.startDate),
    agenda("ongoing", reservations.endDate),
  ]);
  return {
    pickups: pickups.slice(0, limit).map((row) => toAgendaEntry(reader, row)),
    returns: returns.slice(0, limit).map((row) => toAgendaEntry(reader, row)),
    hasMore: pickups.length > limit || returns.length > limit,
    from,
    to,
    currency: reader.currency,
  };
}

/** Ongoing reservations past their end date: returns that are late. */
export async function listOverdue(
  reader: ReservationReader,
  input: z.infer<typeof listOverdueInput>,
) {
  const limit = input.limit ?? RESERVATION_AGENDA_DEFAULT;
  const now = new Date();
  const rows = await db
    .select(agendaColumns)
    .from(reservations)
    .leftJoin(customers, eq(reservations.customerId, customers.id))
    .where(
      and(
        eq(reservations.storeId, reader.storeId),
        eq(reservations.status, "ongoing"),
        lte(reservations.endDate, now),
      ),
    )
    .orderBy(asc(reservations.endDate), asc(reservations.id))
    .limit(limit + 1);

  return {
    items: rows.slice(0, limit).map((row) => ({
      ...toAgendaEntry(reader, row),
      daysLate: Math.max(0, Math.ceil((now.getTime() - row.endDate.getTime()) / 86_400_000)),
    })),
    hasMore: rows.length > limit,
    currency: reader.currency,
  };
}

// --- Global search -----------------------------------------------------------

/**
 * The command palette's search: a few products, reservations and customers
 * that match. Each kind needs read access to its domain; a reservation found
 * by its customer's name needs customers too.
 */
export async function globalSearch(
  reader: ReservationReader & {
    products: boolean;
    /** Search fields the store flagged sensitive too: the dashboard's own session only. */
    sensitiveFields: boolean;
  },
  query: string,
): Promise<z.infer<typeof globalSearchSchema>> {
  const { storeId } = reader;
  const term = `%${query}%`;
  // Searchable custom fields: a value the store keeps on file finds its customer.
  const customFieldMatch = reader.customers
    ? customerFieldSearchCondition(storeId, query, { sensitive: reader.sensitiveFields })
    : null;

  const reservationMatch = reader.customers
    ? or(
        like(reservations.number, term),
        like(customers.firstName, term),
        like(customers.lastName, term),
        sql`CONCAT(${customers.firstName}, ' ', ${customers.lastName}) LIKE ${term}`,
        like(customers.companyName, term),
      )
    : like(reservations.number, term);

  const [productRows, reservationRows, customerRows] = await Promise.all([
    reader.products
      ? db
          .select({
            id: products.id,
            name: products.name,
            price: products.price,
            images: products.images,
          })
          .from(products)
          .where(and(eq(products.storeId, storeId), like(products.name, term)))
          .orderBy(products.name, products.id)
          .limit(GLOBAL_SEARCH_LIMIT)
      : [],
    db
      .select({
        id: reservations.id,
        number: reservations.number,
        status: reservations.status,
        startDate: reservations.startDate,
        endDate: reservations.endDate,
        firstName: customers.firstName,
        lastName: customers.lastName,
        companyName: customers.companyName,
      })
      .from(reservations)
      .leftJoin(customers, eq(reservations.customerId, customers.id))
      .where(and(eq(reservations.storeId, storeId), reservationMatch))
      .orderBy(desc(reservations.createdAt), desc(reservations.id))
      .limit(GLOBAL_SEARCH_LIMIT),
    reader.customers
      ? db
          .select({
            id: customers.id,
            firstName: customers.firstName,
            lastName: customers.lastName,
            companyName: customers.companyName,
            email: customers.email,
          })
          .from(customers)
          .where(
            and(
              eq(customers.storeId, storeId),
              or(
                like(customers.firstName, term),
                like(customers.lastName, term),
                sql`CONCAT(${customers.firstName}, ' ', ${customers.lastName}) LIKE ${term}`,
                like(customers.companyName, term),
                like(customers.email, term),
                like(customers.phone, term),
                ...(customFieldMatch ? [customFieldMatch] : []),
              ),
            ),
          )
          .orderBy(desc(customers.createdAt), desc(customers.id))
          .limit(GLOBAL_SEARCH_LIMIT)
      : [],
  ]);

  return {
    products: productRows.map((product) => ({
      id: product.id,
      name: product.name,
      price: product.price,
      image: product.images?.[0] ?? null,
    })),
    reservations: reservationRows.map((reservation) => ({
      id: reservation.id,
      number: reservation.number,
      status: reservation.status,
      customerName: reader.customers ? reservation.companyName || customerName(reservation) : null,
      startDate: reservation.startDate,
      endDate: reservation.endDate,
    })),
    customers: customerRows.map((customer) => ({
      id: customer.id,
      name: customer.companyName || customerName(customer),
      email: customer.email,
    })),
  };
}
