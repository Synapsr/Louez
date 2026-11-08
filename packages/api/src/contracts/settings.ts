import {
  closurePeriodSchema,
  dayScheduleSchema,
  isPossiblePhoneNumberInput,
} from "@louez/validations";
import {
  SUPPORTED_COUNTRIES,
  SUPPORTED_CURRENCY_CODES,
  WEEK_DAYS,
  type WeekDay,
} from "@louez/utils";
import { z } from "zod";

import { apiError } from "../platform/errors";
import { resourceLinksSchema } from "./links";
import { appearanceView } from "./online-store";

/**
 * The store settings contract: what a store needs before it goes live, read
 * in one call and written section by section (store info, company, legal
 * texts, reservation rules, business hours, delivery and pickup points,
 * taxes). No database here.
 */

/** Bounds checked before any lock. A store above one keeps what it has; it may not grow. */
export const SETTINGS_LIMITS = {
  /** Pickup and return points of a store. */
  locations: 50,
  /** Closure periods in the business hours. */
  closurePeriods: 200,
  /** Opening ranges in one day. */
  rangesPerDay: 4,
  /** Characters of an editor HTML text (description, terms, legal notice). */
  richText: 100_000,
  /** Longest duration a rule takes: one year, in minutes. */
  maxMinutes: 525_600,
} as const;

const COUNTRY_CODES = SUPPORTED_COUNTRIES.map((country) => country.code) as [string, ...string[]];

const countryField = z
  .enum(COUNTRY_CODES)
  .describe("An ISO 3166-1 alpha-2 code among the countries Louez supports (FR).");

/** Money in the store's currency, as a decimal string ("1.50"). */
const moneyField = (max: number) =>
  z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/, "A decimal string such as 1.50")
    .refine((value) => Number(value) <= max, `At most ${max}`);

const optionalText = (max: number) => z.string().trim().max(max).nullable();

// --- Sections as they are read ---------------------------------------------

const dayScheduleView = z.object({
  isOpen: z.boolean(),
  ranges: z.array(z.object({ openTime: z.string(), closeTime: z.string() })),
});

const weekScheduleView = z.object(
  Object.fromEntries(WEEK_DAYS.map((day) => [day, dayScheduleView])) as Record<
    WeekDay,
    typeof dayScheduleView
  >,
);

const closurePeriodView = z.object({
  id: z.string(),
  name: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  reason: z.string().optional(),
});

export const storeInfoView = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  /** Editor HTML. */
  description: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  /** False while the store has not been launched: its storefront answers 404. */
  online: z.boolean(),
});

export const companyView = z.object({
  country: z.string().nullable(),
  /** Follows the country. */
  timezone: z.string().nullable(),
  currency: z.string(),
  billingAddress: z.object({
    sameAsStore: z.boolean(),
    address: z.string().nullable(),
    city: z.string().nullable(),
    postalCode: z.string().nullable(),
    country: z.string().nullable(),
  }),
});

export const legalView = z.object({
  /** Terms and conditions (CGV), editor HTML. */
  cgv: z.string().nullable(),
  /** Legal notice (mentions légales), editor HTML. */
  legalNotice: z.string().nullable(),
  includeCgvInContract: z.boolean(),
  /** Plain text at the bottom of the storefront footer. */
  footerNote: z.string().nullable(),
});

export const reservationRulesView = z.object({
  reservationMode: z.enum(["payment", "request"]),
  pendingBlocksAvailability: z.boolean(),
  onlinePaymentDepositPercentage: z.number().int(),
  minRentalMinutes: z.number().int(),
  maxRentalMinutes: z.number().int().nullable(),
  advanceNoticeMinutes: z.number().int(),
  turnoverBufferMinutes: z.number().int(),
  requireCustomerAddress: z.boolean(),
  automaticExtensions: z.boolean(),
  maxExtensionDays: z.number().int().nullable(),
});

export const businessHoursView = z.object({
  enabled: z.boolean(),
  schedule: weekScheduleView,
  closurePeriods: z.array(closurePeriodView),
});

export const deliveryView = z.object({
  enabled: z.boolean(),
  mode: z.enum(["optional", "required", "included"]),
  multiLocationEnabled: z.boolean(),
  pricePerKm: z.string(),
  minimumFee: z.string(),
  maximumDistanceKm: z.number().nullable(),
  freeDeliveryThreshold: z.string().nullable(),
  minimumOrderAmountForDelivery: z.string().nullable(),
  currency: z.string(),
});

export const locationView = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
  city: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  isActive: z.boolean(),
  /** The store's delivery and pickup settings page. */
  links: resourceLinksSchema,
});

export const taxesView = z.object({
  enabled: z.boolean(),
  /** Percent, such as 20 for 20 %. */
  defaultRate: z.number(),
  /** inclusive: prices include tax (TTC); exclusive: tax is added on top (HT). */
  displayMode: z.enum(["inclusive", "exclusive"]),
  taxLabel: z.string().nullable(),
  taxNumber: z.string().nullable(),
});

// --- settings.get -----------------------------------------------------------

export const getSettingsInput = z.object({
  // A GET takes it from the query string, as "true" or "false".
  includeLegalTexts: z
    .union([z.boolean(), z.enum(["true", "false"]).transform((value) => value === "true")])
    .optional()
    .describe(
      "true returns the full terms and legal notice (up to 100,000 characters each). Left out, they come as a summary: whether each is set and its length.",
    ),
});

/** A legal text as settings.get shows it by default: set or not, and how long. */
const legalTextSummary = z.object({
  set: z.boolean(),
  /** Characters of its editor HTML. */
  length: z.number().int(),
  /** The editor HTML, only with includeLegalTexts. */
  text: z.string().nullable().optional(),
});

export const legalSummaryView = z.object({
  cgv: legalTextSummary,
  legalNotice: legalTextSummary,
  includeCgvInContract: z.boolean(),
  footerNote: z.string().nullable(),
  /** When the store's settings last changed (any of them): no date is kept per text. */
  updatedAt: z.date(),
  /** Whether `text` holds the full texts (includeLegalTexts). */
  textsIncluded: z.boolean(),
});

export const getSettingsOutput = z.object({
  store: storeInfoView,
  company: companyView,
  legal: legalSummaryView,
  reservationRules: reservationRulesView,
  businessHours: businessHoursView,
  delivery: deliveryView,
  locations: z.array(locationView),
  taxes: taxesView,
  storefront: z.object({
    /** The store's web address; online_store_update_slug moves it. */
    slug: z.string(),
    /** The storefront's home; it answers the public once the store is online. */
    url: z.string(),
    /** Editor HTML, a short lead under the name on the home page. */
    tagline: z.string().nullable(),
    /** The storefront's fallback language (ISO 639-1); null follows the visitor's browser. */
    locale: z.string().nullable(),
    appearance: appearanceView,
    /** The online store editor. */
    links: resourceLinksSchema,
  }),
  payments: z.object({
    /** Card payments work at checkout only once Stripe is connected (a link from the dashboard). */
    stripeChargesEnabled: z.boolean(),
  }),
  /** The store's settings in the dashboard and, once it is online, its storefront. */
  links: resourceLinksSchema,
});

// --- Writes -----------------------------------------------------------------

export const updateStoreInfoInput = z.object({
  name: z
    .string()
    .trim()
    .min(2)
    .max(255)
    .optional()
    .describe("The store's name, as customers see it."),
  description: z
    .string()
    .max(SETTINGS_LIMITS.richText)
    .nullable()
    .optional()
    .describe(
      "What the store rents, shown on the storefront. Plain text or simple HTML; null clears it.",
    ),
  email: z
    .email()
    .max(255)
    .nullable()
    .optional()
    .describe("Contact e-mail shown to customers; null clears it."),
  phone: z
    .string()
    .trim()
    .max(50)
    .refine((value) => isPossiblePhoneNumberInput(value), "Not a phone number")
    .nullable()
    .optional()
    .describe("Contact phone shown to customers, in international format (+33…); null clears it."),
  address: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .nullable()
    .optional()
    .describe("The store's postal address, on one line; null clears it."),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
});
export type UpdateStoreInfoInput = z.infer<typeof updateStoreInfoInput>;

export const updateStoreInfoOutput = z.object({ store: storeInfoView, links: resourceLinksSchema });

const billingAddressInput = z.discriminatedUnion("sameAsStore", [
  z.object({ sameAsStore: z.literal(true) }),
  z.object({
    sameAsStore: z.literal(false),
    address: z.string().trim().max(500),
    city: z.string().trim().max(255),
    postalCode: z.string().trim().max(20),
    country: countryField,
  }),
]);

export const updateCompanyInput = z.object({
  country: countryField
    .optional()
    .describe(
      "Where the company is. It sets the store's time zone, which every date and opening hour follows.",
    ),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional()
    .describe(
      `The currency of every price, deposit and payment, among ${SUPPORTED_CURRENCY_CODES.join(", ")}. Existing reservations keep their own. A store set up in a currency no longer on the list may send it back unchanged.`,
    ),
  billingAddress: billingAddressInput
    .optional()
    .describe(
      "The address printed on contracts and invoices: { sameAsStore: true }, or { sameAsStore: false, address, city, postalCode, country }.",
    ),
});
export type UpdateCompanyInput = z.infer<typeof updateCompanyInput>;

export const updateCompanyOutput = z.object({ company: companyView, links: resourceLinksSchema });

export const updateLegalInput = z.object({
  cgv: z
    .string()
    .max(SETTINGS_LIMITS.richText)
    .nullable()
    .optional()
    .describe("Terms and conditions (CGV): plain text or simple HTML; null clears them."),
  legalNotice: z
    .string()
    .max(SETTINGS_LIMITS.richText)
    .nullable()
    .optional()
    .describe("Legal notice (mentions légales): plain text or simple HTML; null clears it."),
  includeCgvInContract: z
    .boolean()
    .optional()
    .describe("Print the full terms in every rental contract."),
  footerNote: optionalText(500)
    .optional()
    .describe(
      "Plain text at the bottom of the storefront footer (company id, accreditation); null clears it.",
    ),
});
export type UpdateLegalInput = z.infer<typeof updateLegalInput>;

export const updateLegalOutput = z.object({ legal: legalView, links: resourceLinksSchema });

const minutesField = (min: number) => z.number().int().min(min).max(SETTINGS_LIMITS.maxMinutes);

export const updateReservationRulesInput = z.object({
  reservationMode: z
    .enum(["payment", "request"])
    .optional()
    .describe(
      "payment: customers pay online when they book (needs Stripe connected). request: customers send a request the store accepts or declines, and pay later.",
    ),
  pendingBlocksAvailability: z
    .boolean()
    .optional()
    .describe("In request mode: whether an unanswered request already holds the stock."),
  onlinePaymentDepositPercentage: z
    .number()
    .int()
    .min(10)
    .max(100)
    .optional()
    .describe(
      "In payment mode: the share of the rental paid at booking, 10 to 100; the rest is paid at pickup.",
    ),
  minRentalMinutes: minutesField(0).optional().describe("Shortest rental, in minutes; 0 for none."),
  maxRentalMinutes: minutesField(1)
    .nullable()
    .optional()
    .describe("Longest rental, in minutes; null for no limit."),
  advanceNoticeMinutes: minutesField(0)
    .optional()
    .describe("How long before its start a rental may be booked, in minutes (1440 = a day)."),
  turnoverBufferMinutes: z
    .number()
    .int()
    .min(0)
    .max(10080)
    .optional()
    .describe(
      "Time after each return before the item can go out again, in minutes, a week at most.",
    ),
  requireCustomerAddress: z
    .boolean()
    .optional()
    .describe("Ask customers for their postal address at checkout."),
  automaticExtensions: z
    .boolean()
    .optional()
    .describe("Let customers extend a rental from their account."),
  maxExtensionDays: z
    .number()
    .int()
    .min(1)
    .max(365)
    .nullable()
    .optional()
    .describe("Longest extension a customer may ask, in days; null for no limit."),
});
export type UpdateReservationRulesInput = z.infer<typeof updateReservationRulesInput>;

export const updateReservationRulesOutput = z.object({
  reservationRules: reservationRulesView,
  links: resourceLinksSchema,
});

const dayScheduleInput = dayScheduleSchema.refine(
  (day) => day.ranges.length <= SETTINGS_LIMITS.rangesPerDay,
  `At most ${SETTINGS_LIMITS.rangesPerDay} ranges a day`,
);

/** A closure as the dashboard's dialog checks it; a new one may come without its id. */
const closurePeriodInput = z
  .object({
    id: z.string().min(1).max(64).optional().describe("Keep the id of a closure you send back."),
    name: z.string().min(1).max(100),
    startDate: z.string().max(40).describe("YYYY-MM-DD, included."),
    endDate: z.string().max(40).describe("YYYY-MM-DD, included."),
    startTime: z.string().max(5).optional().describe("HH:mm, for a closure of part of a day."),
    endTime: z.string().max(5).optional().describe("HH:mm, with startTime."),
    reason: z.string().max(500).optional(),
  })
  .superRefine((value, ctx) => {
    const checked = closurePeriodSchema.safeParse({ ...value, id: value.id ?? "new" });
    if (checked.success) return;
    for (const issue of checked.error.issues) {
      ctx.addIssue({ code: "custom", message: issue.message, path: issue.path });
    }
  });

export const updateBusinessHoursInput = z.object({
  enabled: z
    .boolean()
    .optional()
    .describe("false: the store takes bookings at any time; true: only within the hours below."),
  schedule: z
    .object(
      Object.fromEntries(WEEK_DAYS.map((day) => [day, dayScheduleInput.optional()])) as Record<
        WeekDay,
        z.ZodOptional<typeof dayScheduleInput>
      >,
    )
    .optional()
    .describe(
      'Days to change, by name: { "monday": { "isOpen": true, "ranges": [{ "openTime": "09:00", "closeTime": "12:00" }, { "openTime": "14:00", "closeTime": "18:00" }] } }. Times are HH:mm in the store\'s time zone; days left out stay as they are.',
    ),
  closurePeriods: z
    .array(closurePeriodInput)
    .max(SETTINGS_LIMITS.closurePeriods)
    .optional()
    .describe(
      "Replaces every closure (holidays, events): { name, startDate, endDate } as YYYY-MM-DD, both included, with startTime and endTime (HH:mm) for part of a day. Send the current list with your change to keep the others.",
    ),
});
export type UpdateBusinessHoursInput = z.infer<typeof updateBusinessHoursInput>;

export const updateBusinessHoursOutput = z.object({
  businessHours: businessHoursView,
  links: resourceLinksSchema,
});

export const updateDeliveryInput = z.object({
  enabled: z
    .boolean()
    .optional()
    .describe(
      "Offer delivery to the customer's address. Needs the store's coordinates (settings_update_store_info).",
    ),
  mode: z
    .enum(["optional", "required", "included"])
    .optional()
    .describe(
      "optional: the customer picks pickup or delivery; required: outbound delivery is mandatory; included: mandatory and free.",
    ),
  multiLocationEnabled: z
    .boolean()
    .optional()
    .describe("Let customers pick one of the store's active pickup points."),
  pricePerKm: moneyField(100).optional().describe("Fee per kilometre, in the store's currency."),
  minimumFee: moneyField(1000)
    .optional()
    .describe("Lowest fee for each leg, whatever the distance."),
  maximumDistanceKm: z
    .number()
    .min(1)
    .max(500)
    .nullable()
    .optional()
    .describe("Farthest delivery, in kilometres; null for no limit."),
  freeDeliveryThreshold: moneyField(100_000)
    .nullable()
    .optional()
    .describe("Order amount from which delivery is free; null for never."),
  minimumOrderAmountForDelivery: moneyField(100_000)
    .nullable()
    .optional()
    .describe("Smallest order delivered; null for any."),
});
export type UpdateDeliveryInput = z.infer<typeof updateDeliveryInput>;

export const updateDeliveryOutput = z.object({
  delivery: deliveryView,
  links: resourceLinksSchema,
});

const locationFields = {
  name: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .describe('How customers see the point ("Plage du Moulin Blanc").'),
  address: z.string().trim().min(1).max(1000),
  city: z.string().trim().max(255).nullable().optional(),
  postalCode: z.string().trim().max(20).nullable().optional(),
  country: countryField.nullable().optional().describe("Defaults to the store's country."),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
};

export const createLocationInput = z.object(locationFields);
export type CreateLocationInput = z.infer<typeof createLocationInput>;

export const updateLocationInput = z.object({
  id: z.string().min(1).max(64),
  name: locationFields.name.optional(),
  address: locationFields.address.optional(),
  city: locationFields.city,
  postalCode: locationFields.postalCode,
  country: locationFields.country,
  latitude: locationFields.latitude,
  longitude: locationFields.longitude,
});
export type UpdateLocationInput = z.infer<typeof updateLocationInput>;

export const setLocationActiveInput = z.object({
  id: z.string().min(1).max(64),
  isActive: z
    .boolean()
    .describe("false hides the point from checkout; its past reservations keep it."),
});

export const locationOutput = locationView;

export const updateTaxesInput = z.object({
  enabled: z.boolean().optional().describe("Show and charge tax on prices."),
  defaultRate: z.number().min(0).max(100).optional().describe("Percent, such as 20 for 20 %."),
  displayMode: z
    .enum(["inclusive", "exclusive"])
    .optional()
    .describe("inclusive: prices include tax (TTC); exclusive: tax is added on top (HT)."),
  taxLabel: optionalText(20)
    .optional()
    .describe('The tax\'s name on documents ("TVA", "VAT"); null for the default.'),
  taxNumber: optionalText(30).optional().describe("The store's tax number; null clears it."),
});
export type UpdateTaxesInput = z.infer<typeof updateTaxesInput>;

export const updateTaxesOutput = z.object({ taxes: taxesView, links: resourceLinksSchema });

// --- Errors -----------------------------------------------------------------

export const settingsErrors = {
  coordinatesRequired: () =>
    apiError("BAD_REQUEST", "STORE_COORDINATES_REQUIRED", {
      message:
        "Delivery is measured from the store, which has no coordinates yet. Set its latitude and longitude with settings_update_store_info first.",
      i18nKey: "errors.storeCoordinatesNotConfigured",
    }),
  stripeRequired: () =>
    apiError("PRECONDITION_FAILED", "STRIPE_REQUIRED", {
      message:
        "Online payment needs a connected Stripe account, and this store has none yet. The user connects Stripe in the dashboard (Settings > Payments); until then, keep the request mode.",
      i18nKey: "errors.stripeRequiredForPaymentMode",
    }),
  locationNotFound: (id: string) =>
    apiError("NOT_FOUND", "LOCATION_NOT_FOUND", {
      message: `No pickup point ${id} in this store. List them with settings_get.`,
      i18nKey: "errors.locationNotFound",
      details: { id },
    }),
  locationLimit: (limit: number) =>
    apiError("BAD_REQUEST", "LOCATION_LIMIT_REACHED", {
      message: `A store has ${limit} pickup points at most. Deactivate or reuse one instead.`,
      i18nKey: "errors.locationLimitReached",
      details: { limit },
    }),
  currencyNotSupported: (currency: string) =>
    apiError("BAD_REQUEST", "CURRENCY_NOT_SUPPORTED", {
      message: `Louez does not take ${currency}. Pick one of ${SUPPORTED_CURRENCY_CODES.join(", ")}.`,
      i18nKey: "errors.invalidData",
      details: { currency, supported: [...SUPPORTED_CURRENCY_CODES] },
    }),
  nothingToUpdate: () =>
    apiError("BAD_REQUEST", "NOTHING_TO_UPDATE", {
      message: "Send at least one field to change.",
      i18nKey: "errors.invalidData",
    }),
  rangeInvalid: (message: string) =>
    apiError("BAD_REQUEST", "SETTINGS_INVALID", {
      message,
      i18nKey: "errors.invalidData",
    }),
} as const;
