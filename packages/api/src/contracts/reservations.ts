import { CONTRACT_SIGNATURE_METHODS } from "@louez/db/schema";
import { z } from "zod";

import { answerPageInput } from "../platform/answer-pages";
import { apiError } from "../platform/errors";
import { resourceLinksSchema } from "./links";

/**
 * The reservations follow-up contract: lists, detail, counters, calendar,
 * status changes, cancellation and notes, on every transport, and the
 * domain's errors. No database here.
 *
 * A caller that may not read customers (the member's role cut down to the
 * connection's scopes) gets every reservation without its customer: the
 * customer, the billing identity, the delivery and return addresses, and
 * every free text that may name them (notes, activity descriptions and
 * details, payment notes) are null or empty. A caller that may not read
 * payments gets no payment rows nor Stripe ids: only what was paid toward
 * the rental (`rentalPaid`), as the dashboard's list shows it.
 *
 * Every reservation an output holds carries `links`, its dashboard page; a
 * customer shown with it carries the customer's. The base schemas below are
 * what the services build; the outputs add the links (the router fills them
 * from `ports.urls`).
 */

/** Largest page `reservations.list` returns, and its default. */
export const RESERVATION_PAGE_MAX = 100;
export const RESERVATION_PAGE_DEFAULT = 25;
/**
 * A bound on numbered pages, only so the offset stays a sane number: no store
 * has that many pages. The dashboard's pagination offers every page there is.
 */
export const RESERVATION_PAGE_NUMBER_MAX = 1_000_000;
/** Deepest row an API or agent caller reaches with page numbers; past it, the cursor. */
export const RESERVATION_AGENT_OFFSET_MAX = 10_000;
/** Widest window the calendar and the planning read at once, in days. */
export const RESERVATION_WINDOW_MAX_DAYS = 400;
/** Most rows `reservations.listUpcoming` and `reservations.listOverdue` return per list. */
export const RESERVATION_AGENDA_MAX = 200;
export const RESERVATION_AGENDA_DEFAULT = 50;
/** Longest look-ahead of `reservations.listUpcoming`, in days. */
export const RESERVATION_UPCOMING_MAX_DAYS = 90;

const idSchema = z.string().min(1).max(64);
const moneySchema = z.string();

export const RESERVATION_STATUSES = [
  "pending",
  "confirmed",
  "ongoing",
  "completed",
  "cancelled",
  "rejected",
  "quote",
  "declined",
] as const;
export const reservationStatusSchema = z.enum(RESERVATION_STATUSES);
export type ReservationStatus = z.infer<typeof reservationStatusSchema>;

const paymentTypeSchema = z.enum([
  "rental",
  "deposit",
  "deposit_return",
  "damage",
  "deposit_hold",
  "deposit_capture",
  "adjustment",
]);
const paymentMethodSchema = z.enum(["cash", "card", "transfer", "check", "other", "stripe"]);
const paymentStatusSchema = z.enum([
  "pending",
  "completed",
  "failed",
  "refunded",
  "authorized",
  "cancelled",
]);
/**
 * On a `deposit_hold` row, since when its release is owed: the reservation holds
 * another authorization, and Louez asked Stripe to cancel this one. A hold row's
 * `status` follows Stripe: `pending` is an authorization the store asked for and
 * Stripe has not confirmed, `failed` one it refused, `authorized` one it holds (the
 * reservation's, unless its release is owed), `completed` one that was captured,
 * `cancelled` one that holds nothing. None of them is money: a capture is its own
 * `deposit_capture` row. The reservation's hold is its `depositStatus` and
 * `depositPaymentIntentId`.
 */
const releaseOwedAtSchema = z.date().nullable();
const attributesSchema = z.record(z.string(), z.string());
/** A JSON column kept as stored (pricing breakdowns, snapshots, activity details). */
const jsonObjectSchema = z.record(z.string(), z.unknown());

/** The customer of a reservation; null when the caller may not read customers. */
const customerSummarySchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
});

/** What every reservation, and every customer shown with one, gets in an output. */
const linksShape = {
  /** Its page in the dashboard: the URL to give the user. */
  links: resourceLinksSchema,
};
const customerSummaryOutput = customerSummarySchema.extend(linksShape);

// --- List --------------------------------------------------------------------

const LIST_STATUSES = [
  "all",
  "pending",
  "confirmed",
  "ongoing",
  "completed",
  "cancelled",
  "rejected",
  "quote",
] as const;

export const RESERVATION_SORTS = ["startDate", "amount", "status", "number"] as const;

export const listReservationsInput = z.object({
  status: z
    .enum(LIST_STATUSES)
    .optional()
    .describe(
      "Only this status. cancelled also covers rejected and declined. Default all, which leaves out cancelled, rejected and declined reservations unless `search` is set.",
    ),
  period: z
    .enum(["today", "week", "month"])
    .optional()
    .describe(
      "Only reservations that start (or end, with operation return) today, this week (Monday to Sunday) or this month.",
    ),
  operation: z
    .enum(["departure", "return"])
    .optional()
    .describe("Which date `period` reads: departure (the start, default) or return (the end)."),
  paymentMethod: paymentMethodSchema
    .optional()
    .describe(
      "Only reservations with a completed payment by this method. Needs read access to payments.",
    ),
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .describe(
      "Part of the reservation number, or of the customer's name (only when the connection may read customers).",
    ),
  sort: z
    .enum(RESERVATION_SORTS)
    .optional()
    .describe("startDate (default), amount (the total), status or number."),
  sortDirection: z.enum(["asc", "desc"]).optional().describe("Default desc."),
  cursor: z
    .string()
    .max(512)
    .optional()
    .describe(
      "The nextCursor of the previous page, with the same filters and sort. Leave it out for the first page.",
    ),
  page: z.coerce
    .number()
    .int()
    .min(1)
    .max(RESERVATION_PAGE_NUMBER_MAX)
    .optional()
    .describe(
      `A page number, for numbered pages (1 is the first); ignored when cursor is set. Use cursor to read further: through the API, page × limit stops at ${RESERVATION_AGENT_OFFSET_MAX}.`,
    ),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(RESERVATION_PAGE_MAX)
    .optional()
    .describe(
      `Reservations per page, ${RESERVATION_PAGE_MAX} at most, ${RESERVATION_PAGE_DEFAULT} by default.`,
    ),
});
export type ListReservationsInput = z.infer<typeof listReservationsInput>;

/** The customer's acceptance of the contract, apart from the store's validation of it. */
const contractSignatureShape = {
  /** When the customer accepted the contract; null while they have not. */
  signedAt: z.date().nullable(),
  /** Where they accepted it; null while they have not. */
  signatureMethod: z.enum(CONTRACT_SIGNATURE_METHODS).nullable(),
};

const reservationListItemSchema = z.object({
  id: z.string(),
  number: z.string(),
  status: reservationStatusSchema,
  source: z.string().nullable(),
  startDate: z.date(),
  endDate: z.date(),
  createdAt: z.date(),
  subtotalAmount: moneySchema,
  depositAmount: moneySchema,
  totalAmount: moneySchema,
  ...contractSignatureShape,
  customer: customerSummarySchema.nullable(),
  /** What was paid toward the rental, refunds taken off. */
  rentalPaid: moneySchema,
  items: z.array(
    z.object({
      id: z.string(),
      quantity: z.number().int(),
      isCustomItem: z.boolean(),
      productSnapshot: z.object({ name: z.string() }),
      product: z.object({ id: z.string(), name: z.string() }).nullable(),
      selectedAttributes: attributesSchema.nullable(),
    }),
  ),
  /** The payment rows; empty when the caller may not read payments. */
  payments: z.array(
    z.object({
      id: z.string(),
      amount: moneySchema,
      type: paymentTypeSchema,
      method: paymentMethodSchema,
      status: paymentStatusSchema,
      releaseOwedAt: releaseOwedAtSchema,
      refundOfPaymentId: z.string().nullable(),
      // Together they tell a Stripe refund row from the charge it refunds.
      stripeRefundId: z.string().nullable(),
      stripePaymentIntentId: z.string().nullable(),
      stripeCheckoutSessionId: z.string().nullable(),
    }),
  ),
});
export type ReservationListItem = z.infer<typeof reservationListItemSchema>;

/** Reservations per dashboard tab, all filters left out. */
export const reservationCountsSchema = z.object({
  /** Every status but cancelled, rejected and declined. */
  all: z.number().int(),
  pending: z.number().int(),
  confirmed: z.number().int(),
  ongoing: z.number().int(),
  completed: z.number().int(),
  /** Cancelled, rejected and declined together. */
  cancelled: z.number().int(),
  quote: z.number().int(),
});
export type ReservationCounts = z.infer<typeof reservationCountsSchema>;

/** A page of the list, as the service builds it. */
export const reservationsPageSchema = z.object({
  items: z.array(reservationListItemSchema),
  /** Null on the last page. */
  nextCursor: z.string().nullable(),
  /** Reservations that match the filters, all pages together. */
  totalCount: z.number().int(),
  counts: reservationCountsSchema,
  /** Currency of every amount. */
  currency: z.string(),
});
export type ReservationsPage = z.infer<typeof reservationsPageSchema>;

export const listReservationsOutput = reservationsPageSchema.extend({
  items: z.array(
    reservationListItemSchema.extend({
      ...linksShape,
      customer: customerSummaryOutput.nullable(),
    }),
  ),
});

// --- Detail ------------------------------------------------------------------

export const getReservationInput = z.object({ id: idSchema });

const locationSnapshotSchema = z.object({
  type: z.enum(["primary", "additional"]),
  name: z.string(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string().nullable(),
  latitude: z.number().nullish(),
  longitude: z.number().nullish(),
});

const billingSnapshotSchema = z.object({
  customerType: z.enum(["individual", "business"]),
  companyName: z.string().nullable(),
  companyNumber: z.string().nullable(),
  companyNumberScheme: z.enum(["fr_siren", "be_bce"]).nullable(),
  vatNumber: z.string().nullable(),
});

export const reservationSchema = z.object({
  id: z.string(),
  number: z.string(),
  status: reservationStatusSchema,
  source: z.string().nullable(),
  locale: z.string().nullable(),
  currency: z.string(),
  startDate: z.date(),
  endDate: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
  pickedUpAt: z.date().nullable(),
  returnedAt: z.date().nullable(),
  ...contractSignatureShape,
  subtotalAmount: moneySchema,
  depositAmount: moneySchema,
  totalAmount: moneySchema,
  subtotalExclTax: moneySchema.nullable(),
  taxAmount: moneySchema.nullable(),
  taxRate: moneySchema.nullable(),
  discountAmount: moneySchema.nullable(),
  deliveryFee: moneySchema.nullable(),
  promoCodeSnapshot: z
    .object({ code: z.string(), type: z.enum(["percentage", "fixed"]), value: z.number() })
    .nullable(),
  depositStatus: z
    .enum(["none", "pending", "card_saved", "authorized", "captured", "released", "failed"])
    .nullable(),
  depositAuthorizationExpiresAt: z.date().nullable(),
  /** The card saved for the deposit, by its Stripe id; null when none, or without payments read. */
  stripePaymentMethodId: z.string().nullable(),
  /** What was paid toward the rental, refunds taken off. */
  rentalPaid: moneySchema,
  customerNotes: z.string().nullable(),
  /** The team's notes; null without customers read, as they may name the customer. */
  internalNotes: z.string().nullable(),
  /** store or address, for each leg. */
  outboundMethod: z.string(),
  returnMethod: z.string(),
  deliveryOption: z.string().nullable(),
  deliveryAddress: z.string().nullable(),
  deliveryCity: z.string().nullable(),
  deliveryPostalCode: z.string().nullable(),
  deliveryCountry: z.string().nullable(),
  deliveryDistanceKm: moneySchema.nullable(),
  returnAddress: z.string().nullable(),
  returnCity: z.string().nullable(),
  returnPostalCode: z.string().nullable(),
  returnCountry: z.string().nullable(),
  returnDistanceKm: moneySchema.nullable(),
  pickupLocationSnapshot: locationSnapshotSchema.nullable(),
  returnLocationSnapshot: locationSnapshotSchema.nullable(),
  /** Who the reservation is billed to, frozen at booking; null on older rows. */
  billingSnapshot: billingSnapshotSchema.nullable(),
  tulipInsuranceOptIn: z.boolean().nullable(),
  tulipInsuranceAmount: moneySchema.nullable(),
  tulipContractId: z.string().nullable(),
  tulipContractStatus: z.string().nullable(),
  /** Products of the reservation that the store's insurance covers. */
  insuredProductIds: z.array(z.string()),
  customerId: z.string().nullable(),
  customer: z
    .object({
      id: z.string(),
      customerType: z.enum(["individual", "business"]),
      firstName: z.string(),
      lastName: z.string(),
      email: z.string(),
      phone: z.string().nullable(),
      companyName: z.string().nullable(),
      companyNumber: z.string().nullable(),
      companyNumberScheme: z.enum(["fr_siren", "be_bce"]).nullable(),
      vatNumber: z.string().nullable(),
      address: z.string().nullable(),
      city: z.string().nullable(),
      postalCode: z.string().nullable(),
      country: z.string().nullable(),
    })
    .nullable(),
  items: z.array(
    z.object({
      id: z.string(),
      productId: z.string().nullable(),
      isCustomItem: z.boolean(),
      quantity: z.number().int(),
      consumedQuantity: z.number().int(),
      unitPrice: moneySchema,
      depositPerUnit: moneySchema,
      totalPrice: moneySchema,
      taxRate: moneySchema.nullable(),
      taxAmount: moneySchema.nullable(),
      priceExclTax: moneySchema.nullable(),
      totalExclTax: moneySchema.nullable(),
      pricingBreakdown: jsonObjectSchema.nullable(),
      productSnapshot: z.object({
        name: z.string(),
        description: z.string().nullish(),
        images: z.array(z.string()).nullish(),
        combinationKey: z.string().nullish(),
        selectedAttributes: attributesSchema.nullish(),
      }),
      combinationKey: z.string().nullable(),
      selectedAttributes: attributesSchema.nullable(),
      product: z
        .object({
          id: z.string(),
          name: z.string(),
          images: z.array(z.string()).nullable(),
          price: moneySchema,
          deposit: moneySchema.nullable(),
          quantity: z.number().int(),
          stockKind: z.enum(["returnable", "consumable", "untracked"]),
          trackUnits: z.boolean(),
          pricingKind: z.enum(["duration", "fixed"]),
          pricingMode: z.enum(["hour", "day", "week"]).nullable(),
          basePeriodMinutes: z.number().int().nullable(),
          enforceStrictTiers: z.boolean(),
          bookingAttributeAxes: z
            .array(z.object({ key: z.string(), label: z.string(), position: z.number() }))
            .nullable(),
        })
        .nullable(),
      assignedUnits: z.array(
        z.object({
          id: z.string(),
          productUnitId: z.string().nullable(),
          identifierSnapshot: z.string(),
          assignedAt: z.date(),
        }),
      ),
    }),
  ),
  /** The payment rows; empty when the caller may not read payments. Notes are null without customers read. */
  payments: z.array(
    z.object({
      id: z.string(),
      amount: moneySchema,
      currency: z.string().nullable(),
      type: paymentTypeSchema,
      method: paymentMethodSchema,
      status: paymentStatusSchema,
      notes: z.string().nullable(),
      paidAt: z.date().nullable(),
      createdAt: z.date(),
      refundOfPaymentId: z.string().nullable(),
      capturedAmount: moneySchema.nullable(),
      authorizationExpiresAt: z.date().nullable(),
      releaseOwedAt: releaseOwedAtSchema,
      stripeRefundId: z.string().nullable(),
      stripePaymentIntentId: z.string().nullable(),
      stripeCheckoutSessionId: z.string().nullable(),
    }),
  ),
  documents: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      number: z.string(),
      fileName: z.string(),
      generatedAt: z.date(),
    }),
  ),
  /**
   * Newest first. Without customers read, `description` and `metadata` are
   * null. Without payments read, payment and deposit entries have no
   * description, and `metadata` keeps only the keys each type lists as free
   * of payment data.
   */
  activity: z.array(
    z.object({
      id: z.string(),
      activityType: z.string(),
      description: z.string().nullable(),
      metadata: jsonObjectSchema.nullable(),
      createdAt: z.date(),
      user: z
        .object({ name: z.string().nullable(), email: z.string(), image: z.string().nullable() })
        .nullable(),
    }),
  ),
});
export type Reservation = z.infer<typeof reservationSchema>;

export const reservationOutput = reservationSchema.extend({
  ...linksShape,
  customer: reservationSchema.shape.customer.unwrap().extend(linksShape).nullable(),
});

// --- Counters ----------------------------------------------------------------

export const pollReservationsInput = z.object({});

/** The counters, as the service builds them. */
export const reservationPollSchema = z.object({
  /** Requests waiting for the store's answer. */
  pendingCount: z.number().int(),
  /** Supplier invoices received and not handled yet. */
  pendingSupplierInvoices: z.number().int(),
  totalCount: z.number().int(),
  counts: reservationCountsSchema,
  /** The five newest pending requests. */
  pendingReservations: z.array(
    z.object({
      id: z.string(),
      number: z.string(),
      status: reservationStatusSchema,
      createdAt: z.string().datetime(),
      startDate: z.string().datetime(),
      /** Null when the caller may not read customers. */
      customerName: z.string().nullable(),
    }),
  ),
  /** The newest pending request made online, for the dashboard's new-request sound. */
  latestReservation: z
    .object({
      id: z.string(),
      number: z.string(),
      status: reservationStatusSchema,
      createdAt: z.string().datetime(),
    })
    .nullable(),
  timestamp: z.string().datetime(),
});
export type ReservationPoll = z.infer<typeof reservationPollSchema>;

export const pollReservationsOutput = reservationPollSchema.extend({
  pendingReservations: z.array(
    reservationPollSchema.shape.pendingReservations.element.extend(linksShape),
  ),
  latestReservation: reservationPollSchema.shape.latestReservation
    .unwrap()
    .extend(linksShape)
    .nullable(),
});

// --- Calendar and planning ---------------------------------------------------

export const reservationWindowInput = z.object({
  from: z.coerce
    .date()
    .describe("Start of the window, ISO 8601. Reservations that end on or after it."),
  to: z.coerce
    .date()
    .describe(
      `End of the window, ISO 8601, at most ${RESERVATION_WINDOW_MAX_DAYS} days after from. Reservations that start on or before it.`,
    ),
  ...answerPageInput,
});

const deliveryLegSchema = z.object({
  address: z.string().nullable(),
  city: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string().nullable(),
});

export const calendarEntrySchema = z.object({
  id: z.string(),
  number: z.string(),
  status: reservationStatusSchema,
  startDate: z.date(),
  endDate: z.date(),
  subtotalAmount: moneySchema,
  depositAmount: moneySchema,
  totalAmount: moneySchema,
  outboundMethod: z.string(),
  returnMethod: z.string(),
  /** The legs' addresses; null without customers read. */
  deliveryAddress: z.string().nullable(),
  deliveryCity: z.string().nullable(),
  deliveryPostalCode: z.string().nullable(),
  deliveryCountry: z.string().nullable(),
  returnAddress: z.string().nullable(),
  returnCity: z.string().nullable(),
  returnPostalCode: z.string().nullable(),
  returnCountry: z.string().nullable(),
  customer: z.object({ id: z.string(), firstName: z.string(), lastName: z.string() }).nullable(),
  items: z.array(
    z.object({
      id: z.string(),
      quantity: z.number().int(),
      productSnapshot: z
        .object({ name: z.string(), images: z.array(z.string()).nullish() })
        .nullable(),
      product: z
        .object({
          id: z.string(),
          name: z.string(),
          images: z.array(z.string()).nullable(),
          displayOrder: z.number().nullable(),
        })
        .nullable(),
    }),
  ),
});
export type CalendarEntry = z.infer<typeof calendarEntrySchema>;

export const listCalendarPeriodOutput = z.object({
  items: z.array(
    calendarEntrySchema.extend({
      ...linksShape,
      customer: calendarEntrySchema.shape.customer.unwrap().extend(linksShape).nullable(),
    }),
  ),
  currency: z.string(),
  /** Null on the last page (`answerPage`). */
  nextCursor: z.string().nullable(),
});

/** One reservation's lines of one product, as the planning draws them. */
export const planningEntrySchema = z.object({
  id: z.string(),
  productId: z.string(),
  number: z.string(),
  status: reservationStatusSchema,
  startDate: z.date(),
  endDate: z.date(),
  /** Null without customers read. */
  customerId: z.string().nullable(),
  customerName: z.string().nullable(),
  subtotalAmount: moneySchema,
  depositAmount: moneySchema,
  totalAmount: moneySchema,
  quantity: z.number().int(),
  assignedUnitIds: z.array(z.string()),
  items: z.array(
    z.object({
      productId: z.string(),
      name: z.string(),
      quantity: z.number().int(),
      imageUrl: z.string().nullable(),
    }),
  ),
  /** The legs delivered to an address; null for the store, and without customers read. */
  outboundDelivery: deliveryLegSchema.nullable(),
  returnDelivery: deliveryLegSchema.nullable(),
});
export type PlanningEntry = z.infer<typeof planningEntrySchema>;

export const getPlanningTimelineOutput = z.object({
  items: z.array(planningEntrySchema.extend(linksShape)),
  currency: z.string(),
  /** Null on the last page (`answerPage`). */
  nextCursor: z.string().nullable(),
});

// --- Agenda ------------------------------------------------------------------

const agendaLimit = z.coerce
  .number()
  .int()
  .min(1)
  .max(RESERVATION_AGENDA_MAX)
  .optional()
  .describe(
    `Rows per list, ${RESERVATION_AGENDA_MAX} at most, ${RESERVATION_AGENDA_DEFAULT} by default.`,
  );

const agendaEntrySchema = z.object({
  id: z.string(),
  number: z.string(),
  status: reservationStatusSchema,
  startDate: z.date(),
  endDate: z.date(),
  totalAmount: moneySchema,
  customer: customerSummarySchema.nullable(),
});
const agendaEntryOutput = agendaEntrySchema.extend({
  ...linksShape,
  customer: customerSummaryOutput.nullable(),
});

export const listUpcomingInput = z.object({
  days: z.coerce
    .number()
    .int()
    .min(1)
    .max(RESERVATION_UPCOMING_MAX_DAYS)
    .optional()
    .describe(
      `Days to cover, counted from the start of today (1 = today only), 7 by default, ${RESERVATION_UPCOMING_MAX_DAYS} at most.`,
    ),
  limit: agendaLimit,
});

export const listUpcomingOutput = z.object({
  /** Confirmed reservations that start in the window, soonest first. */
  pickups: z.array(agendaEntryOutput),
  /** Ongoing reservations due back in the window, soonest first. */
  returns: z.array(agendaEntryOutput),
  /** True when a list was cut at `limit`. */
  hasMore: z.boolean(),
  from: z.date(),
  to: z.date(),
  currency: z.string(),
});

export const listOverdueInput = z.object({ limit: agendaLimit });

export const listOverdueOutput = z.object({
  /** Ongoing reservations past their end, the latest first. */
  items: z.array(agendaEntryOutput.extend({ daysLate: z.number().int() })),
  hasMore: z.boolean(),
  currency: z.string(),
});

// --- Writes ------------------------------------------------------------------

/** The statuses a store sets by hand. cancelled works as `reservations.cancel`. */
export const STORE_TARGET_STATUSES = [
  "confirmed",
  "ongoing",
  "completed",
  "cancelled",
  "rejected",
] as const;
export type StoreTargetStatus = (typeof STORE_TARGET_STATUSES)[number];

export const updateReservationStatusInput = z.object({
  id: idSchema,
  status: z
    .enum(STORE_TARGET_STATUSES)
    .describe(
      "confirmed (accept a request or a quote), ongoing (picked up), completed (returned), rejected (refuse a request) or cancelled.",
    ),
  rejectionReason: z
    .string()
    .max(2000)
    .optional()
    .describe(
      "For a rejection: the customer reads it in the rejection email, and the reservation's history shows it.",
    ),
});

export const cancelReservationInput = z.object({ id: idSchema });

/** A status change, as the service returns it. */
export const statusChangeSchema = z.object({
  id: z.string(),
  number: z.string(),
  from: reservationStatusSchema,
  to: reservationStatusSchema,
  /**
   * What the dashboard shows after the change: booking rules the dates break
   * (business hours, advance notice, durations), a failed insurance contract.
   * `key` is the dashboard's translation key.
   */
  warnings: z.array(
    z.object({
      key: z.string(),
      params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    }),
  ),
});
export type StatusChangeOutput = z.infer<typeof statusChangeSchema>;

export const statusChangeOutput = statusChangeSchema.extend(linksShape);

export const updateReservationNotesInput = z.object({
  id: idSchema,
  notes: z.string().max(100_000).describe("The new internal notes; an empty string clears them."),
});

export const updateReservationNotesOutput = z.object({
  id: z.string(),
  number: z.string(),
  internalNotes: z.string(),
  updatedAt: z.date(),
  ...linksShape,
});

// --- Global search -----------------------------------------------------------

/** Most rows the global search returns per kind. */
export const GLOBAL_SEARCH_LIMIT = 5;

export const globalSearchInput = z.object({
  query: z.string().trim().min(1).max(100).describe("Part of a name, number, email or phone."),
});

/** The search's hits, as the service builds them. */
export const globalSearchSchema = z.object({
  /** Empty when the connection may not read products. */
  products: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      price: moneySchema,
      image: z.string().nullable(),
    }),
  ),
  reservations: z.array(
    z.object({
      id: z.string(),
      number: z.string(),
      status: reservationStatusSchema,
      /** Null when the caller may not read customers. */
      customerName: z.string().nullable(),
      startDate: z.date(),
      endDate: z.date(),
    }),
  ),
  /** Empty when the connection may not read customers. */
  customers: z.array(z.object({ id: z.string(), name: z.string(), email: z.string() })),
});

export const globalSearchOutput = globalSearchSchema.extend({
  /** Each with its dashboard page. */
  products: z.array(globalSearchSchema.shape.products.element.extend(linksShape)),
  reservations: z.array(globalSearchSchema.shape.reservations.element.extend(linksShape)),
  customers: z.array(globalSearchSchema.shape.customers.element.extend(linksShape)),
});

// --- Errors ------------------------------------------------------------------

/** A unit held by a reservation's line that cannot serve it over its dates. */
export interface ReservationUnitConflict {
  reservationItemId: string;
  unitId: string;
  identifier: string;
}

export const reservationErrors = {
  notFound: (id: string) =>
    apiError("NOT_FOUND", "RESERVATION_NOT_FOUND", {
      message: `This store has no reservation ${id}.`,
      i18nKey: "errors.reservationNotFound",
      details: { id },
    }),
  transitionNotAllowed: (from: ReservationStatus, to: ReservationStatus, allowed: string[]) =>
    apiError("CONFLICT", "RESERVATION_TRANSITION_NOT_ALLOWED", {
      message: `A ${from} reservation cannot become ${to}. Allowed from ${from}: ${allowed.length > 0 ? allowed.join(", ") : "none"}.`,
      i18nKey: "errors.reservationStatusChanged",
      details: { from, to, allowed },
    }),
  notCancellable: (from: ReservationStatus) =>
    apiError("CONFLICT", "RESERVATION_NOT_CANCELLABLE", {
      message: `A ${from} reservation cannot be cancelled.`,
      i18nKey: "errors.cannotCancelReservation",
      details: { from },
    }),
  statusChangedMeanwhile: (expected: ReservationStatus, current: ReservationStatus) =>
    apiError("CONFLICT", "RESERVATION_STATUS_CHANGED", {
      message: `The reservation became ${current} meanwhile, so nothing was done. Read it again first.`,
      i18nKey: "errors.reservationStatusChanged",
      details: { expected, current },
    }),
  /** `i18nKey` is the stock error's own key, as the dashboard showed it. */
  itemsUnavailable: (i18nKey: string) =>
    apiError("CONFLICT", "RESERVATION_ITEMS_UNAVAILABLE", {
      message:
        "Not confirmed: some items of this reservation are no longer available for its dates.",
      i18nKey,
    }),
  /** Units the reservation holds are held by another booking over its dates, or out of the stock. */
  unitsUnavailable: (conflicts: ReservationUnitConflict[]) =>
    apiError("CONFLICT", "RESERVATION_UNITS_UNAVAILABLE", {
      message: `Not confirmed: units assigned to this reservation cannot serve it for its dates (${conflicts.map((conflict) => conflict.identifier).join(", ")}). Another booking holds them over these dates, or they are retired or in downtime. Assign other units, then confirm.`,
      i18nKey: "errors.assignedUnitsConflict",
      details: { conflicts },
    }),
  storeNotAccepting: (i18nKey: string) =>
    apiError("CONFLICT", "STORE_NOT_ACCEPTING_RESERVATIONS", {
      message:
        "Not changed: this store is not taking new reservations right now. The dashboard shows the store owner why.",
      i18nKey,
    }),
  /** The store requires the signed contract before pickup (`contractSignatureMode`). */
  contractUnsigned: (id: string) =>
    apiError("CONFLICT", "CONTRACT_UNSIGNED", {
      message:
        "Not changed: this store requires the customer to sign the contract before pickup, and they have not signed it yet.",
      i18nKey: "errors.contractSignatureRequired",
      details: { id },
    }),
  /** Temporary contention past the retries: nothing was done, the same call may succeed. */
  busy: (id: string) =>
    apiError("CONFLICT", "RESERVATION_BUSY", {
      message:
        "The reservation was being changed at the same time, so nothing was done. Call again with the same arguments in a moment.",
      i18nKey: "errors.reservationStatusChanged",
      retryable: true,
      details: { id },
    }),
  pageTooDeep: () =>
    apiError("BAD_REQUEST", "PAGE_TOO_DEEP", {
      message: `Page numbers reach the first ${RESERVATION_AGENT_OFFSET_MAX} reservations. Follow nextCursor to read further.`,
      i18nKey: "errors.invalidData",
      details: { maxOffset: RESERVATION_AGENT_OFFSET_MAX },
    }),
  invalidCursor: () =>
    apiError("BAD_REQUEST", "INVALID_CURSOR", {
      message:
        "This cursor is not one reservations_list returned for these filters and sort. Start again without a cursor.",
      i18nKey: "errors.invalidData",
    }),
  windowInvalid: () =>
    apiError("BAD_REQUEST", "RESERVATION_WINDOW_INVALID", {
      message: `The window must end after it starts, and span at most ${RESERVATION_WINDOW_MAX_DAYS} days.`,
      i18nKey: "errors.invalidData",
      details: { maxDays: RESERVATION_WINDOW_MAX_DAYS },
    }),
} as const;
