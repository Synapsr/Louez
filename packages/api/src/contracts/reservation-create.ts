import { z } from "zod";

import { apiError } from "../platform/errors";
import { resourceLinksSchema } from "./links";
import { describeShortfallLine, reservationOutput, type CapacityShortfall } from "./reservations";

/**
 * The store's creation of a reservation, on every transport
 * (`reservations.create`, `POST /reservations`, MCP `reservations_create`):
 * a quote or a confirmed booking, priced as the checkout prices the same
 * cart, its stock checked as a confirmation checks it. No database here.
 *
 * What the dashboard's creation also does, and this version refuses with
 * `RESERVATION_OPTION_NOT_AVAILABLE` (`details.option`), stays the
 * dashboard's: custom lines, a price or a deposit typed by hand, a discount
 * or a promo code, delivery, insurance, and a booking left `pending`.
 */

const idSchema = z.string().min(1).max(64);

/** Most lines one creation takes. */
export const RESERVATION_CREATE_LINES_MAX = 50;
/** Most units one line asks for. */
export const RESERVATION_CREATE_QUANTITY_MAX = 1000;

/**
 * What this version refuses, each by name in `details.option`: the
 * dashboard does it.
 */
export const RESERVATION_CREATE_REFUSED_OPTIONS = [
  "custom_lines",
  "price_override",
  "deposit_override",
  "discount",
  "promo_code",
  "delivery",
  "insurance",
  "pending",
] as const;
export type ReservationCreateRefusedOption = (typeof RESERVATION_CREATE_REFUSED_OPTIONS)[number];

/** A field this version refuses: accepted by the schema, so its refusal names it. */
const refused = <Schema extends z.ZodType>(schema: Schema, what: string) =>
  schema
    .optional()
    .describe(`Not taken by this version: ${what} Refused with RESERVATION_OPTION_NOT_AVAILABLE.`);

const amountSchema = z.union([z.string(), z.number()]);
const objectSchema = z.record(z.string(), z.unknown());

const instantSchema = z.iso
  .datetime({ offset: true })
  .describe("ISO 8601 date and time with its offset, such as 2027-06-01T09:00:00+02:00.");

const newCustomerSchema = z.object({
  email: z
    .string()
    .trim()
    .pipe(z.email().max(255))
    .describe(
      "The customer's e-mail, which identifies them in the store: a customer the store already has with this e-mail is used as is, never changed.",
    ),
  firstName: z.string().trim().min(1).max(255),
  lastName: z.string().trim().min(1).max(255),
  phone: z.string().trim().min(1).max(50).optional(),
});

export const createReservationInput = z.object({
  customer: z
    .union([z.object({ id: idSchema }).strict(), newCustomerSchema.strict()])
    .describe(
      "Either `{ id }`, a customer of this store, or `{ email, firstName, lastName, phone? }`: the customer with that e-mail if the store has one (its details are never changed), else a new customer.",
    ),
  startDate: instantSchema.describe("When the rental starts: ISO 8601 with its offset."),
  endDate: instantSchema.describe("When it ends, after the start: ISO 8601 with its offset."),
  lines: z
    .array(
      z.object({
        productId: idSchema,
        quantity: z.number().int().min(1).max(RESERVATION_CREATE_QUANTITY_MAX),
        selectedAttributes: z
          .record(z.string().min(1).max(100), z.string().min(1).max(200))
          .optional()
          .describe(
            "The variant chosen, by the product's booking attributes, as the online store's cart sends it: { size: 'M' }. Left out, any unit of the product may serve the line.",
          ),
        unitPrice: refused(
          amountSchema,
          "a price typed by hand; every line is priced from the catalog.",
        ),
        priceOverride: refused(
          z.union([amountSchema, objectSchema]),
          "a price typed by hand; every line is priced from the catalog.",
        ),
      }),
    )
    .min(1)
    .max(RESERVATION_CREATE_LINES_MAX)
    .describe("The catalog products booked, each once or more."),
  status: z
    .enum(["quote", "confirmed", "pending"])
    .describe(
      "quote (sent to the customer to accept; it takes no stock) or confirmed (its items leave the stock for these dates). pending is refused: it is the customer's own checkout.",
    ),
  notifyCustomer: z
    .boolean()
    .describe(
      "true sends the customer the quote e-mail (status quote) or the booking confirmation (status confirmed), when the store sends that e-mail; false sends nothing. Required.",
    ),
  allowOverbooking: z
    .boolean()
    .optional()
    .describe(
      "Refused with RESERVATION_INSUFFICIENT_CAPACITY: true creates it all the same, booking over the stock, for when the user chose to. It never passes a consumable out of stock, nor a shortfall the turnover buffer alone makes (that is overrideTurnoverBuffer).",
    ),
  overrideTurnoverBuffer: z
    .boolean()
    .optional()
    .describe(
      "Refused with RESERVATION_TURNOVER_BUFFER_CONFLICT (lines that fit the stock but not the turnover buffer the store keeps between rentals): true creates it all the same, for when the user chose a shorter turnaround. It never passes a line the stock itself cannot cover (that is allowOverbooking).",
    ),
  internalNotes: z.string().max(100_000).optional().describe("Notes only the store's team sees."),
  customLines: refused(z.array(objectSchema), "lines that are not catalog products."),
  depositOverride: refused(
    amountSchema,
    "a deposit typed by hand; the deposit is the products' own.",
  ),
  discountAmount: refused(amountSchema, "a discount."),
  promoCode: refused(z.string(), "a promo code."),
  delivery: refused(objectSchema, "delivery; the customer picks up at the store's main location."),
  insurance: refused(z.boolean(), "insurance."),
  tulipInsuranceOptIn: refused(z.boolean(), "insurance."),
});
export type CreateReservationInput = z.infer<typeof createReservationInput>;

/** A line short in the creation's stock check: the shortfall, and the line by its position in `lines`. */
export type CreateShortfall = CapacityShortfall & { line: number };

const shortfallSchema = z.object({
  line: z.number(),
  productId: z.string(),
  productName: z.string(),
  combinationKey: z.string().nullable(),
  selectedAttributes: z.record(z.string(), z.string()).nullable().optional(),
  requested: z.number(),
  available: z.number(),
});

export const createReservationOutput = z.object({
  /** The reservation's id, as `reservation.id`. */
  id: z.string(),
  /** The reservation as `reservations.get` returns it. */
  reservation: reservationOutput,
  customer: z.object({
    id: z.string(),
    /** False when the store already had a customer with this e-mail, used as is. */
    created: z.boolean(),
  }),
  /**
   * What the stock check found: `overbooked` when lines were booked over the
   * stock (counted without the turnover buffer), each listed; and the lines
   * passed past the turnover buffer.
   */
  capacity: z.object({
    overbooked: z.boolean(),
    shortfalls: z.array(shortfallSchema),
    pastTurnoverBuffer: z.array(shortfallSchema),
  }),
  /** The e-mail queued for the customer, or why none goes. */
  message: z.object({
    sent: z.boolean(),
    kind: z.enum(["quote", "confirmation"]).nullable(),
    to: z.string().nullable(),
    /** Why none goes: not asked, the store turned that e-mail off, or this instance sends no e-mail. */
    reason: z.enum(["not_asked", "store_disabled", "email_not_configured"]).nullable(),
  }),
  /** The store's booking rules the dates break (opening hours, notice, durations): never a refusal. */
  warnings: z.array(
    z.object({
      key: z.string(),
      params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    }),
  ),
  links: resourceLinksSchema,
});
export type CreateReservationOutput = z.infer<typeof createReservationOutput>;

const describeShortfalls = (shortfalls: readonly CreateShortfall[]) =>
  shortfalls
    .map(
      (shortfall) =>
        `line ${shortfall.line + 1}, ${describeShortfallLine(shortfall)}: ${shortfall.requested} asked, ${shortfall.available} free`,
    )
    .join("; ");

const OPTION_SAID: Record<ReservationCreateRefusedOption, string> = {
  custom_lines: "Lines that are not catalog products",
  price_override: "A price typed by hand",
  deposit_override: "A deposit typed by hand",
  discount: "A discount",
  promo_code: "A promo code",
  delivery: "Delivery",
  insurance: "Insurance",
  pending: "A booking left pending (the customer's own checkout)",
};

export const reservationCreateErrors = {
  /** What this version does not do: the dashboard's creation does it. */
  optionNotAvailable: (option: ReservationCreateRefusedOption, reason?: string) =>
    apiError("BAD_REQUEST", "RESERVATION_OPTION_NOT_AVAILABLE", {
      message: `${OPTION_SAID[option]} cannot be set when a reservation is created through the API.${reason ? ` ${reason}` : ""} Create it from the Louez dashboard instead. Nothing was created.`,
      i18nKey: "errors.invalidData",
      details: { option },
    }),
  /** The store requires insurance on every booking, which this version does not add. */
  insuranceRequired: () =>
    apiError("BAD_REQUEST", "RESERVATION_OPTION_NOT_AVAILABLE", {
      message:
        "This store requires insurance on every booking, and a reservation created through the API cannot add it. Create it from the Louez dashboard instead. Nothing was created.",
      i18nKey: "errors.invalidData",
      details: { option: "insurance" },
    }),
  /** The store delivers every booking: a pickup at the store is not one it takes. */
  deliveryRequired: () =>
    apiError("BAD_REQUEST", "RESERVATION_OPTION_NOT_AVAILABLE", {
      message:
        "This store delivers every booking, and a reservation created through the API is picked up at the store. Create it from the Louez dashboard instead. Nothing was created.",
      i18nKey: "errors.deliveryRequired",
      details: { option: "delivery" },
    }),
  customerNotFound: (id: string) =>
    apiError("NOT_FOUND", "CUSTOMER_NOT_FOUND", {
      message: `This store has no customer ${id}. Pass { email, firstName, lastName } to use or add a customer by e-mail.`,
      i18nKey: "errors.customerNotFound",
      details: { id },
    }),
  /** `notifyCustomer` with no address to send to. */
  customerNoEmail: (id: string) =>
    apiError("BAD_REQUEST", "CUSTOMER_EMAIL_MISSING", {
      message:
        "This customer has no e-mail address, so no message can go to them. Call again with notifyCustomer: false. Nothing was created.",
      i18nKey: "errors.invalidData",
      details: { id },
    }),
  /** A product of the store that cannot be booked now: a draft, or archived. */
  productNotBookable: (productId: string, status: string) =>
    apiError("CONFLICT", "RESERVATION_PRODUCT_NOT_BOOKABLE", {
      message: `Product ${productId} is ${status}: only an active product can be booked. Nothing was created.`,
      i18nKey: "errors.productNotFound",
      details: { productId, status },
    }),
  /**
   * The cart lacks the accessories its products require (slice 3 of
   * docs/domain/reservation-changes.md): the caller composes the cart, so
   * the composition rule applies. Each names the product that requires it.
   */
  requiredAccessoriesMissing: (
    missing: Array<{
      productId: string;
      productName: string;
      accessoryProductId: string;
      accessoryName: string;
      requiredQuantity: number;
      providedQuantity: number;
    }>,
  ) =>
    apiError("CONFLICT", "RESERVATION_REQUIRED_ACCESSORIES_MISSING", {
      message: `Products of this booking require accessories it does not hold: ${missing
        .map(
          (entry) =>
            `${entry.productName} requires ${entry.requiredQuantity} × ${entry.accessoryName} (${entry.accessoryProductId}), ${entry.providedQuantity} in the lines`,
        )
        .join("; ")}. Add them as lines and call again. Nothing was created.`,
      i18nKey: "errors.requiredAccessoriesMissing",
      details: { missing },
    }),
  invalidPhone: () =>
    apiError("BAD_REQUEST", "INVALID_ARGUMENT", {
      message: "customer.phone is not a phone number. Nothing was created.",
      i18nKey: "validation.invalidPhone",
      details: { path: "customer.phone" },
    }),
  /** Temporary contention past the retries: nothing was written, the same call may succeed. */
  busy: () =>
    apiError("CONFLICT", "RESERVATION_BUSY", {
      message:
        "The store's bookings were being changed at the same time, so nothing was created. Call again with the same arguments and idempotency key in a moment.",
      i18nKey: "errors.reservationStatusChanged",
      retryable: true,
    }),
  windowInvalid: () =>
    apiError("BAD_REQUEST", "RESERVATION_WINDOW_INVALID", {
      message: "The reservation must end after it starts. Nothing was created.",
      i18nKey: "errors.invalidData",
    }),
  /** Returnable stock short, counted without the turnover buffer. */
  insufficientCapacity: (shortfalls: CreateShortfall[]) =>
    apiError("CONFLICT", "RESERVATION_INSUFFICIENT_CAPACITY", {
      message: `Not created: the stock cannot cover this booking over its dates (${describeShortfalls(shortfalls)}). Other bookings hold the rest. To create it all the same, booking over the stock, call again with allowOverbooking: true; its history records it.`,
      i18nKey: "errors.insufficientCapacity",
      details: { shortfalls },
    }),
  /** Lines that fit the stock but not the turnover buffer. */
  turnoverBufferShortfall: (shortfalls: CreateShortfall[]) =>
    apiError("CONFLICT", "RESERVATION_TURNOVER_BUFFER_CONFLICT", {
      message: `Not created: lines fit the stock but not the turnover buffer the store keeps between rentals (${describeShortfalls(shortfalls)}). Move the dates, or, to create it all the same with less time between rentals, call again with overrideTurnoverBuffer: true; its history records it. allowOverbooking does not pass it.`,
      i18nKey: "errors.turnoverBufferShortfall",
      details: { shortfalls },
    }),
} as const;
