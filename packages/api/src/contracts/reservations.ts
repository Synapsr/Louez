import { CONTRACT_SIGNATURE_METHODS } from "@louez/db/schema";
import { z } from "zod";

import { answerPageInput } from "../platform/answer-pages";
import { apiError } from "../platform/errors";
import { resourceLinksSchema } from "./links";
import { STRIPE_REFUND_STATUSES } from "./stripe-refunds";

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
  /**
   * How its prices were given: with tax ("inclusive", the subtotal includes
   * it) or before tax ("exclusive", the tax comes on top); null when the
   * reservation did not record it.
   */
  taxDisplayMode: z.enum(["inclusive", "exclusive"]).nullable(),
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
      sessionSettledAt: z
        .date()
        .nullable()
        .describe(
          "On a rental payment's Checkout Session: when Louez learnt from Stripe that it can no longer be paid. Null while that is not known, and on every other row.",
        ),
    }),
  ),
  /**
   * The refunds of its online payments asked through Louez (`refund_payment`), oldest
   * first; empty when the caller may not read payments. Each is read again by `get_refund`.
   */
  refunds: z.array(
    z.object({
      id: z.string().describe("The refund's ID, as `get_refund` reads it."),
      paymentId: z.string().describe("The payment it gives money back from."),
      refundPaymentId: z
        .string()
        .nullable()
        .describe("Its own row among `payments`, once Stripe made the refund; null before."),
      status: z
        .enum(STRIPE_REFUND_STATUSES)
        .describe(
          "`pending` until Stripe gives the final outcome (its row may already be among the payments: the customer has not received it yet, and it may still fail); `succeeded`; `failed`, its row then failed.",
        ),
      approvedBy: z
        .object({ name: z.string().nullable(), email: z.string(), image: z.string().nullable() })
        .nullable()
        .describe("The person who approved it, when one did."),
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
  allowOverbooking: z
    .boolean()
    .optional()
    .describe(
      "For a confirmation the stock cannot cover (RESERVATION_INSUFFICIENT_CAPACITY): true confirms it all the same, booking over the stock, and the reservation's history records the shortfalls. Send it only when the user chose to book over the stock. It covers only the units a line does not hold yet: a unit the reservation holds that another booking holds or needs refuses (RESERVATION_UNITS_UNAVAILABLE). It never passes consumable stock below zero, or a shortfall that comes from the turnover buffer alone (RESERVATION_TURNOVER_BUFFER_CONFLICT: that is overrideTurnoverBuffer); a line short on the stock itself is booked over whole, buffer included. Ignored for any other change.",
    ),
  overrideTurnoverBuffer: z
    .boolean()
    .optional()
    .describe(
      "For a confirmation refused with RESERVATION_TURNOVER_BUFFER_CONFLICT (lines that fit the stock, but not the turnover buffer the store keeps between rentals): true confirms those lines all the same, with less time between two rentals than the store set, and the reservation's history records them with the buffer. Send it only when the user chose to. It covers this confirmation only: nothing carries it to a later change. It never passes a line the stock itself cannot cover (RESERVATION_INSUFFICIENT_CAPACITY: that is allowOverbooking), a unit another booking holds or needs (RESERVATION_UNITS_UNAVAILABLE), or a consumable out of stock. A reservation short both ways needs both flags. Ignored for any other change.",
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
  /**
   * The messages owed to the customer that could not go out, and why: an
   * e-mail on an instance with no e-mail service (`email_not_configured`), an
   * SMS on one with no SMS provider (`sms_not_configured`). The store's inbox
   * lists each as not sent; the store tells the customer. Empty when every
   * message can go.
   */
  messagesNotSent: z.array(
    z.object({
      message: z.enum(["request_accepted", "request_rejected", "reservation_cancelled"]),
      channel: z.enum(["email", "sms"]),
      reason: z.enum(["email_not_configured", "sms_not_configured"]),
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

// --- Dates -------------------------------------------------------------------

/**
 * An instant written with its offset ("2030-06-01T09:00:00+02:00", or "…Z"),
 * in whole seconds: a reservation's dates are stored to the second, so a
 * fraction would be priced as one window and stored as another.
 */
const instantWithOffset = z
  .string()
  .datetime({ offset: true })
  .refine((value) => Number.isFinite(Date.parse(value)), "Not a real instant.")
  .refine(
    // Read on the text, before parsing: `Date.parse` drops digits past the
    // millisecond, so ".0001" would pass as a whole second. ".000" is one.
    (value) => /^0*$/.test(/T\d{2}:\d{2}(?::\d{2})?(?:\.(\d+))?/.exec(value)?.[1] ?? ""),
    "Give the instant in whole seconds: a reservation's dates hold no fraction of a second.",
  );

/**
 * A date change of a reservation (`reservations.update`). The input is a strict
 * object: an unknown field is refused, never ignored, so a caller that sends
 * what a later version of this contract adds (its lines, its delivery) is
 * told now that this version does not take it.
 */
export const updateReservationInput = z
  .strictObject({
    id: idSchema,
    startDate: instantWithOffset
      .optional()
      .describe(
        "The new start, ISO 8601 with its offset (2030-06-01T09:00:00+02:00, or Z). Absent: the start stays as it is. The start of an ongoing reservation cannot move: its goods are out.",
      ),
    endDate: instantWithOffset
      .optional()
      .describe(
        "The new end, ISO 8601 with its offset. Absent: the end stays as it is. It must come after the start.",
      ),
    notifyCustomer: z
      .boolean()
      .describe(
        "true: the customer gets the “booking modified” e-mail, with the previous and the new dates, at the address the preview names. Refused with RESERVATION_CUSTOMER_UNREACHABLE when the customer has no e-mail address or this instance sends no e-mail. false: no message. Required: always say which.",
      ),
    allowOverbooking: z
      .boolean()
      .optional()
      .describe(
        "For new dates the stock cannot cover (RESERVATION_INSUFFICIENT_CAPACITY): true moves them all the same, booking over the stock, and the reservation's history records the shortfalls. Send it only when the user chose to. It never passes a shortfall that comes from the turnover buffer alone (that is overrideTurnoverBuffer), a unit the reservation holds that another booking holds or needs (RESERVATION_UNITS_UNAVAILABLE), or a consumable out of stock.",
      ),
    overrideTurnoverBuffer: z
      .boolean()
      .optional()
      .describe(
        "For new dates refused with RESERVATION_TURNOVER_BUFFER_CONFLICT (lines that fit the stock, not the turnover buffer the store keeps between rentals): true moves them all the same, for this change only. Send it only when the user chose to. It never passes a line the stock itself cannot cover (that is allowOverbooking).",
      ),
  })
  .refine((input) => input.startDate !== undefined || input.endDate !== undefined, {
    message: "Give startDate, endDate or both.",
    path: ["startDate"],
  });

/** A line short in a stock check, as an answer states it (`CapacityShortfall`). */
const capacityShortfallSchema = z.object({
  productId: z.string(),
  productName: z.string(),
  combinationKey: z.string().nullable(),
  requested: z.number().int(),
  available: z.number().int(),
  reservationItemId: z.string().optional(),
  selectedAttributes: z.record(z.string(), z.string()).nullable().optional(),
});

/** A date change's own facts, next to the reservation as `reservations.get` returns it. */
export const dateChangeSchema = z.object({
  /** False when the dates sent are the ones stored: nothing was written, nothing sent. */
  changed: z.boolean(),
  previousStartDate: z.date(),
  previousEndDate: z.date(),
  /** The total before the change, in the reservation's currency (`currency`). */
  previousTotal: moneySchema,
  /** New total less the previous one, in the reservation's currency: owed when positive. */
  difference: moneySchema,
  /**
   * What the dashboard would show next to the change: booking rules the new
   * dates break (`key` and `params`, the dashboard's translation key), an open
   * payment session, a deposit hold that lapses before the new end, a balance
   * now owed or over-paid. None of them refuses the change.
   */
  warnings: z.array(
    z.object({
      key: z.string(),
      params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    }),
  ),
  /**
   * The stock verdict of the new dates, counted without the turnover buffer:
   * `overbooked` with the lines booked over the stock, or none.
   */
  capacity: z.object({
    overbooked: z.boolean(),
    shortfalls: z.array(capacityShortfallSchema),
  }),
  /**
   * The customer's “booking modified” e-mail, queued with the change and sent
   * once it committed; `to` is null for a caller who may not read customers.
   * Null when none was asked for, or nothing changed.
   */
  customerMessage: z.object({ channel: z.literal("email"), to: z.string().nullable() }).nullable(),
});
export type DateChange = z.infer<typeof dateChangeSchema>;

export const updateReservationOutput = reservationOutput.extend(dateChangeSchema.shape);

/**
 * Why a date change must be made in the dashboard: a stored fact this
 * change cannot derive again, so it refuses rather than guess a price.
 */
export const DATE_CHANGE_DASHBOARD_REASONS = [
  /** Insurance: its premium depends on the window and is quoted by the insurer. */
  "insured",
  /** A line typed by hand, a custom line, or a price set by hand. */
  "custom_or_manual_lines",
  /** A promo code or a discount: its amount is not derived from the dates. */
  "discount_or_promo_code",
  /** A marketplace booking: its price is the marketplace's. */
  "marketplace",
  /** The customer's extension checkout is open: it holds its own plan. */
  "extension_checkout_open",
  /** Today's catalogue and tax settings do not give the stored prices back to the cent. */
  "prices_not_reproducible",
  /** A line's product was deleted or is no longer active. */
  "product_unavailable",
  /** A line chose a combination of its product that no unit carries any more. */
  "variant_unavailable",
  /** A delivery to or from an address: its fee depends on the distance and on the subtotal. */
  "delivery",
  /** Taxes are on and a line holds no tax figures of its own, or the reservation no currency. */
  "booking_facts_missing",
] as const;
export type DateChangeDashboardReason = (typeof DATE_CHANGE_DASHBOARD_REASONS)[number];

const DASHBOARD_REASON_SAID: Record<DateChangeDashboardReason, string> = {
  insured: "it is insured, and the insurer quotes the premium for its dates",
  custom_or_manual_lines: "it holds a custom line or a price set by hand",
  discount_or_promo_code: "it holds a promo code or a discount",
  marketplace: "it was booked through the marketplace, which set its price",
  extension_checkout_open: "the customer has an extension checkout open on it",
  prices_not_reproducible:
    "its stored prices are not what today's catalogue and tax settings give for its dates (a promotion ended, a price or a tax setting changed since)",
  product_unavailable: "one of its lines is for a product that was deleted or is no longer active",
  variant_unavailable:
    "one of its lines chose a variant of its product that no unit carries any more",
  delivery: "it is delivered to or collected from an address, and the delivery fee depends on it",
  booking_facts_missing:
    "it was booked before Louez recorded every price fact this change needs (its currency, or a line's tax figures)",
};

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

/**
 * A line the stock cannot cover whole: how many units it asks for, and how
 * many of them are left next to the other bookings and the lines before it.
 * A creation, an edit and the store's confirmation refuse with these, and
 * record the ones they book over.
 */
export interface CapacityShortfall {
  productId: string;
  productName: string;
  /** The combination the line chose; null for a counted product or a line served by any unit. */
  combinationKey: string | null;
  requested: number;
  available: number;
  /**
   * The reservation's line that is short: two lines of one product are told
   * apart by it. The store's confirmation fills it in; a creation's and an
   * edit's shortfalls do not carry it yet.
   */
  reservationItemId?: string;
  /**
   * What the line asks of the product's attributes (a size, a colour), as the
   * stock check read it: the line's choices on the attributes the product has
   * today. A choice on an attribute the product no longer has restricts
   * nothing and is left out. With no `combinationKey`, it is the line's only
   * choice: any unit that matches it may serve the line; null when the line
   * asks for none. The store's confirmation fills it in; a creation's and an
   * edit's shortfalls do not carry it yet.
   */
  selectedAttributes?: Record<string, string> | null;
}

/**
 * What a short line chose, in a few words: its combination, or else the
 * attributes it chose ("size: S"); null when it chose nothing.
 */
export const shortfallChoice = (shortfall: CapacityShortfall): string | null =>
  shortfall.combinationKey ??
  (Object.entries(shortfall.selectedAttributes ?? {})
    .map(([attribute, value]) => `${attribute}: ${value}`)
    .join(", ") ||
    null);

/** A short line in a few words, for a message or a preview: "Kayak (size: S)". */
export const describeShortfallLine = (shortfall: CapacityShortfall): string => {
  const choice = shortfallChoice(shortfall);
  return choice ? `${shortfall.productName} (${choice})` : shortfall.productName;
};

/**
 * A capacity verdict: what a stock check said of a reservation when it was
 * created, edited or confirmed, kept on that activity row. `overbooked: true`
 * with its shortfalls when the team booked over the stock, `overbooked: false`
 * when the check found that it fits. A reservation's latest verdict is the one
 * that counts: the inbox shows an overbooking until a later edit or
 * confirmation fits, and the reservation's history marks each row booked
 * over the stock. A confirmation's row is `confirmed`, or `quote_accepted`
 * for the customer's.
 */
export const CAPACITY_VERDICT_ACTIVITY_TYPES = [
  "created",
  "modified",
  "confirmed",
  "quote_accepted",
] as const;

/** A unit held by a reservation's line that cannot serve it over its dates. */
export interface ReservationUnitConflict {
  reservationItemId: string;
  unitId: string;
  identifier: string;
  /**
   * `owed_to_other_bookings`: no other booking holds the unit, but the stock
   * needs it for the other bookings over these dates (ones that left a size
   * or a colour open, or were not given their units yet): next to them it
   * does not fit, and without them it would. Absent when another booking
   * holds it over these dates, or it is retired or in downtime.
   */
  reason?: "owed_to_other_bookings";
}

/** Why the units cannot serve, for an error's message. */
const unitConflictCauses = (conflicts: ReservationUnitConflict[]) =>
  [
    conflicts.some((conflict) => conflict.reason === undefined)
      ? "Another booking holds them over these dates, or they are retired or in downtime."
      : null,
    conflicts.some((conflict) => conflict.reason === "owed_to_other_bookings")
      ? "No other booking holds them, but the stock needs them for other bookings over these dates (ones that left a size or a colour open, or were not given their units yet)."
      : null,
  ]
    .filter(Boolean)
    .join(" ");

/** Each shortfall in a few words, for an error's message. */
const describeShortfalls = (shortfalls: CapacityShortfall[]) =>
  shortfalls
    .map(
      (shortfall) =>
        `${describeShortfallLine(shortfall)}: ${shortfall.requested} asked, ${shortfall.available} free`,
    )
    .join("; ");

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
  /**
   * Units the reservation holds are held by another booking over its dates,
   * out of the stock, or needed by the other bookings (`reason`).
   * `allowOverbooking` does not pass it.
   */
  unitsUnavailable: (conflicts: ReservationUnitConflict[]) =>
    apiError("CONFLICT", "RESERVATION_UNITS_UNAVAILABLE", {
      message: `Not confirmed: units assigned to this reservation cannot serve it for its dates (${conflicts.map((conflict) => conflict.identifier).join(", ")}). ${unitConflictCauses(conflicts)} Remove them from the reservation or assign other units, then confirm; allowOverbooking does not pass it.`,
      i18nKey: "errors.assignedUnitsConflict",
      details: { conflicts },
    }),
  /**
   * The returnable stock cannot cover lines of the reservation over its
   * dates, counted without the turnover buffer. The store may confirm over
   * them on purpose: the same call with `allowOverbooking: true`.
   */
  insufficientCapacity: (shortfalls: CapacityShortfall[]) =>
    apiError("CONFLICT", "RESERVATION_INSUFFICIENT_CAPACITY", {
      message: `Not confirmed: the stock cannot cover this reservation over its dates (${describeShortfalls(shortfalls)}). Other bookings hold the rest. To confirm it all the same, booking over the stock, call again with allowOverbooking: true; the reservation's history records it.`,
      i18nKey: "errors.insufficientCapacity",
      details: { shortfalls },
    }),
  /**
   * Lines fit the stock, and not with the turnover buffer the store keeps
   * between rentals. The store may confirm past it on purpose: the same call
   * with `overrideTurnoverBuffer: true`. `allowOverbooking` does not cover them.
   */
  turnoverBufferShortfall: (shortfalls: CapacityShortfall[]) =>
    apiError("CONFLICT", "RESERVATION_TURNOVER_BUFFER_CONFLICT", {
      message: `Not confirmed: the turnover buffer the store keeps between rentals keeps lines of this reservation from being confirmed; they fit the stock without it (${describeShortfalls(shortfalls)}). Free the stock around these dates or move the dates, then confirm; or, to confirm it all the same with less time between rentals, call again with overrideTurnoverBuffer: true, and the reservation's history records it. allowOverbooking does not pass it.`,
      i18nKey: "errors.turnoverBufferShortfall",
      details: { shortfalls },
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

  // --- Date changes (`reservations.update`) ---------------------------------

  /** A pending, quote, confirmed or ongoing reservation is edited; any other is what was rented or refused. */
  notEditable: (id: string, status: ReservationStatus) =>
    apiError("CONFLICT", "RESERVATION_NOT_EDITABLE", {
      message: `A ${status} reservation cannot be changed: only a pending, quote, confirmed or ongoing one can.`,
      i18nKey: "errors.reservationStatusChanged",
      details: { id, status, editable: ["pending", "quote", "confirmed", "ongoing"] },
    }),
  /**
   * The new dates are no real rental window: the end is not after the start
   * (`end_not_after_start`), or the start of an ongoing reservation moved
   * (`ongoing_start_moved`: its goods are out, only its end may move).
   */
  datesInvalid: (reason: "end_not_after_start" | "ongoing_start_moved", start: Date, end: Date) =>
    apiError("BAD_REQUEST", "RESERVATION_WINDOW_INVALID", {
      message:
        reason === "end_not_after_start"
          ? `Not changed: the end (${end.toISOString()}) must come after the start (${start.toISOString()}).`
          : "Not changed: this reservation is ongoing, its goods are out, so its start cannot move. Only its end can.",
      i18nKey:
        reason === "end_not_after_start" ? "errors.endDateBeforeStart" : "errors.invalidData",
      details: { reason, startDate: start.toISOString(), endDate: end.toISOString() },
    }),
  /**
   * An instant with a fraction of a second: a reservation's dates are stored
   * to the second. The contract refuses it first; this is the service's own
   * check, for a caller that skips the contract.
   */
  dateNotWholeSeconds: (field: "startDate" | "endDate", at: Date) =>
    apiError("BAD_REQUEST", "RESERVATION_WINDOW_INVALID", {
      message: `Not changed: ${field} (${at.toISOString()}) must be a whole second: a reservation's dates hold no fraction of a second.`,
      i18nKey: "errors.invalidData",
      details: { reason: "not_whole_seconds", field, at: at.toISOString() },
    }),
  /**
   * The change needs a fact it cannot derive again, so it is not made here:
   * the store makes it from the reservation's page in the dashboard.
   */
  editInDashboard: (id: string, reason: DateChangeDashboardReason) =>
    apiError("CONFLICT", "RESERVATION_EDIT_IN_DASHBOARD", {
      message: `Not changed: this reservation's dates can only be changed from its page in the dashboard, because ${DASHBOARD_REASON_SAID[reason]}. Nothing was written. The reservation's links.dashboard is that page.`,
      i18nKey: "errors.invalidData",
      details: { id, reason },
    }),
  /**
   * The caller asked to tell the customer, and no message can reach them:
   * the customer has no e-mail address (`no_email`), or this instance sends
   * no e-mail (`email_not_configured`). Nothing was asked or written: the
   * same call with `notifyCustomer: false` makes the change without a message.
   */
  customerUnreachable: (id: string, reason: "no_email" | "email_not_configured") =>
    apiError("CONFLICT", "RESERVATION_CUSTOMER_UNREACHABLE", {
      message:
        reason === "no_email"
          ? "Not changed: the customer has no e-mail address, so the “booking modified” message cannot reach them. Call again with notifyCustomer: false to change the dates without a message."
          : "Not changed: this Louez instance sends no e-mail, so the “booking modified” message cannot go out. Call again with notifyCustomer: false to change the dates without a message.",
      i18nKey: "errors.invalidData",
      details: { id, reason },
    }),
  /** As `unitsUnavailable`, said of new dates. */
  datesUnitsUnavailable: (conflicts: ReservationUnitConflict[]) =>
    apiError("CONFLICT", "RESERVATION_UNITS_UNAVAILABLE", {
      message: `Not changed: units assigned to this reservation cannot serve it over the new dates (${conflicts.map((conflict) => conflict.identifier).join(", ")}). ${unitConflictCauses(conflicts)} No flag passes it: choose other dates, or have the store assign other units.`,
      i18nKey: "errors.assignedUnitsConflict",
      details: { conflicts },
    }),
  /** As `insufficientCapacity`, said of new dates. */
  datesInsufficientCapacity: (shortfalls: CapacityShortfall[]) =>
    apiError("CONFLICT", "RESERVATION_INSUFFICIENT_CAPACITY", {
      message: `Not changed: the stock cannot cover this reservation over the new dates (${describeShortfalls(shortfalls)}). Other bookings hold the rest. To move it all the same, booking over the stock, call again with allowOverbooking: true; the reservation's history records it.`,
      i18nKey: "errors.insufficientCapacity",
      details: { shortfalls },
    }),
  /** As `turnoverBufferShortfall`, said of new dates. */
  datesTurnoverBufferShortfall: (shortfalls: CapacityShortfall[]) =>
    apiError("CONFLICT", "RESERVATION_TURNOVER_BUFFER_CONFLICT", {
      message: `Not changed: lines of this reservation fit the stock over the new dates, but not the turnover buffer the store keeps between rentals (${describeShortfalls(shortfalls)}). To move them all the same, with less time between rentals, call again with overrideTurnoverBuffer: true; the reservation's history records it. allowOverbooking does not pass it.`,
      i18nKey: "errors.turnoverBufferShortfall",
      details: { shortfalls },
    }),
} as const;
