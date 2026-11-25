import { z } from "zod";

import { PARTNER_ATTRIBUTION_DAY_OPTIONS } from "./partner-code";

import { apiError } from "../platform/errors";
import { resourceLinksSchema } from "./links";

/**
 * Liens partenaires (docs/product/liens-partenaires.md): a store's local
 * partners, the reservations their links brought, the commission the store
 * owes them and what it says it paid. Louez computes; the store pays.
 */

export {
  DEFAULT_PARTNER_ATTRIBUTION_DAYS,
  PARTNER_ATTRIBUTION_DAY_OPTIONS,
  PARTNER_CODE_PATTERN,
  PARTNER_LINK_PARAM,
  parsePartnerCode,
  partnerAttributionDays,
  partnerCodeFromName,
  type PartnerAttributionDays,
} from "./partner-code";

export const PARTNER_COMMISSION_TYPES = ["percent", "fixed"] as const;

/**
 * How a reservation came to a partner: its link (the storefront's cookie at
 * checkout), its code typed by the customer at checkout, or the store's choice.
 */
export const PARTNER_BOOKING_ORIGINS = ["link", "code", "manual"] as const;
export type PartnerBookingOrigin = (typeof PARTNER_BOOKING_ORIGINS)[number];
export type PartnerCommissionType = (typeof PARTNER_COMMISSION_TYPES)[number];

/** A percentage of the rental (10 is 10 %) or an amount per booking, in the store's currency. */
export const partnerCommissionSchema = z
  .object({
    type: z.enum(PARTNER_COMMISSION_TYPES),
    value: z.number().positive().max(100_000),
  })
  .refine((commission) => commission.type !== "percent" || commission.value <= 100, {
    message: "A percentage is at most 100.",
    path: ["value"],
  });
export type PartnerCommission = z.infer<typeof partnerCommissionSchema>;

/**
 * Where a commission stands, from its reservation's status: `upcoming` until
 * the rental is completed, `due` once it is, `cancelled` when it never happened.
 */
export const PARTNER_COMMISSION_STATES = ["upcoming", "due", "cancelled"] as const;
export type PartnerCommissionState = (typeof PARTNER_COMMISSION_STATES)[number];

/** A statement's month, `YYYY-MM`: the month the rentals ended, in the store's timezone. */
export const partnerMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** How many past months the statement's month picker offers, the current one included. */
export const PARTNER_STATEMENT_MONTHS = 12;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullable()
    .optional();

export const partnerFieldsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  contactName: optionalText(120),
  contactEmail: z
    .union([z.literal(""), z.string().trim().email().max(255)])
    .transform((value) => value || null)
    .nullable()
    .optional(),
  contactPhone: optionalText(40),
  commission: partnerCommissionSchema,
  /** One of the store's promo codes, applied at checkout for the partner's customers. */
  promoCodeId: z.string().min(1).max(21).nullable().optional(),
});
export type PartnerFields = z.infer<typeof partnerFieldsSchema>;

const contactSchema = z.object({
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
});

export const partnerSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  commission: z.object({ type: z.enum(PARTNER_COMMISSION_TYPES), value: z.number() }),
  contact: contactSchema,
  /** The customer perk of its link: a promo code of the store, or null. */
  perk: z.object({ promoCodeId: z.string(), code: z.string() }).nullable(),
  /** Whether the partner gets any e-mail (an address, and at least one kind turned on). */
  notified: z.boolean(),
  archived: z.boolean(),
  createdAt: z.date(),
});
export type Partner = z.infer<typeof partnerSchema>;

/** A month's figures for a partner. Amounts in `currency`, rounded to its minor unit. */
export const partnerMonthTotalsSchema = z.object({
  /** Reservations attributed, cancelled ones included. */
  bookings: z.number().int(),
  /** Commissions of completed rentals: what the store owes. */
  due: z.number(),
  /** Commissions of rentals still to come. */
  upcoming: z.number(),
  /** What the store marked paid for the month. */
  paid: z.number(),
  /** `due − paid`: negative when a rental changed after the store paid. */
  remaining: z.number(),
  /** Visits by the partner's link over the month (distinct storefront sessions). */
  visits: z.number().int(),
});
export type PartnerMonthTotals = z.infer<typeof partnerMonthTotalsSchema>;

export const partnerBookingSchema = z.object({
  reservationId: z.string(),
  number: z.string(),
  startDate: z.date(),
  endDate: z.date(),
  /** The rental the commission is computed on: lines after discount, no deposit, delivery or insurance. */
  base: z.number(),
  /** What the rule gives on `base`, before any adjustment. */
  computed: z.number(),
  /** What the store owes for it: the adjustment when there is one, else `computed`. */
  commission: z.number(),
  adjustment: z.object({ amount: z.number(), note: z.string().nullable() }).nullable(),
  rule: z.object({ type: z.enum(PARTNER_COMMISSION_TYPES), value: z.number() }),
  state: z.enum(PARTNER_COMMISSION_STATES),
  origin: z.enum(PARTNER_BOOKING_ORIGINS),
});
export type PartnerBooking = z.infer<typeof partnerBookingSchema>;

export const partnerPayoutSchema = z.object({
  id: z.string(),
  amount: z.number(),
  paidAt: z.date(),
});

/** A partner's statement for a month: what the store reads and exports. */
export const partnerStatementSchema = z.object({
  partner: partnerSchema,
  currency: z.string(),
  month: partnerMonthSchema,
  totals: partnerMonthTotalsSchema,
  bookings: z.array(partnerBookingSchema),
  payouts: z.array(partnerPayoutSchema),
});
export type PartnerStatement = z.infer<typeof partnerStatementSchema>;

// --- Procedures ---------------------------------------------------------------

export const listPartnersInput = z.object({
  month: partnerMonthSchema
    .optional()
    .describe(
      "The month to sum up, YYYY-MM, in the store's time zone. Defaults to the current one.",
    ),
});
/** The store's settings of Liens partenaires. */
export const partnerSettingsSchema = z.object({
  /** How long a partner link holds, from the click to the booking. */
  attributionDays: z.number().int(),
});
export type PartnerSettings = z.infer<typeof partnerSettingsSchema>;

export const listPartnersOutput = z.object({
  currency: z.string(),
  month: partnerMonthSchema,
  partners: z.array(partnerSchema.extend({ totals: partnerMonthTotalsSchema })),
  settings: partnerSettingsSchema,
  /** The store's active promo codes, to offer as a partner's customer perk. */
  promoCodes: z.array(z.object({ id: z.string(), code: z.string() })),
  /** The dashboard's partners page. */
  links: resourceLinksSchema,
});
export type PartnerList = z.infer<typeof listPartnersOutput>;

export const getPartnerStatementInput = z.object({
  partnerId: z.string().min(1).max(21).describe("The partner's id, from partners_list."),
  month: partnerMonthSchema
    .optional()
    .describe("The month, YYYY-MM: the month the rentals end in. Defaults to the current one."),
});
export const getPartnerStatementOutput = partnerStatementSchema.extend({
  /** The months the picker offers, most recent first (`PARTNER_STATEMENT_MONTHS`). */
  months: z.array(partnerMonthSchema),
  /** The secret of the partner's own space (`/partner/<token>`). */
  statementToken: z.string(),
  /** The partner's page of the dashboard. */
  links: resourceLinksSchema,
});
export type PartnerStatementView = z.infer<typeof getPartnerStatementOutput>;

export const createPartnerInput = partnerFieldsSchema;
export const updatePartnerInput = partnerFieldsSchema.extend({
  partnerId: z.string().min(1).max(21),
});
export const partnerOutput = partnerSchema;

export const setPartnerArchivedInput = z.object({
  partnerId: z.string().min(1).max(21),
  archived: z.boolean(),
});

export const updatePartnerSettingsInput = z.object({
  attributionDays: z
    .number()
    .int()
    .refine((days) => (PARTNER_ATTRIBUTION_DAY_OPTIONS as readonly number[]).includes(days), {
      message: "One of the attribution windows on offer.",
    }),
});

export const rotatePartnerStatementTokenInput = z.object({
  partnerId: z.string().min(1).max(21),
});
export const rotatePartnerStatementTokenOutput = z.object({ statementToken: z.string() });

export const markPartnerMonthPaidInput = z.object({
  partnerId: z.string().min(1).max(21),
  month: partnerMonthSchema,
});
export const cancelPartnerPayoutInput = z.object({
  payoutId: z.string().min(1).max(21),
});
export const partnerTotalsOutput = partnerMonthTotalsSchema;

export const adjustPartnerCommissionInput = z.object({
  reservationId: z.string().min(1).max(21),
  /** Null removes the adjustment: the rule's amount applies again. */
  amount: z.number().min(0).max(1_000_000).nullable(),
  note: optionalText(200),
});

export const getReservationPartnerInput = z.object({
  reservationId: z.string().min(1).max(21),
});
export const reservationPartnerSchema = z.object({
  /** The partner it is attributed to, or null. */
  current: z
    .object({
      partnerId: z.string(),
      name: z.string(),
      origin: z.enum(PARTNER_BOOKING_ORIGINS),
      commission: z.number(),
      state: z.enum(PARTNER_COMMISSION_STATES),
    })
    .nullable(),
  currency: z.string(),
  /** The partners it can be attributed to: the active ones. */
  options: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type ReservationPartner = z.infer<typeof reservationPartnerSchema>;

export const setReservationPartnerInput = z.object({
  reservationId: z.string().min(1).max(21),
  /** Null removes the attribution. */
  partnerId: z.string().min(1).max(21).nullable(),
});

/** What a partner sets in its own space: where its e-mails go, and which ones. */
export const partnerNotificationsSchema = z.object({
  email: z
    .union([z.literal(""), z.string().trim().email().max(255)])
    .transform((value) => value || null)
    .nullable(),
  bookings: z.boolean(),
  payouts: z.boolean(),
  statements: z.boolean(),
});
export type PartnerNotifications = z.infer<typeof partnerNotificationsSchema>;

// --- Storefront ---------------------------------------------------------------

/**
 * What a customer sees of a partner's perk at checkout: the discount, never
 * the promo code behind it, which the server applies at booking.
 */
export interface PartnerPerkView {
  type: "percentage" | "fixed";
  value: number;
  /** The rental subtotal the discount needs; 0 for none. */
  minimumAmount: number;
}

/** A partner's code checked at checkout, as the storefront may see the answer. */
export type PartnerCodeCheck =
  | { status: "found"; partner: { name: string; perk: PartnerPerkView | null } }
  /** The same for an unknown store and an unknown code. */
  | { status: "not_found" }
  | { status: "rate_limited"; retryAfterSeconds: number };

export const partnerErrors = {
  notFound: () =>
    apiError("NOT_FOUND", "PARTNER_NOT_FOUND", {
      message: "This partner does not exist in this store.",
      i18nKey: "errors.partnerNotFound",
    }),
  reservationNotFound: () =>
    apiError("NOT_FOUND", "RESERVATION_NOT_FOUND", {
      message: "This reservation does not exist in this store.",
      i18nKey: "errors.reservationNotFound",
    }),
  notAttributed: () =>
    apiError("CONFLICT", "PARTNER_RESERVATION_NOT_ATTRIBUTED", {
      message: "This reservation is not attributed to a partner.",
      i18nKey: "errors.partnerReservationNotAttributed",
    }),
  perkNotFound: () =>
    apiError("NOT_FOUND", "PARTNER_PERK_NOT_FOUND", {
      message: "This promo code does not exist in this store.",
      i18nKey: "errors.partnerPerkNotFound",
    }),
  nothingToPay: () =>
    apiError("CONFLICT", "PARTNER_NOTHING_TO_PAY", {
      message: "Nothing is left to pay this partner for this month.",
      i18nKey: "errors.partnerNothingToPay",
    }),
} as const;
