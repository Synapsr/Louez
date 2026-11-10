import { storeInfoSchema } from "@louez/validations";
import { SUPPORTED_COUNTRIES, SUPPORTED_CURRENCY_CODES } from "@louez/utils";
import { z } from "zod";

import { apiError } from "../platform/errors";
import { resourceLinksSchema } from "./links";

/**
 * The stores contract: the stores a connection may act on, and a new one,
 * before any store exists. No database here.
 */

/** Largest page `stores.list` returns, and its default. */
export const STORE_PAGE_MAX = 100;

export const listStoresInput = z.object({
  cursor: z
    .string()
    .max(64)
    .optional()
    .describe("The nextCursor of the previous page. Leave it out for the first page."),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(STORE_PAGE_MAX)
    .optional()
    .describe(`Stores per page, ${STORE_PAGE_MAX} at most and by default.`),
});

export const storeSummarySchema = z.object({
  /** Pass it as `storeId` to a tool, or in the Louez-Store header. */
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  /** The user's role in the store; what the connection may do there is this role cut down to its rights. */
  role: z.enum(["owner", "member"]),
  /** The store's dashboard, and its storefront once the store is online. */
  links: resourceLinksSchema,
});

export const listStoresOutput = z.object({
  items: z.array(storeSummarySchema),
  /** Null on the last page. */
  nextCursor: z.string().nullable(),
  /** What to do when the connection reaches no store: create one, or ask the user. */
  hint: z.string().optional(),
});

// --- A new store ------------------------------------------------------------

/** Stores a key or a token may create per account in 24 hours. A session has no cap. */
export const STORE_CREATION_DAILY_LIMIT = 3;

/** How many free addresses `stores_check_slug_availability` suggests. */
export const SLUG_SUGGESTION_COUNT = 3;

const COUNTRY_CODES = SUPPORTED_COUNTRIES.map((country) => country.code) as [string, ...string[]];

/** A currency a store may use: the ones the app formats and Stripe charges in. */
export const currencyField = z
  .enum(SUPPORTED_CURRENCY_CODES)
  .describe(`An ISO 4217 code among ${SUPPORTED_CURRENCY_CODES.join(", ")}.`);

const slugField = storeInfoSchema.shape.slug.describe(
  "The store's web address: 3 to 50 lowercase letters, digits and hyphens. Check it first with stores_check_slug_availability.",
);

export const checkSlugAvailabilityInput = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe("The web address to check. A name works too: suggestions come from it."),
});

export const checkSlugAvailabilityOutput = z.object({
  slug: z.string(),
  available: z.boolean(),
  /** Why not: another store has it, Louez keeps it, or it breaks the rules above. */
  reason: z.enum(["taken", "reserved", "invalid"]).nullable(),
  /** Free addresses close to the one asked, when it is not available. */
  suggestions: z.array(z.string()),
});

export const createStoreInput = z.object({
  name: storeInfoSchema.shape.name.describe("The store's name, as customers see it."),
  slug: slugField,
  country: z
    .enum(COUNTRY_CODES)
    .describe("Where the store is, as an ISO 3166-1 alpha-2 code (FR). It sets the time zone."),
  currency: currencyField.describe("The store's currency, as an ISO 4217 code (EUR)."),
  address: storeInfoSchema.shape.address.describe("The store's postal address, on one line."),
  latitude: storeInfoSchema.shape.latitude,
  longitude: storeInfoSchema.shape.longitude,
  email: storeInfoSchema.shape.email.describe("The store's contact e-mail, shown to customers."),
  phone: storeInfoSchema.shape.phone.describe(
    "The store's contact phone, in international format (+33…).",
  ),
});
export type CreateStoreInput = z.infer<typeof createStoreInput>;

/**
 * The onboarding's store step, on a store the user already has: the one it
 * edits (`storeId`), else the active store if it is an incomplete store of
 * theirs, else their incomplete store (the one with this web address first).
 * The same fields as a new store's.
 */
export const updateOnboardingInfoInput = createStoreInput.extend({
  storeId: z
    .string()
    .length(21)
    .nullable()
    .optional()
    .describe("The store the step edits; null or left out for the one being onboarded."),
});
export type UpdateOnboardingInfoInput = z.infer<typeof updateOnboardingInfoInput>;

export const updateOnboardingInfoOutput = z.object({
  /** The store saved; null when the user has none to finish (the step creates one with stores.create). */
  id: z.string().nullable(),
  /** The store was online already: the owner came back to the step. */
  online: z.boolean(),
  /** The user saved an incomplete store they own: the page reports the signup to Klibon. */
  ownerSaved: z.boolean(),
});

const feeTierSchema = z.object({
  /** The band ends at this many reservations in the month; null: no end. */
  upToReservationsPerMonth: z.number().int().nullable(),
  amount: z.string(),
  currency: z.string(),
});

/**
 * What a store created now pays Louez, from the billing code: nothing on an
 * instance without platform billing, Louez's pay-as-you-go pricing, or the
 * offer of the billing service, whose label is the figure.
 */
export const newStoreTermsSchema = z.discriminatedUnion("billing", [
  z.object({ billing: z.literal("none"), summary: z.string() }),
  z.object({
    billing: z.literal("pay_as_you_go"),
    /** Reservations without a fee, as a welcome gift. */
    freeReservations: z.number().int(),
    feePerReservation: z.array(feeTierSchema),
    summary: z.string(),
  }),
  z.object({
    billing: z.literal("offer"),
    offer: z.string().nullable(),
    summary: z.string(),
  }),
]);
export type NewStoreTermsView = z.infer<typeof newStoreTermsSchema>;

export const createStoreOutput = z.object({
  /** Pass it as `storeId` to the other tools. */
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  country: z.string(),
  currency: z.string(),
  timezone: z.string(),
  /** False: the store is offline until the user launches it. */
  online: z.boolean(),
  /** The store's dashboard; no storefront link while it is offline. */
  links: resourceLinksSchema,
  /** Where the storefront will answer once the store is launched. Not open yet. */
  futureStorefrontUrl: z.string(),
  pricing: newStoreTermsSchema,
  /** What the agent can do next, with the tools that exist. */
  nextSteps: z.array(z.string()),
});

/**
 * What an agent that may not create stores (ChatGPT: `stores` withheld by
 * its directory) tells a user with none: no link, no onboarding URL.
 */
export const NO_STORE_ASK_USER =
  "This user has no store yet. Ask them to create it in Louez, then continue here.";

export const storeErrors = {
  slugTaken: (slug: string, suggestions: string[]) =>
    apiError("CONFLICT", "STORE_SLUG_TAKEN", {
      message: `The web address "${slug}" is taken. Pick another one${suggestions.length > 0 ? `, such as ${suggestions.join(", ")}` : ""}.`,
      i18nKey: "errors.slugTaken",
      details: { slug, suggestions },
    }),
  creationLimit: (limit: number) =>
    apiError("TOO_MANY_REQUESTS", "STORE_CREATION_LIMIT", {
      message: `This account created ${limit} stores in the last 24 hours, the most an agent or an API key may. Try again tomorrow, or create the store in Louez.`,
      retryable: true,
      details: { limit, windowHours: 24 },
    }),
  termsChanged: () =>
    apiError("PRECONDITION_FAILED", "STORE_TERMS_CHANGED", {
      message:
        "What a new store pays Louez changed since the preview, so no store was created. Call again without confirmationToken to see the new terms, and confirm them with the user.",
    }),
  singleStoreInstance: () =>
    apiError("FORBIDDEN", "SINGLE_STORE_INSTANCE", {
      message: "This Louez instance hosts a single store, and it already has one.",
      i18nKey: "errors.standaloneSingleStore",
    }),
  invalidCursor: () =>
    apiError("BAD_REQUEST", "INVALID_CURSOR", {
      message: "This cursor is not one stores_list returned. Start again without a cursor.",
      i18nKey: "errors.invalidData",
    }),
} as const;
