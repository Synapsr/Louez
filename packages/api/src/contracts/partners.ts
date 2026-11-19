import { z } from "zod";

import { apiError } from "../platform/errors";

/**
 * Liens partenaires (docs/product/liens-partenaires.md): a store's local
 * partners, the reservations their links brought, the commission the store
 * owes them and what it says it paid. Louez computes; the store pays.
 */

/** The query parameter of a partner link: `https://<store>/?partner=les-pins`. */
export const PARTNER_LINK_PARAM = "partner";

/** How long a customer's "yes, credit them" holds, from the link to the booking. */
export const PARTNER_ATTRIBUTION_DAYS = 30;

/** Lowercase letters, digits and inner dashes, 2 to 40 characters. */
export const PARTNER_CODE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$/;

/** The code a link names, or null for anything that cannot be a code. */
export const parsePartnerCode = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const code = value.trim().toLowerCase();
  return PARTNER_CODE_PATTERN.test(code) ? code : null;
};

/**
 * A code drawn from the partner's name, accents and punctuation dropped:
 * "Camping Les Pins" gives `camping-les-pins`. Null when nothing is left.
 */
export const partnerCodeFromName = (name: string): string | null => {
  const code = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 34)
    .replace(/-+$/g, "");
  return parsePartnerCode(code);
};

export const PARTNER_COMMISSION_TYPES = ["percent", "fixed"] as const;
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
  origin: z.enum(["link", "manual"]),
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

export const listPartnersInput = z.object({ month: partnerMonthSchema.optional() });
export const listPartnersOutput = z.object({
  currency: z.string(),
  month: partnerMonthSchema,
  partners: z.array(partnerSchema.extend({ totals: partnerMonthTotalsSchema })),
});
export type PartnerList = z.infer<typeof listPartnersOutput>;

export const getPartnerStatementInput = z.object({
  partnerId: z.string().min(1).max(21),
  month: partnerMonthSchema.optional(),
});
export const getPartnerStatementOutput = partnerStatementSchema.extend({
  /** The months the picker offers, most recent first (`PARTNER_STATEMENT_MONTHS`). */
  months: z.array(partnerMonthSchema),
  /** The secret of the partner's read-only page (`/partner-statements/<token>`). */
  statementToken: z.string(),
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
      origin: z.enum(["link", "manual"]),
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
  nothingToPay: () =>
    apiError("CONFLICT", "PARTNER_NOTHING_TO_PAY", {
      message: "Nothing is left to pay this partner for this month.",
      i18nKey: "errors.partnerNothingToPay",
    }),
} as const;
