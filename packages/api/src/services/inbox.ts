import {
  apiEffects,
  apiOperations,
  customers,
  db,
  getBlockingReservationStatuses,
  inboxAcknowledgements,
  invoices,
  paymentDisputes,
  payments,
  productUnitDowntimes,
  productUnits,
  products,
  readReservationGateSince,
  receivedInvoices,
  reservationActivity,
  reservationItemUnits,
  reservationItems,
  reservations,
  storeIntegrations,
  type ReservationGateReason,
} from "@louez/db";
import {
  and,
  asc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  notExists,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";

import {
  INBOX_ITEM_TYPES,
  INBOX_PAGE_DEFAULT,
  inboxErrors,
  type InboxItem,
  type InboxItemType,
  type ListInboxInput,
} from "../contracts/inbox";
import type { ResourceLinks } from "../contracts/links";
import { platformErrors } from "../platform/errors";
import { OPERATION_LEASE_SECONDS } from "../platform/operations";
import type { ApiDomain } from "../platform/permissions";
import {
  dashboardPageLinks,
  productLinks,
  reservationLinks,
  storeLinks,
  type LinkStore,
} from "../platform/links";
import type { UrlsPort } from "../platform/ports";
import { getLaunchChecklist } from "./launch";

/**
 * The inbox: what needs the store's attention, read from where each thing
 * already lives (reservations, their history, disputes, invoices, the
 * outbox, the API's operations, the billing gate, the launch checklist).
 * Nothing is copied: an item leaves the inbox as soon as what it is about is
 * handled, and a store can mark an item as handled (`inbox_acknowledgements`).
 *
 * Items come in one order, by when they entered the inbox, then type, then
 * record. The cursor holds the last position read, so a caller that polls
 * gets only what entered since. Each item's `occurredAt` is never earlier
 * than the moment it could first be read, and an item shows only once it is
 * HOLD_BACK_MS old, so a row committed late is not passed over.
 */

/** How long an item waits before it shows: longer than a write's transaction. */
export const INBOX_HOLD_BACK_MS = 30_000;
const DAY_MS = 86_400_000;
/** Payment failures older than this are left out. */
const PAYMENT_FAILURE_DAYS = 30;
/** Pickups late on a rental that ended longer ago than this are left out. */
const STALE_PICKUP_DAYS = 30;
/** A deposit hold shows this long before it expires. */
const DEPOSIT_NOTICE_HOURS = 48;
/** Rejected e-invoices older than this are left out. */
const EINVOICE_DAYS = 90;
/** Operations older than this are left out. */
const OPERATION_DAYS = 7;

/** The domains a caller must read to see an item of each type; the first one to acknowledge it. */
export const INBOX_ITEM_DOMAINS: Record<InboxItemType, readonly ApiDomain[]> = {
  booking_request: ["reservations"],
  date_change_request: ["reservations"],
  pickup_overdue: ["reservations"],
  return_overdue: ["reservations"],
  deposit_expiring: ["payments", "reservations"],
  payment_failed: ["payments", "reservations"],
  dispute_open: ["payments", "reservations"],
  unit_conflict: ["reservations", "products"],
  overbooking: ["reservations"],
  supplier_invoice: ["integrations"],
  einvoice_rejected: ["reservations"],
  billing_gate_closed: ["settings"],
  store_not_live: ["settings"],
  message_not_sent: ["reservations"],
  operation_unknown: [],
};

export type InboxRights = Partial<Record<ApiDomain, boolean>>;

/** Who reads the inbox, and what they may see. */
export interface InboxReader {
  store: LinkStore & {
    createdAt: Date;
    settings: { currency?: string; timezone?: string; pendingBlocksAvailability?: boolean } | null;
  };
  urls: UrlsPort;
  hostedBy: "lumycloud" | null;
  /** What the caller may read: the member's role cut down to the connection's scopes. */
  reads: InboxRights;
  /**
   * Whose operations show: a connection sees its own (its key), a dashboard
   * session every operation of the store (null).
   */
  operationsOf: string | null;
}

export const mayShow = (reads: InboxRights, type: InboxItemType) =>
  INBOX_ITEM_DOMAINS[type].every((domain) => reads[domain] === true);

// --- Cursor ------------------------------------------------------------------

/** A position in the inbox's order: when, then type, then record. */
interface Position {
  t: number;
  k: string;
  r: string;
}

/** Past every type name: a position at a time with this type covers that whole instant. */
const END_OF_INSTANT = "~";

function comparePositions(a: Position, b: Position) {
  if (a.t !== b.t) return a.t < b.t ? -1 : 1;
  if (a.k !== b.k) return a.k < b.k ? -1 : 1;
  if (a.r !== b.r) return a.r < b.r ? -1 : 1;
  return 0;
}

const encodeCursor = (position: Position) =>
  Buffer.from(JSON.stringify(position)).toString("base64url");

function decodeCursor(raw: string): Position {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw inboxErrors.invalidCursor();
  }
  const { t, k, r } = (parsed ?? {}) as Partial<Position>;
  if (
    typeof t !== "number" ||
    !Number.isSafeInteger(t) ||
    typeof k !== "string" ||
    k.length > 40 ||
    typeof r !== "string" ||
    r.length > 64
  ) {
    throw inboxErrors.invalidCursor();
  }
  return { t, k, r };
}

// --- SQL helpers -------------------------------------------------------------

/** A date as MySQL reads it in a UTC session, to compare with any expression. */
const at = (date: Date) => date.toISOString().slice(0, 23).replace("T", " ");

const binary = (value: SQLWrapper | string) => sql`CAST(${value} AS BINARY)`;

interface Window {
  storeId: string;
  /** The last position read; null from the start. */
  after: Position | null;
  /** Nothing later shows yet. */
  horizon: Date;
  now: Date;
  /** Rows each source reads: one more than the page. */
  take: number;
}

/**
 * The rows of a source the page may hold: after the cursor, not later than
 * the horizon, and not acknowledged by the store.
 */
function inWindow(
  window: Window,
  type: InboxItemType,
  occurred: SQLWrapper,
  recordId: SQLWrapper,
): SQL {
  const conditions: SQL[] = [sql`${occurred} <= ${at(window.horizon)}`];
  const { after } = window;
  if (after) {
    const time = at(new Date(after.t));
    if (type > after.k) conditions.push(sql`${occurred} >= ${time}`);
    else if (type < after.k) conditions.push(sql`${occurred} > ${time}`);
    else {
      conditions.push(
        sql`(${occurred} > ${time} OR (${occurred} = ${time} AND ${binary(recordId)} > ${binary(after.r)}))`,
      );
    }
  }
  conditions.push(
    notExists(
      db
        .select({ one: sql`1` })
        .from(inboxAcknowledgements)
        .where(
          and(
            eq(inboxAcknowledgements.storeId, window.storeId),
            eq(inboxAcknowledgements.itemType, type),
            sql`${inboxAcknowledgements.recordId} = ${recordId}`,
            sql`${inboxAcknowledgements.occurredAt} = ${occurred}`,
          ),
        ),
    ),
  );
  return sql`(${sql.join(conditions, sql` AND `)})`;
}

const inOrder = (occurred: SQLWrapper, recordId: SQLWrapper) => [
  asc(sql`${occurred}`),
  asc(binary(recordId)),
];

// --- Shaping -----------------------------------------------------------------

interface Candidate {
  recordId: string;
  item: InboxItem;
}

const customerNameOf = (
  reader: InboxReader,
  row: { firstName: string | null; lastName: string | null; companyName?: string | null },
) => {
  if (!reader.reads.customers) return null;
  const name =
    row.companyName || [row.firstName, row.lastName].filter(Boolean).join(" ").trim() || null;
  return name;
};

function dayFormatter(timeZone: string | undefined) {
  const options = { day: "numeric", month: "short", year: "numeric" } as const;
  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: timeZone || "UTC" });
  } catch {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" });
  }
}

interface Shaper {
  reader: InboxReader;
  day: (date: Date) => string;
  currency: string;
}

const money = (amount: string | number | null | undefined, currency: string) =>
  amount === null || amount === undefined || amount === ""
    ? null
    : `${typeof amount === "number" ? amount.toFixed(2) : amount} ${currency}`;

interface ReservationRow {
  id: string;
  number: string;
  startDate: Date;
  endDate: Date;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
}

/** The reservation an item is about, and the words that name it in a sentence. */
function aboutReservation(shaper: Shaper, row: ReservationRow) {
  const customerName = customerNameOf(shaper.reader, row);
  const dates = `${shaper.day(row.startDate)} to ${shaper.day(row.endDate)}`;
  return {
    reservation: {
      id: row.id,
      number: row.number,
      startDate: row.startDate,
      endDate: row.endDate,
      customerName,
    },
    name: `reservation ${row.number}${customerName ? ` (${customerName}, ${dates})` : ` (${dates})`}`,
    links: reservationLinks(shaper.reader.urls, shaper.reader.store, row),
  };
}

function candidate(
  type: InboxItemType,
  recordId: string,
  fields: Omit<InboxItem, "id" | "type">,
): Candidate {
  return { recordId, item: { id: `${type}:${recordId}`, type, ...fields } };
}

const reservationColumns = {
  id: reservations.id,
  number: reservations.number,
  startDate: reservations.startDate,
  endDate: reservations.endDate,
  firstName: customers.firstName,
  lastName: customers.lastName,
  companyName: customers.companyName,
};

const RESERVATION_TOOLS = ["reservations_get"];

// --- Sources -----------------------------------------------------------------

type Source = (window: Window, shaper: Shaper) => Promise<Candidate[]>;

/** Pending requests for the store to answer: not a checkout waiting for its payment, not a marketplace hold. */
const bookingRequests: Source = async (window, shaper) => {
  const rows = await db
    .select({ ...reservationColumns, occurredAt: reservations.createdAt })
    .from(reservations)
    .leftJoin(customers, eq(customers.id, reservations.customerId))
    .where(
      and(
        eq(reservations.storeId, window.storeId),
        eq(reservations.status, "pending"),
        sql`COALESCE(${reservations.source}, 'online') <> 'marketplace'`,
        notExists(
          db
            .select({ one: sql`1` })
            .from(payments)
            .where(
              and(
                eq(payments.reservationId, reservations.id),
                eq(payments.type, "rental"),
                eq(payments.method, "stripe"),
                eq(payments.status, "pending"),
                isNotNull(payments.stripeCheckoutSessionId),
              ),
            ),
        ),
        inWindow(window, "booking_request", reservations.createdAt, reservations.id),
      ),
    )
    .orderBy(...inOrder(reservations.createdAt, reservations.id))
    .limit(window.take);

  return rows.map((row) => {
    const about = aboutReservation(shaper, row);
    return candidate("booking_request", row.id, {
      severity: "warning",
      occurredAt: row.occurredAt,
      summary: `The booking request ${about.name} waits for your answer: accept or decline it.`,
      reservation: about.reservation,
      details: { reservationId: row.id, reservationNumber: row.number },
      tools: ["reservations_get", "reservations_update_status"],
      links: about.links,
    });
  });
};

/** A customer's request for another return date, not answered yet. */
const dateChangeRequests: Source = async (window, shaper) => {
  const field = (path: string) =>
    sql`JSON_UNQUOTE(JSON_EXTRACT(${reservationActivity.metadata}, ${path}))`;
  const rows = await db
    .select({
      ...reservationColumns,
      requestId: reservationActivity.id,
      occurredAt: reservationActivity.createdAt,
      metadata: reservationActivity.metadata,
    })
    .from(reservations)
    .innerJoin(reservationActivity, eq(reservationActivity.reservationId, reservations.id))
    .leftJoin(customers, eq(customers.id, reservations.customerId))
    .where(
      and(
        eq(reservations.storeId, window.storeId),
        inArray(reservations.status, ["confirmed", "ongoing"]),
        eq(reservationActivity.activityType, "note_updated"),
        sql`${field("$.kind")} = 'return_date_request'`,
        sql`${field("$.status")} = 'pending'`,
        inWindow(
          window,
          "date_change_request",
          reservationActivity.createdAt,
          reservationActivity.id,
        ),
      ),
    )
    .orderBy(...inOrder(reservationActivity.createdAt, reservationActivity.id))
    .limit(window.take);

  return rows.map((row) => {
    const about = aboutReservation(shaper, row);
    const metadata = row.metadata ?? {};
    const requested =
      typeof metadata.requestedEndDate === "string" ? new Date(metadata.requestedEndDate) : null;
    const reason = typeof metadata.reason === "string" ? metadata.reason : null;
    return candidate("date_change_request", row.requestId, {
      severity: "warning",
      occurredAt: row.occurredAt,
      summary: `The customer of ${about.name} asks to return it on ${
        requested && !Number.isNaN(requested.getTime()) ? shaper.day(requested) : "another date"
      }: accept or decline the request in Louez.`,
      reservation: about.reservation,
      details: {
        reservationId: row.id,
        reservationNumber: row.number,
        requestId: row.requestId,
        originalEndDate:
          typeof metadata.originalEndDate === "string" ? metadata.originalEndDate : null,
        requestedEndDate:
          typeof metadata.requestedEndDate === "string" ? metadata.requestedEndDate : null,
        // The customer's own words may name them.
        reason: shaper.reader.reads.customers ? reason : null,
      },
      tools: RESERVATION_TOOLS,
      links: about.links,
    });
  });
};

/** A confirmed reservation past its start, not marked picked up. */
const latePickups: Source = async (window, shaper) => {
  // Late from its start, or from when it became confirmed or went back to it.
  const occurred =
    sql<Date>`GREATEST(${reservations.startDate}, COALESCE(${reservations.billableAt}, ${reservations.createdAt}), COALESCE(${reservations.pickedUpAt}, ${reservations.createdAt}))`.mapWith(
      reservations.startDate,
    );
  const rows = await db
    .select({ ...reservationColumns, occurredAt: occurred })
    .from(reservations)
    .leftJoin(customers, eq(customers.id, reservations.customerId))
    .where(
      and(
        eq(reservations.storeId, window.storeId),
        eq(reservations.status, "confirmed"),
        gt(reservations.endDate, new Date(window.now.getTime() - STALE_PICKUP_DAYS * DAY_MS)),
        inWindow(window, "pickup_overdue", occurred, reservations.id),
      ),
    )
    .orderBy(...inOrder(occurred, reservations.id))
    .limit(window.take);

  return rows.map((row) => {
    const about = aboutReservation(shaper, row);
    const hoursLate = Math.max(
      0,
      Math.floor((window.now.getTime() - row.startDate.getTime()) / 3_600_000),
    );
    return candidate("pickup_overdue", row.id, {
      severity: "warning",
      occurredAt: row.occurredAt,
      summary: `${capitalize(about.name)} started on ${shaper.day(row.startDate)} and is not marked picked up: mark it picked up, or cancel it if the customer did not come.`,
      reservation: about.reservation,
      details: {
        reservationId: row.id,
        reservationNumber: row.number,
        startDate: row.startDate.toISOString(),
        hoursLate,
      },
      tools: ["reservations_get", "reservations_update_status", "reservations_cancel"],
      links: about.links,
    });
  });
};

/** An ongoing reservation past its end, not marked returned. */
const lateReturns: Source = async (window, shaper) => {
  const occurred =
    sql<Date>`GREATEST(${reservations.endDate}, COALESCE(${reservations.pickedUpAt}, ${reservations.createdAt}), COALESCE(${reservations.returnedAt}, ${reservations.createdAt}))`.mapWith(
      reservations.endDate,
    );
  const rows = await db
    .select({ ...reservationColumns, occurredAt: occurred })
    .from(reservations)
    .leftJoin(customers, eq(customers.id, reservations.customerId))
    .where(
      and(
        eq(reservations.storeId, window.storeId),
        eq(reservations.status, "ongoing"),
        inWindow(window, "return_overdue", occurred, reservations.id),
      ),
    )
    .orderBy(...inOrder(occurred, reservations.id))
    .limit(window.take);

  return rows.map((row) => {
    const about = aboutReservation(shaper, row);
    const lateMs = window.now.getTime() - row.endDate.getTime();
    return candidate("return_overdue", row.id, {
      severity: lateMs >= DAY_MS ? "critical" : "warning",
      occurredAt: row.occurredAt,
      summary: `${capitalize(about.name)} was due back on ${shaper.day(row.endDate)} and is not marked returned: contact the customer, or mark it returned.`,
      reservation: about.reservation,
      details: {
        reservationId: row.id,
        reservationNumber: row.number,
        endDate: row.endDate.toISOString(),
        daysLate: Math.max(0, Math.ceil(lateMs / DAY_MS)),
      },
      tools: ["reservations_get", "reservations_update_status"],
      links: about.links,
    });
  });
};

/** A deposit hold that expires soon, or has expired, on a reservation still open. */
const expiringDeposits: Source = async (window, shaper) => {
  const occurred =
    sql<Date>`${reservations.depositAuthorizationExpiresAt} - INTERVAL ${sql.raw(String(DEPOSIT_NOTICE_HOURS))} HOUR`.mapWith(
      reservations.startDate,
    );
  const rows = await db
    .select({
      ...reservationColumns,
      occurredAt: occurred,
      expiresAt: reservations.depositAuthorizationExpiresAt,
      depositAmount: reservations.depositAmount,
      currency: reservations.currency,
    })
    .from(reservations)
    .leftJoin(customers, eq(customers.id, reservations.customerId))
    .where(
      and(
        eq(reservations.storeId, window.storeId),
        inArray(reservations.status, ["pending", "confirmed", "ongoing"]),
        eq(reservations.depositStatus, "authorized"),
        isNotNull(reservations.depositAuthorizationExpiresAt),
        inWindow(window, "deposit_expiring", occurred, reservations.id),
      ),
    )
    .orderBy(...inOrder(occurred, reservations.id))
    .limit(window.take);

  return rows.flatMap((row) => {
    if (!row.expiresAt) return [];
    const about = aboutReservation(shaper, row);
    const expired = row.expiresAt.getTime() <= window.now.getTime();
    const amount = money(row.depositAmount, row.currency ?? shaper.currency);
    return [
      candidate("deposit_expiring", row.id, {
        severity: expired ? "critical" : "warning",
        occurredAt: row.occurredAt,
        summary: expired
          ? `The deposit hold${amount ? ` of ${amount}` : ""} on ${about.name} expired on ${shaper.day(row.expiresAt)}: the card is no longer held.`
          : `The deposit hold${amount ? ` of ${amount}` : ""} on ${about.name} expires on ${shaper.day(row.expiresAt)}: capture or release it in Louez before then.`,
        reservation: about.reservation,
        details: {
          reservationId: row.id,
          reservationNumber: row.number,
          expiresAt: row.expiresAt.toISOString(),
          amount: row.depositAmount,
          currency: row.currency ?? shaper.currency,
          expired,
        },
        tools: RESERVATION_TOOLS,
        links: about.links,
      }),
    ];
  });
};

/**
 * The latest failed online payment or deposit hold of an open reservation,
 * when nothing made it good since: a payment received or recorded after a
 * failed payment, a deposit that is no longer failed.
 */
const failedPayments: Source = async (window, shaper) => {
  const later = alias(reservationActivity, "inbox_later_activity");
  const paid = alias(reservationActivity, "inbox_paid_activity");
  const rows = await db
    .select({
      ...reservationColumns,
      activityId: reservationActivity.id,
      activityType: reservationActivity.activityType,
      occurredAt: reservationActivity.createdAt,
      metadata: reservationActivity.metadata,
      currency: reservations.currency,
    })
    .from(reservations)
    .innerJoin(reservationActivity, eq(reservationActivity.reservationId, reservations.id))
    .leftJoin(customers, eq(customers.id, reservations.customerId))
    .where(
      and(
        eq(reservations.storeId, window.storeId),
        inArray(reservations.status, ["pending", "quote", "confirmed", "ongoing"]),
        inArray(reservationActivity.activityType, ["payment_failed", "deposit_failed"]),
        gt(
          reservationActivity.createdAt,
          new Date(window.now.getTime() - PAYMENT_FAILURE_DAYS * DAY_MS),
        ),
        // The latest failure of its kind only: a customer who tried three times is one item.
        notExists(
          db
            .select({ one: sql`1` })
            .from(later)
            .where(
              and(
                eq(later.reservationId, reservations.id),
                eq(later.activityType, reservationActivity.activityType),
                or(
                  gt(later.createdAt, reservationActivity.createdAt),
                  and(
                    eq(later.createdAt, reservationActivity.createdAt),
                    gt(binary(later.id), binary(reservationActivity.id)),
                  ),
                ),
              ),
            ),
        ),
        or(
          and(
            eq(reservationActivity.activityType, "payment_failed"),
            notExists(
              db
                .select({ one: sql`1` })
                .from(paid)
                .where(
                  and(
                    eq(paid.reservationId, reservations.id),
                    inArray(paid.activityType, ["payment_received", "payment_added"]),
                    sql`${paid.createdAt} >= ${reservationActivity.createdAt}`,
                  ),
                ),
            ),
          ),
          and(
            eq(reservationActivity.activityType, "deposit_failed"),
            eq(reservations.depositStatus, "failed"),
          ),
        ),
        inWindow(window, "payment_failed", reservationActivity.createdAt, reservationActivity.id),
      ),
    )
    .orderBy(...inOrder(reservationActivity.createdAt, reservationActivity.id))
    .limit(window.take);

  return rows.map((row) => {
    const about = aboutReservation(shaper, row);
    const metadata = row.metadata ?? {};
    const deposit = row.activityType === "deposit_failed";
    const currency =
      typeof metadata.currency === "string" ? metadata.currency : (row.currency ?? shaper.currency);
    const rawAmount = metadata.amount;
    const decimal =
      typeof rawAmount === "number"
        ? rawAmount.toFixed(2)
        : typeof rawAmount === "string"
          ? rawAmount
          : null;
    const amount = money(decimal, currency);
    const reason = typeof metadata.error === "string" ? metadata.error : null;
    return candidate("payment_failed", row.activityId, {
      severity: "warning",
      occurredAt: row.occurredAt,
      summary: deposit
        ? `The deposit hold${amount ? ` of ${amount}` : ""} on ${about.name} failed: no deposit is secured.`
        : `An online payment${amount ? ` of ${amount}` : ""} for ${about.name} failed and nothing was paid since.`,
      reservation: about.reservation,
      details: {
        reservationId: row.id,
        reservationNumber: row.number,
        kind: deposit ? "deposit" : "rental",
        amount: decimal,
        currency,
        reason,
        declineCode: typeof metadata.declineCode === "string" ? metadata.declineCode : null,
      },
      tools: deposit ? RESERVATION_TOOLS : ["reservations_get", "record_payment"],
      links: about.links,
    });
  });
};

const DISPUTE_NEEDS_RESPONSE = ["needs_response", "warning_needs_response"];

/** A Stripe dispute that is not closed. */
const openDisputes: Source = async (window, shaper) => {
  const occurred =
    sql<Date>`COALESCE(${paymentDisputes.openedAt}, ${paymentDisputes.createdAt})`.mapWith(
      paymentDisputes.createdAt,
    );
  const rows = await db
    .select({
      ...reservationColumns,
      disputeId: paymentDisputes.id,
      occurredAt: occurred,
      amountMinor: paymentDisputes.amountMinor,
      disputeCurrency: paymentDisputes.currency,
      stripeStatus: paymentDisputes.stripeStatus,
    })
    .from(paymentDisputes)
    .innerJoin(reservations, eq(reservations.id, paymentDisputes.reservationId))
    .leftJoin(customers, eq(customers.id, reservations.customerId))
    .where(
      and(
        eq(reservations.storeId, window.storeId),
        eq(paymentDisputes.status, "open"),
        inWindow(window, "dispute_open", occurred, paymentDisputes.id),
      ),
    )
    .orderBy(...inOrder(occurred, paymentDisputes.id))
    .limit(window.take);

  return rows.map((row) => {
    const about = aboutReservation(shaper, row);
    const currency = row.disputeCurrency.toUpperCase();
    const amount = minorToDecimal(row.amountMinor, currency);
    const needsResponse = DISPUTE_NEEDS_RESPONSE.includes(row.stripeStatus);
    return candidate("dispute_open", row.disputeId, {
      severity: needsResponse ? "critical" : "warning",
      occurredAt: row.occurredAt,
      summary: needsResponse
        ? `The customer of ${about.name} disputed a payment of ${amount} ${currency}: answer the dispute in your Stripe dashboard before Stripe's deadline.`
        : `A dispute of ${amount} ${currency} on ${about.name} is open: Stripe is reviewing it.`,
      reservation: about.reservation,
      details: {
        reservationId: row.id,
        reservationNumber: row.number,
        disputeId: row.disputeId,
        amount,
        currency,
        stripeStatus: row.stripeStatus,
      },
      tools: RESERVATION_TOOLS,
      links: about.links,
    });
  });
};

/**
 * A booking that holds a unit retired, or out of service over its dates, as
 * the product page flags it: the booking needs another unit.
 */
const unitConflicts: Source = async (window, shaper) => {
  const now = at(window.now);
  const downtimeChanged = sql`(SELECT MAX(${productUnitDowntimes.updatedAt}) FROM ${productUnitDowntimes} WHERE ${productUnitDowntimes.productUnitId} = ${reservationItemUnits.productUnitId} AND ${productUnitDowntimes.storeId} = ${window.storeId} AND (${productUnitDowntimes.endsAt} IS NULL OR ${productUnitDowntimes.endsAt} > ${now}) AND ${productUnitDowntimes.startsAt} < ${reservations.endDate} AND (${productUnitDowntimes.endsAt} IS NULL OR ${productUnitDowntimes.endsAt} > ${reservations.startDate}))`;
  const retired = sql`${productUnits.lifecycleStatus} = 'retired'`;
  const cause = sql`COALESCE(CASE WHEN ${retired} THEN COALESCE(${productUnits.retiredAt}, ${productUnits.updatedAt}) END, ${downtimeChanged})`;
  // From when both the assignment and its cause existed.
  const occurred = sql<Date>`GREATEST(${reservationItemUnits.assignedAt}, ${cause})`.mapWith(
    reservations.startDate,
  );
  const statuses = getBlockingReservationStatuses(
    shaper.reader.store.settings?.pendingBlocksAvailability ?? true,
  );
  const rows = await db
    .select({
      ...reservationColumns,
      assignmentId: reservationItemUnits.id,
      occurredAt: occurred,
      unitId: productUnits.id,
      unitIdentifier: productUnits.identifier,
      retired: sql<number>`${retired}`.mapWith(Number),
      productId: products.id,
      productName: products.name,
    })
    .from(reservationItemUnits)
    .innerJoin(reservationItems, eq(reservationItems.id, reservationItemUnits.reservationItemId))
    .innerJoin(reservations, eq(reservations.id, reservationItems.reservationId))
    .innerJoin(productUnits, eq(productUnits.id, reservationItemUnits.productUnitId))
    .innerJoin(products, eq(products.id, productUnits.productId))
    .leftJoin(customers, eq(customers.id, reservations.customerId))
    .where(
      and(
        eq(reservations.storeId, window.storeId),
        eq(products.storeId, window.storeId),
        inArray(reservations.status, statuses),
        gt(reservations.endDate, window.now),
        sql`${cause} IS NOT NULL`,
        inWindow(window, "unit_conflict", occurred, reservationItemUnits.id),
      ),
    )
    .orderBy(...inOrder(occurred, reservationItemUnits.id))
    .limit(window.take);

  return rows.map((row) => {
    const about = aboutReservation(shaper, row);
    const isRetired = row.retired === 1;
    return candidate("unit_conflict", row.assignmentId, {
      severity: "warning",
      occurredAt: row.occurredAt,
      summary: `${capitalize(about.name)} holds unit ${row.unitIdentifier} of ${row.productName}, which is ${
        isRetired ? "retired" : "out of service over its dates"
      }: move the booking to another unit in Louez${isRetired ? "" : ", or shorten the downtime"}.`,
      reservation: about.reservation,
      details: {
        reservationId: row.id,
        reservationNumber: row.number,
        productId: row.productId,
        unitId: row.unitId,
        unitIdentifier: row.unitIdentifier,
        reason: isRetired ? "retired" : "downtime",
      },
      tools: isRetired
        ? ["reservations_get", "products_get_unit_history", "products_reinstate_unit"]
        : [
            "reservations_get",
            "products_get_unit_history",
            "products_update_downtime",
            "products_close_downtime",
          ],
      links: about.links,
    });
  });
};

/** A booking the team created over the available stock, not over yet. */
const overbookings: Source = async (window, shaper) => {
  const rows = await db
    .select({
      ...reservationColumns,
      occurredAt: reservationActivity.createdAt,
      metadata: reservationActivity.metadata,
    })
    .from(reservations)
    .innerJoin(reservationActivity, eq(reservationActivity.reservationId, reservations.id))
    .leftJoin(customers, eq(customers.id, reservations.customerId))
    .where(
      and(
        eq(reservations.storeId, window.storeId),
        inArray(reservations.status, ["pending", "quote", "confirmed", "ongoing"]),
        gt(reservations.endDate, window.now),
        eq(reservationActivity.activityType, "created"),
        sql`JSON_EXTRACT(${reservationActivity.metadata}, '$.overbooked') = CAST('true' AS JSON)`,
        inWindow(window, "overbooking", reservationActivity.createdAt, reservations.id),
      ),
    )
    .orderBy(...inOrder(reservationActivity.createdAt, reservations.id))
    .limit(window.take);

  return rows.map((row) => {
    const about = aboutReservation(shaper, row);
    const shortfalls = row.metadata?.overbookingShortfalls;
    return candidate("overbooking", row.id, {
      severity: "warning",
      occurredAt: row.occurredAt,
      summary: `${capitalize(about.name)} was booked over the available stock: free up stock or change the booking before it starts.`,
      reservation: about.reservation,
      details: {
        reservationId: row.id,
        reservationNumber: row.number,
        productsShort: Array.isArray(shortfalls) ? shortfalls.length : null,
      },
      tools: ["reservations_get", "reservations_get_planning_timeline"],
      links: about.links,
    });
  });
};

/** A supplier invoice received through electronic invoicing, not handled yet. */
const supplierInvoices: Source = async (window, shaper) => {
  const rows = await db
    .select({
      id: receivedInvoices.id,
      occurredAt: receivedInvoices.createdAt,
      sellerName: receivedInvoices.sellerName,
      number: receivedInvoices.number,
      issueDate: receivedInvoices.issueDate,
      totalInclTax: receivedInvoices.totalInclTax,
      currency: receivedInvoices.currency,
    })
    .from(receivedInvoices)
    .where(
      and(
        eq(receivedInvoices.storeId, window.storeId),
        eq(receivedInvoices.ourAction, "none"),
        exists(
          db
            .select({ one: sql`1` })
            .from(storeIntegrations)
            .where(
              and(
                eq(storeIntegrations.storeId, window.storeId),
                eq(storeIntegrations.providerKey, "superpdp"),
              ),
            ),
        ),
        inWindow(window, "supplier_invoice", receivedInvoices.createdAt, receivedInvoices.id),
      ),
    )
    .orderBy(...inOrder(receivedInvoices.createdAt, receivedInvoices.id))
    .limit(window.take);

  return rows.map((row) => {
    const currency = row.currency ?? shaper.currency;
    const amount = money(row.totalInclTax, currency);
    return candidate("supplier_invoice", row.id, {
      severity: "info",
      occurredAt: row.occurredAt,
      summary: `Supplier invoice${row.number ? ` ${row.number}` : ""}${row.sellerName ? ` from ${row.sellerName}` : ""}${amount ? ` (${amount})` : ""} arrived: accept, refuse or acknowledge it in Louez.`,
      reservation: null,
      details: {
        invoiceId: row.id,
        number: row.number,
        sellerName: row.sellerName,
        issueDate: row.issueDate,
        totalInclTax: row.totalInclTax,
        currency,
      },
      tools: [],
      links: dashboardPageLinks(
        shaper.reader.urls,
        shaper.reader.store,
        "/dashboard/purchase-invoices",
      ),
    });
  });
};

/** A customer invoice the e-invoicing network rejected, or that never reached it. */
const rejectedEinvoices: Source = async (window, shaper) => {
  const rows = await db
    .select({
      invoiceId: invoices.id,
      invoiceNumber: invoices.number,
      occurredAt: invoices.updatedAt,
      transmissionStatus: invoices.transmissionStatus,
      ...reservationColumns,
    })
    .from(invoices)
    .innerJoin(reservations, eq(reservations.id, invoices.reservationId))
    .leftJoin(customers, eq(customers.id, reservations.customerId))
    .where(
      and(
        eq(invoices.storeId, window.storeId),
        eq(reservations.storeId, window.storeId),
        or(
          eq(invoices.transmissionStatus, "rejected"),
          and(eq(invoices.transmissionStatus, "failed"), isNull(invoices.nextAttemptAt)),
        ),
        gt(invoices.updatedAt, new Date(window.now.getTime() - EINVOICE_DAYS * DAY_MS)),
        inWindow(window, "einvoice_rejected", invoices.updatedAt, invoices.id),
      ),
    )
    .orderBy(...inOrder(invoices.updatedAt, invoices.id))
    .limit(window.take);

  return rows.map((row) => {
    const about = aboutReservation(shaper, row);
    const rejected = row.transmissionStatus === "rejected";
    return candidate("einvoice_rejected", row.invoiceId, {
      severity: "warning",
      occurredAt: row.occurredAt,
      summary: rejected
        ? `Invoice ${row.invoiceNumber} for ${about.name} was rejected by the e-invoicing network: check it in Louez.`
        : `Invoice ${row.invoiceNumber} for ${about.name} could not be sent to the e-invoicing network after every try: check it in Louez.`,
      reservation: about.reservation,
      details: {
        reservationId: row.id,
        reservationNumber: row.number,
        invoiceId: row.invoiceId,
        invoiceNumber: row.invoiceNumber,
        transmissionStatus: row.transmissionStatus,
      },
      tools: RESERVATION_TOOLS,
      links: about.links,
    });
  });
};

const MESSAGE_TYPES = ["reservation.customerMessage", "reservation.storeNotification"] as const;

const MESSAGE_LABELS: Record<string, string> = {
  customer_request_accepted: "acceptance message",
  customer_request_rejected: "rejection message",
};

/** A message to a customer, or a store notification, the outbox gave up on. */
const unsentMessages: Source = async (window, shaper) => {
  const rows = await db
    .select({
      effectId: apiEffects.id,
      type: apiEffects.type,
      payload: apiEffects.payload,
      // An abandoned row's next attempt is the time it was abandoned (platform/effects.ts).
      occurredAt: apiEffects.nextAttemptAt,
      reservationId: reservations.id,
      number: reservations.number,
      startDate: reservations.startDate,
      endDate: reservations.endDate,
      firstName: customers.firstName,
      lastName: customers.lastName,
      companyName: customers.companyName,
    })
    .from(apiEffects)
    .leftJoin(
      reservations,
      and(eq(reservations.id, apiEffects.reservationId), eq(reservations.storeId, window.storeId)),
    )
    .leftJoin(customers, eq(customers.id, reservations.customerId))
    .where(
      and(
        eq(apiEffects.storeId, window.storeId),
        eq(apiEffects.status, "abandoned"),
        inArray(apiEffects.type, [...MESSAGE_TYPES]),
        inWindow(window, "message_not_sent", apiEffects.nextAttemptAt, apiEffects.id),
      ),
    )
    .orderBy(...inOrder(apiEffects.nextAttemptAt, apiEffects.id))
    .limit(window.take);

  return rows.map((row) => {
    const payload = row.payload ?? {};
    const channel = typeof payload.channel === "string" ? payload.channel : null;
    const toCustomer = row.type === "reservation.customerMessage";
    const notification = typeof payload.notification === "string" ? payload.notification : null;
    const about =
      row.reservationId && row.number && row.startDate && row.endDate
        ? aboutReservation(shaper, {
            id: row.reservationId,
            number: row.number,
            startDate: row.startDate,
            endDate: row.endDate,
            firstName: row.firstName,
            lastName: row.lastName,
            companyName: row.companyName,
          })
        : null;
    const what = toCustomer
      ? `The ${(notification && MESSAGE_LABELS[notification]) ?? "message"}${channel ? ` (${channel})` : ""} to the customer`
      : `The store notification${channel ? ` (${channel})` : ""}`;
    return candidate("message_not_sent", row.effectId, {
      severity: toCustomer ? "warning" : "info",
      occurredAt: row.occurredAt,
      summary: `${what}${about ? ` of ${about.name}` : ""} never went out after every try${
        toCustomer ? ": contact the customer yourself" : ""
      }.`,
      reservation: about?.reservation ?? null,
      details: {
        effectId: row.effectId,
        audience: toCustomer ? "customer" : "store",
        channel,
        notification: toCustomer
          ? notification
          : typeof payload.event === "string"
            ? payload.event
            : null,
        reservationId: row.reservationId,
        reservationNumber: row.number,
      },
      tools: about ? RESERVATION_TOOLS : [],
      links: about?.links ?? storeLinks(shaper.reader.urls, shaper.reader.store),
    });
  });
};

/**
 * A write whose outcome is unknown: it went through but could not be
 * recorded, or it stayed running past its lease (platform/operations.ts).
 */
const unknownOperations: Source = async (window, shaper) => {
  const lease = sql.raw(String(OPERATION_LEASE_SECONDS));
  const occurred =
    sql<Date>`CASE WHEN ${apiOperations.status} = 'unknown' THEN ${apiOperations.updatedAt} ELSE ${apiOperations.updatedAt} + INTERVAL ${lease} SECOND END`.mapWith(
      apiOperations.updatedAt,
    );
  const { operationsOf } = shaper.reader;
  const rows = await db
    .select({
      id: apiOperations.id,
      occurredAt: occurred,
      procedure: apiOperations.procedure,
      clientName: apiOperations.clientName,
      transport: apiOperations.transport,
      targetId: apiOperations.targetId,
      createdAt: apiOperations.createdAt,
    })
    .from(apiOperations)
    .where(
      and(
        eq(apiOperations.storeId, window.storeId),
        gt(apiOperations.createdAt, new Date(window.now.getTime() - OPERATION_DAYS * DAY_MS)),
        or(
          eq(apiOperations.status, "unknown"),
          and(
            eq(apiOperations.status, "running"),
            lt(
              apiOperations.updatedAt,
              new Date(window.now.getTime() - OPERATION_LEASE_SECONDS * 1000),
            ),
          ),
        ),
        operationsOf === null ? undefined : eq(apiOperations.actorKey, operationsOf),
        inWindow(window, "operation_unknown", occurred, apiOperations.id),
      ),
    )
    .orderBy(...inOrder(occurred, apiOperations.id))
    .limit(window.take);

  return rows.map((row) =>
    candidate("operation_unknown", row.id, {
      severity: "warning",
      occurredAt: row.occurredAt,
      summary: `A call to ${row.procedure}${row.clientName ? ` by ${row.clientName}` : ""} on ${shaper.day(row.createdAt)} may or may not have gone through: check the record before you try again.`,
      reservation: null,
      details: {
        operationId: row.id,
        procedure: row.procedure,
        clientName: row.clientName,
        transport: row.transport,
        targetId: row.targetId,
      },
      tools: [],
      links: operationLinks(shaper, row.procedure, row.targetId),
    }),
  );
};

/** The page of the record an operation touched, when it names one. */
function operationLinks(shaper: Shaper, procedure: string, targetId: string | null): ResourceLinks {
  const { urls, store } = shaper.reader;
  if (targetId && procedure.startsWith("dashboard.reservations.")) {
    return reservationLinks(urls, store, { id: targetId });
  }
  if (targetId && procedure.startsWith("dashboard.products.")) {
    return productLinks(urls, store, { id: targetId });
  }
  return storeLinks(urls, store);
}

const GATE_SUMMARIES: Record<ReservationGateReason, string> = {
  payment_method_required:
    "Louez billing stops new bookings until you add a payment card in the billing page.",
  payment_overdue:
    "Louez billing stops new bookings until the overdue fees are paid in the billing page.",
  suspended: "The store is suspended: new bookings are stopped. See the billing page.",
  balance_limit_reached:
    "Louez billing stops new bookings: the unpaid fees reached their limit. Pay them in the billing page.",
};

/** Louez billing refuses new bookings (the card gate): only the owner fixes it, in Louez. */
const closedGate = async (window: Window, shaper: Shaper): Promise<Candidate[]> => {
  const gate = await readReservationGateSince(db, window.storeId, window.now);
  if (gate.accepts || !gate.since) return [];
  const { store, urls } = shaper.reader;
  return [
    candidate("billing_gate_closed", store.id, {
      severity: "critical",
      occurredAt: gate.since,
      summary: GATE_SUMMARIES[gate.reason],
      reservation: null,
      details: { reason: gate.reason },
      tools: [],
      links: dashboardPageLinks(urls, store, "/dashboard/settings/billing"),
    }),
  ];
};

/** The store is not online yet, with what its launch still requires. */
const offlineStore = async (window: Window, shaper: Shaper): Promise<Candidate[]> => {
  const { store, urls, hostedBy } = shaper.reader;
  if (store.onboardingCompleted === true) return [];
  const checklist = await getLaunchChecklist(window.storeId, {
    urls,
    withMilestones: false,
    hostedBy,
  });
  if (checklist.online) return [];
  const blocking = checklist.items.filter((item) => checklist.blocking.includes(item.key));
  return [
    candidate("store_not_live", store.id, {
      severity: blocking.length > 0 ? "warning" : "info",
      occurredAt: store.createdAt,
      summary:
        blocking.length > 0
          ? `The store is not online yet, and its launch still requires: ${blocking.map((item) => item.title).join(", ")}.`
          : "The store is not online yet: customers cannot book. Read its launch checklist, then put it online.",
      reservation: null,
      details: {
        canGoLive: checklist.canGoLive,
        blocking: checklist.blocking.join(",") || null,
      },
      tools: ["stores_get_launch_checklist", "stores_go_live"],
      links: checklist.links,
    }),
  ];
};

const SOURCES: Record<InboxItemType, Source> = {
  booking_request: bookingRequests,
  date_change_request: dateChangeRequests,
  pickup_overdue: latePickups,
  return_overdue: lateReturns,
  deposit_expiring: expiringDeposits,
  payment_failed: failedPayments,
  dispute_open: openDisputes,
  unit_conflict: unitConflicts,
  overbooking: overbookings,
  supplier_invoice: supplierInvoices,
  einvoice_rejected: rejectedEinvoices,
  billing_gate_closed: closedGate,
  store_not_live: offlineStore,
  message_not_sent: unsentMessages,
  operation_unknown: unknownOperations,
};

/** Sources computed in code, filtered on the window here rather than in SQL. */
const COMPUTED: ReadonlySet<InboxItemType> = new Set(["billing_gate_closed", "store_not_live"]);

// --- Reading -----------------------------------------------------------------

const positionOf = (entry: Candidate): Position => ({
  t: entry.item.occurredAt.getTime(),
  k: entry.item.type,
  r: entry.recordId,
});

/** The database's clock, as every row is dated with it. */
async function databaseNow(): Promise<Date> {
  const [result] = await db.execute(sql`SELECT DATE_FORMAT(NOW(3), '%Y-%m-%dT%H:%i:%s.%f') AS now`);
  const row: unknown = Array.isArray(result) ? result[0] : undefined;
  const text =
    row && typeof row === "object" && "now" in row && typeof row.now === "string" ? row.now : "";
  // The sessions run in UTC (docs/architecture/api-and-agents.md, the outbox).
  const now = new Date(`${text.slice(0, 23)}Z`);
  return Number.isNaN(now.getTime()) ? new Date() : now;
}

/** The computed items the store acknowledged, out of `entries`. */
async function dropAcknowledged(storeId: string, entries: Candidate[]): Promise<Candidate[]> {
  if (entries.length === 0) return entries;
  const acknowledged = await db
    .select({
      itemType: inboxAcknowledgements.itemType,
      recordId: inboxAcknowledgements.recordId,
      occurredAt: inboxAcknowledgements.occurredAt,
    })
    .from(inboxAcknowledgements)
    .where(
      and(
        eq(inboxAcknowledgements.storeId, storeId),
        inArray(
          inboxAcknowledgements.itemType,
          entries.map((entry) => entry.item.type),
        ),
        inArray(
          inboxAcknowledgements.recordId,
          entries.map((entry) => entry.recordId),
        ),
      ),
    );
  const keys = new Set(
    acknowledged.map((row) => `${row.itemType}:${row.recordId}@${row.occurredAt.getTime()}`),
  );
  return entries.filter(
    (entry) => !keys.has(`${entry.item.id}@${entry.item.occurredAt.getTime()}`),
  );
}

/**
 * One page of the inbox after the cursor, oldest first. Each source reads at
 * most a page and one row, in the inbox's order, so the merged page is exact.
 * Without more to read, the next cursor stands at the horizon: everything up
 * to it was read, and the next call returns only what entered after.
 */
export async function listInbox(
  reader: InboxReader,
  input: ListInboxInput,
  /** `now`: a clock for tests, in place of the database's. */
  options: { now?: Date } = {},
) {
  const limit = input.limit ?? INBOX_PAGE_DEFAULT;
  const after = input.cursor ? decodeCursor(input.cursor) : null;
  const now = options.now ?? (await databaseNow());
  const window: Window = {
    storeId: reader.store.id,
    after,
    horizon: new Date(now.getTime() - INBOX_HOLD_BACK_MS),
    now,
    take: limit + 1,
  };
  const shaper: Shaper = {
    reader,
    day: (() => {
      const format = dayFormatter(reader.store.settings?.timezone);
      return (date: Date) => format.format(date);
    })(),
    currency: reader.store.settings?.currency ?? "EUR",
  };

  const types = INBOX_ITEM_TYPES.filter((type) => mayShow(reader.reads, type));
  const read = await Promise.all(types.map((type) => SOURCES[type](window, shaper)));

  const inSqlWindow: Candidate[] = [];
  const computed: Candidate[] = [];
  types.forEach((type, index) => {
    (COMPUTED.has(type) ? computed : inSqlWindow).push(...(read[index] ?? []));
  });
  const horizon = window.horizon.getTime();
  const computedInWindow = await dropAcknowledged(
    window.storeId,
    computed.filter((entry) => {
      const position = positionOf(entry);
      return position.t <= horizon && (!after || comparePositions(position, after) > 0);
    }),
  );

  const merged = [...inSqlWindow, ...computedInWindow].sort((a, b) =>
    comparePositions(positionOf(a), positionOf(b)),
  );
  const page = merged.slice(0, limit);
  const hasMore = merged.length > limit;
  const last = page.at(-1);

  let next: Position;
  if (hasMore && last) next = positionOf(last);
  else {
    const atHorizon: Position = { t: horizon, k: END_OF_INSTANT, r: "" };
    next = after && comparePositions(after, atHorizon) > 0 ? after : atHorizon;
  }
  return { items: page.map((entry) => entry.item), nextCursor: encodeCursor(next), hasMore };
}

// --- Acknowledging -----------------------------------------------------------

/** Who acknowledges: the actor and what it may write. */
export interface InboxAcknowledger {
  storeId: string;
  userId: string;
  credentialId: string | null;
  clientName: string | null;
  /** May the caller see this type, and change its first domain? */
  may: (type: InboxItemType) => boolean;
}

const isItemType = (value: string): value is InboxItemType =>
  (INBOX_ITEM_TYPES as readonly string[]).includes(value);

function parseItemId(id: string): { type: InboxItemType; recordId: string } {
  const separator = id.indexOf(":");
  const type = separator > 0 ? id.slice(0, separator) : "";
  const recordId = separator > 0 ? id.slice(separator + 1) : "";
  if (!isItemType(type) || recordId.length === 0 || recordId.length > 64) {
    throw inboxErrors.invalidItem(id);
  }
  return { type, recordId };
}

/**
 * Marks items as handled for the whole store: they leave its inbox for every
 * member and agent, until the same record comes back with a new occurredAt.
 * Marking an item twice is a no-op.
 */
export async function acknowledgeInbox(
  actor: InboxAcknowledger,
  input: { items: ReadonlyArray<{ id: string; occurredAt: Date }> },
) {
  const unique = new Map<string, { type: InboxItemType; recordId: string; occurredAt: Date }>();
  for (const entry of input.items) {
    const parsed = parseItemId(entry.id);
    if (Number.isNaN(entry.occurredAt.getTime())) throw inboxErrors.invalidItem(entry.id);
    if (!actor.may(parsed.type)) {
      const [first = "reservations"] = INBOX_ITEM_DOMAINS[parsed.type];
      throw platformErrors.permissionDenied(`${first}:write`);
    }
    unique.set(`${entry.id}@${entry.occurredAt.getTime()}`, {
      ...parsed,
      occurredAt: entry.occurredAt,
    });
  }
  const rows = [...unique.values()];

  const existing = await db
    .select({
      itemType: inboxAcknowledgements.itemType,
      recordId: inboxAcknowledgements.recordId,
      occurredAt: inboxAcknowledgements.occurredAt,
    })
    .from(inboxAcknowledgements)
    .where(
      and(
        eq(inboxAcknowledgements.storeId, actor.storeId),
        inArray(
          inboxAcknowledgements.recordId,
          rows.map((row) => row.recordId),
        ),
      ),
    );
  const done = new Set(
    existing.map((row) => `${row.itemType}:${row.recordId}@${row.occurredAt.getTime()}`),
  );
  const fresh = rows.filter(
    (row) => !done.has(`${row.type}:${row.recordId}@${row.occurredAt.getTime()}`),
  );
  if (fresh.length > 0) {
    await db
      .insert(inboxAcknowledgements)
      .values(
        fresh.map((row) => ({
          storeId: actor.storeId,
          itemType: row.type,
          recordId: row.recordId,
          occurredAt: row.occurredAt,
          userId: actor.userId,
          credentialId: actor.credentialId,
          clientName: actor.clientName,
        })),
      )
      // Two calls at once: the unique occurrence keeps the first.
      .onDuplicateKeyUpdate({ set: { storeId: sql`${inboxAcknowledgements.storeId}` } });
  }
  return { acknowledged: fresh.length, alreadyAcknowledged: rows.length - fresh.length };
}

// --- Words -------------------------------------------------------------------

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** A minor-unit amount as a decimal string, with the currency's own decimals (none for JPY). */
function minorToDecimal(amountMinor: number | bigint, currency: string) {
  let digits = 2;
  try {
    digits =
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
  } catch {
    // An unknown code: two decimals, as most currencies.
  }
  return (Number(amountMinor) / 10 ** digits).toFixed(digits);
}
