import {
  bookingAttributeAxisSchema,
  ignoreDurationPricingForFixed,
  PRODUCT_LIST_LIMITS,
  priceDurationSchema,
  productAccessoryLinkSchema,
  productFieldsSchema,
  productUnitSchema,
  rateTierSchema,
} from "@louez/validations";
import { z } from "zod";

import { apiError } from "../platform/errors";
import { resourceLinksSchema } from "./links";

/**
 * The products contract: what callers send and get back on every transport,
 * and the domain's errors. No database here.
 *
 * The write input reuses the fields of the dashboard's product schema
 * (`productFieldsSchema` in @louez/validations). The service then runs that
 * schema's full rules (`productSchema`), so the dashboard, the API and the
 * agents are held to one validation.
 */

/** Largest page `products.list` returns. */
export const PRODUCT_PAGE_MAX = 200;
/** Page size of `products.list` when the caller sends none. */
export const PRODUCT_PAGE_DEFAULT = 100;
/** Largest page `products.getActivity` returns. */
export const PRODUCT_ACTIVITY_PAGE_MAX = 50;
/** Largest page `products.listSeasonalPricings` returns. */
export const SEASONAL_PRICING_PAGE_MAX = 200;
/** Widest window `products.getReservationTimeline` reads at once, in days. */
export const PRODUCT_TIMELINE_MAX_DAYS = 400;

/**
 * Most items a write may send per list, checked before any lock: ten times
 * the product limits (`PRODUCT_LIST_LIMITS`), so a product stored with more
 * than a limit still saves, while the service holds new lists to the limits.
 */
export const PRODUCT_WRITE_LIMITS = {
  units: PRODUCT_LIST_LIMITS.units * 10,
  rateTiers: PRODUCT_LIST_LIMITS.rateTiers * 10,
  accessories: PRODUCT_LIST_LIMITS.accessories * 10,
  categoryIds: PRODUCT_LIST_LIMITS.categoryIds * 10,
  images: PRODUCT_LIST_LIMITS.images * 10,
} as const;

/**
 * Largest request body of a product write (`meta.maxBodyBytes`), read only
 * once the caller is known. It holds a large product (1,000 units with their
 * notes and photos), not every input the schema could take: a larger write
 * must be split. Create the product, then add units in further updates (the
 * saved units go back as their id and identifier only) or fill each unit's
 * details with products_update_unit_details.
 */
export const PRODUCT_WRITE_MAX_BODY_BYTES = 32 * 1024 * 1024;

const idSchema = z.string().min(1).max(64);
const cursorSchema = z
  .string()
  .max(64)
  .optional()
  .describe("The nextCursor of the previous page. Leave it out for the first page.");

const productStatusSchema = z.enum(["draft", "active", "archived"]);
const pricingKindSchema = z.enum(["duration", "fixed"]);
const stockKindSchema = z.enum(["returnable", "consumable", "untracked"]);
const pricingModeSchema = z.enum(["hour", "day", "week"]);
const durationUnitSchema = z.enum(["minute", "hour", "day", "week"]);
const fields = productFieldsSchema.shape;

// --- Write input -------------------------------------------------------------

const TIERS_DESCRIPTION = [
  "Degressive rates (prix dégressifs) of a duration product, on top of the base rate.",
  "Each tier is the TOTAL price of a rental of exactly that duration, not a price per unit:",
  'with a base rate of 30 per 1 day, `{ "duration": 3, "unit": "day", "price": "75" }` means 3 days cost 75 in all (25 a day).',
  "Durations are unique; `unit` is minute, hour, day or week; prices are decimal strings.",
  "With enforceStrictTiers true, a rental is rounded up to the next tier (or base) duration and charged that tier's price;",
  "with false, the price runs linearly between tiers.",
  "Sending the list replaces every tier; an empty list removes them. Ignored for fixed pricing.",
].join(" ");

const UNITS_DESCRIPTION = [
  "Individual units (serial numbers, asset tags) when trackUnits is true: the stock is then the number of active units.",
  "A unit with an `id` is an existing one, kept and updated; one without is created.",
  "Sending the list replaces the product's active units: an active unit left out is deleted (refused while a reservation holds it).",
  "Each unit needs an identifier, and a value in `attributes` for every key of bookingAttributeAxes.",
].join(" ");

/**
 * The fields of a product write, as the dashboard form and agents send them.
 * Agent-friendly where it costs nothing: `quantity` takes a number, and
 * `status`, `pricingMode` and `basePriceDuration` may be left out (see the
 * service for the defaults).
 */
const productWriteShape = {
  name: fields.name.describe("Product name, 2 to 255 characters."),
  description: fields.description.describe("Description shown on the storefront."),
  aiContext: fields.aiContext.describe(
    "Private notes for the storefront AI advisor (constraints, ideal uses). Never shown to customers.",
  ),
  categoryIds: z
    .array(z.string())
    .max(PRODUCT_WRITE_LIMITS.categoryIds)
    .optional()
    .describe(
      "Ids of the store's categories (categories_list), main category first. Unknown ids are ignored.",
    ),
  categoryId: fields.categoryId.describe(
    "Former single category. Use categoryIds; ignored when categoryIds is sent.",
  ),
  status: productStatusSchema
    .optional()
    .describe(
      "active: on the storefront; draft: hidden; archived: hidden and out of the catalog. Default active.",
    ),
  pricingKind: pricingKindSchema
    .optional()
    .describe(
      "duration: the price depends on how long it is rented (base rate, tiers, seasons); fixed: one price per item, whatever the duration. Default duration.",
    ),
  stockKind: stockKindSchema
    .optional()
    .describe(
      "returnable: comes back after the rental (the default); consumable: used up, sold with fixed pricing; untracked: no quantity limit.",
    ),
  price: fields.price
    .optional()
    .describe(
      'Decimal string, e.g. "25.00". For fixed pricing, the price per item. For duration pricing, the base price when basePriceDuration is left out.',
    ),
  basePriceDuration: priceDurationSchema
    .nullable()
    .optional()
    .describe(
      'Base rate of a duration product: `price` for `duration` × `unit`, e.g. { "price": "30", "duration": 1, "unit": "day" } or { "price": "20", "duration": 4, "unit": "hour" }. Left out, it is `price` per 1 pricingMode. Null, as products_get gives it for fixed pricing, means none. Ignored for fixed pricing.',
    ),
  pricingMode: pricingModeSchema
    .optional()
    .describe(
      "Former base period (hour, day, week). Used only when basePriceDuration is left out; default day.",
    ),
  rateTiers: z
    .array(rateTierSchema)
    .max(PRODUCT_WRITE_LIMITS.rateTiers)
    .optional()
    .describe(TIERS_DESCRIPTION),
  pricingTiers: fields.pricingTiers
    .unwrap()
    .max(PRODUCT_WRITE_LIMITS.rateTiers)
    .optional()
    .describe(
      "Former percentage tiers ({ minDuration, discountPercent }). Use rateTiers; ignored when rateTiers is sent.",
    ),
  enforceStrictTiers: fields.enforceStrictTiers.describe(
    "Duration pricing only. true: whole periods (a rental is charged the next tier or base duration up); false: prorated between tiers.",
  ),
  deposit: fields.deposit.describe(
    'Security deposit per item, decimal string, e.g. "150". Empty for none.',
  ),
  quantity: z
    .union([z.number().int().min(0), fields.quantity])
    .optional()
    .describe(
      "Stock: how many items the store has. Ignored when trackUnits is true (the active units count). Default 1.",
    ),
  images: fields.images
    .unwrap()
    .max(PRODUCT_WRITE_LIMITS.images)
    .optional()
    .describe(
      "Image URLs, first one main. Upload each with products_upload_image, or with products_create_image_upload and products_complete_image_upload, then use the url it returns.",
    ),
  imageHistory: fields.imageHistory.describe(
    "Editing history of each image (crops, AI enhancements), as the dashboard keeps it. Agents leave it out.",
  ),
  videoUrl: fields.videoUrl.describe("A YouTube URL, or empty for none."),
  taxSettings: fields.taxSettings.describe(
    "{ inheritFromStore: true } uses the store's VAT rate; { inheritFromStore: false, customRate: 5.5 } sets one for this product.",
  ),
  promotion: fields.promotion.describe(
    "A discount shown on the storefront: { percentage: 1 to 99, startsOn, endsOn } with YYYY-MM-DD dates or null for open ends; null for none.",
  ),
  accessories: z
    .array(productAccessoryLinkSchema)
    .max(PRODUCT_WRITE_LIMITS.accessories)
    .optional()
    .describe(
      "Other products of the store offered with this one: { accessoryId, required, quantity } (quantity per item of this product). required true books it with every rental. Sending the list replaces every link.",
    ),
  trackUnits: fields.trackUnits.describe(
    "Returnable products only: track each item as a unit with its own identifier.",
  ),
  units: z
    .array(productUnitSchema)
    .max(PRODUCT_WRITE_LIMITS.units)
    .optional()
    .describe(UNITS_DESCRIPTION),
  bookingAttributeAxes: z
    .array(bookingAttributeAxisSchema)
    .max(3)
    .optional()
    .describe(
      'Variants customers choose when booking (size, colour), up to 3, with trackUnits only: { key: "size", label: "Size", position: 0 }. Each unit then carries a value per key.',
    ),
};

/**
 * Runs the form's fixed-price rule before the fields are checked: a fixed
 * product's dormant base period and tiers, as the form keeps them, are
 * dropped (`ignoreDurationPricingForFixed`). The JSON Schema agents get is the
 * object's.
 */
const withFixedPricingIgnored = <T extends z.ZodObject>(schema: T) =>
  z.preprocess((input: z.input<T>) => ignoreDurationPricingForFixed(input), schema);

export const createProductInput = withFixedPricingIgnored(z.object(productWriteShape));
export type CreateProductInput = z.infer<typeof createProductInput>;

/**
 * Partial: a field left out is unchanged, `null` clears the description, the
 * AI context, the video, the tax settings or the promotion. A list sent
 * (rateTiers, accessories, units, categoryIds, images) replaces the stored one.
 */
export const updateProductInput = withFixedPricingIgnored(
  z.object({
    id: idSchema,
    ...z.object(productWriteShape).partial().shape,
    description: z.string().nullable().optional().describe("New description; null clears it."),
    aiContext: fields.aiContext.unwrap().nullable().optional().describe("Null clears it."),
    videoUrl: fields.videoUrl.nullable().describe("A YouTube URL; null or empty removes it."),
    taxSettings: fields.taxSettings
      .unwrap()
      .nullable()
      .optional()
      .describe("Null goes back to the store's VAT rate."),
  }),
);
export type UpdateProductInput = z.infer<typeof updateProductInput>;

// --- Output ------------------------------------------------------------------

const rateTierOutput = z.object({
  id: z.string(),
  /** Total price of a rental of exactly this duration. */
  price: z.string(),
  duration: z.number().int(),
  unit: durationUnitSchema,
  /** The same duration in minutes. */
  periodMinutes: z.number().int(),
});

export const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** URL segment of the storefront page; null on products older than slugs. */
  slug: z.string().nullable(),
  description: z.string().nullable(),
  aiContext: z.string().nullable(),
  status: productStatusSchema,
  /** The categories, main one first. */
  categoryIds: z.array(z.string()),
  /** Currency of every amount, from the store's settings (ISO 4217). */
  currency: z.string(),
  pricingKind: pricingKindSchema,
  /** Fixed pricing: the price per item. Duration pricing: the base rate's price. */
  price: z.string(),
  /** Duration pricing: the base rate, as products_update takes it; null for fixed pricing. */
  basePriceDuration: z
    .object({ price: z.string(), duration: z.number().int(), unit: durationUnitSchema })
    .nullable(),
  pricingMode: pricingModeSchema,
  rateTiers: z.array(rateTierOutput),
  enforceStrictTiers: z.boolean(),
  deposit: z.string(),
  stockKind: stockKindSchema,
  /** Items in stock: the active units when trackUnits is true. */
  quantity: z.number().int(),
  trackUnits: z.boolean(),
  bookingAttributeAxes: z.array(
    z.object({ key: z.string(), label: z.string(), position: z.number().int() }),
  ),
  units: z.array(
    z.object({
      id: z.string(),
      identifier: z.string(),
      attributes: z.record(z.string(), z.string()),
      /** active, or retired (out of the stock for good). */
      lifecycleStatus: z.string(),
    }),
  ),
  accessories: z.array(
    z.object({
      accessoryId: z.string(),
      name: z.string(),
      required: z.boolean(),
      quantity: z.number().int(),
    }),
  ),
  images: z.array(z.string()),
  videoUrl: z.string().nullable(),
  taxSettings: z
    .object({ inheritFromStore: z.boolean(), customRate: z.number().optional() })
    .nullable(),
  promotion: z
    .object({
      percentage: z.number(),
      startsOn: z.string().nullable(),
      endsOn: z.string().nullable(),
    })
    .nullable(),
  /** Place in the store's catalog order, smallest first. */
  position: z.number().int(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Product = z.infer<typeof productSchema>;

/** A product as the procedures return it: the record and its links. */
export const productOutput = productSchema.extend({
  /** Its dashboard page, and its storefront page while it is active and the store online. */
  links: resourceLinksSchema,
});

export const productListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** URL segment of the storefront page; null on products older than slugs. */
  slug: z.string().nullable(),
  status: productStatusSchema.nullable(),
  images: z.array(z.string()).nullable(),
  pricingKind: pricingKindSchema,
  price: z.string(),
  /** Base rate's duration in minutes; null for fixed pricing and older products. */
  basePeriodMinutes: z.number().int().nullable(),
  pricingMode: pricingModeSchema,
  deposit: z.string().nullable(),
  stockKind: stockKindSchema,
  quantity: z.number(),
  /** The main category. */
  category: z.object({ id: z.string(), name: z.string() }).nullable(),
});
export type ProductListItem = z.infer<typeof productListItemSchema>;

export const listProductsInput = z.object({
  status: z
    .enum(["all", "active", "draft", "archived"])
    .optional()
    .describe("Only products with this status. Default all."),
  categoryIds: z
    .preprocess(
      (value) => (typeof value === "string" ? [value] : value),
      z.array(idSchema).max(100),
    )
    .optional()
    .describe("Only products in any of these categories. Default every category."),
  search: z.string().trim().max(100).optional().describe("Part of the product name."),
  cursor: cursorSchema,
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PRODUCT_PAGE_MAX)
    .optional()
    .describe(
      `Products per page, ${PRODUCT_PAGE_MAX} at most, ${PRODUCT_PAGE_DEFAULT} by default.`,
    ),
});
export const listProductsOutput = z.object({
  items: z.array(productListItemSchema.extend({ links: resourceLinksSchema })),
  /** Null on the last page. */
  nextCursor: z.string().nullable(),
  /** Currency of every amount. */
  currency: z.string(),
  /** Products per status within the category and search filters, all pages together. */
  counts: z.object({
    all: z.number().int(),
    active: z.number().int(),
    draft: z.number().int(),
    archived: z.number().int(),
  }),
});

/** Deepest row the former `list_products` paging reaches; past it, the cursor list. */
export const LEGACY_PAGE_MAX_OFFSET = 10_000;

/** The former `list_products` tool's arguments: offset paging, one category. */
export const legacyListProductsInput = z.object({
  status: listProductsInput.shape.status,
  categoryId: idSchema.optional().describe("Only products in this category."),
  search: listProductsInput.shape.search,
  page: z.number().int().min(1).optional().describe("Page number (default 1)."),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Results per page (default 50, max 100)."),
});

export const getProductInput = z.object({ id: idSchema });

export const updateProductStatusInput = z.object({
  id: idSchema,
  status: productStatusSchema.describe(
    "active: on the storefront; draft: hidden; archived: hidden and out of the catalog.",
  ),
});
export const updateProductStatusOutput = z.object({
  id: z.string(),
  status: productStatusSchema,
  previousStatus: productStatusSchema.nullable(),
  /** Its dashboard page, and its storefront page when the new status is active. */
  links: resourceLinksSchema,
});

export const deleteProductInput = z.object({ id: idSchema });
export const deleteProductOutput = z.object({
  id: z.string(),
  /** Units deleted with the product. */
  deletedUnitCount: z.number().int(),
});

export const duplicateProductInput = z.object({ id: idSchema });

export const reorderProductsInput = z.object({
  ids: z
    .array(idSchema)
    .min(1)
    .max(5000)
    .describe(
      "Product ids in their new order. They swap among the places they already hold; products left out keep theirs. Ids of other stores are ignored.",
    ),
});
export const reorderProductsOutput = z.object({
  items: z.array(z.object({ id: z.string(), position: z.number().int() })),
});

// --- Activity and timeline ---------------------------------------------------

export const productActivityInput = z.object({
  id: idSchema,
  cursor: cursorSchema,
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PRODUCT_ACTIVITY_PAGE_MAX)
    .optional()
    .describe(`Events per page, ${PRODUCT_ACTIVITY_PAGE_MAX} at most.`),
});
export const productActivityOutput = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      productUnitId: z.string().nullable(),
      /** The unit's identifier when the event happened. */
      identifierSnapshot: z.string().nullable(),
      /** created, updated, deleted, retired, reinstated, downtime_*… */
      type: z.string(),
      actorUserId: z.string().nullable(),
      payload: z.record(z.string(), z.unknown()).nullable(),
      /** ISO 8601, UTC. */
      createdAt: z.string(),
    }),
  ),
  /** Null on the last page. */
  nextCursor: z.string().nullable(),
});

export const productTimelineInput = z.object({
  id: idSchema,
  from: z.coerce.date().describe("Start of the window, ISO 8601 with a time zone."),
  to: z.coerce
    .date()
    .describe(`End of the window, ISO 8601, at most ${PRODUCT_TIMELINE_MAX_DAYS} days after from.`),
});
export const productTimelineOutput = z.object({
  /** Reservations holding the product that overlap the window, one per reservation. */
  reservations: z.array(
    z.object({
      id: z.string(),
      number: z.string(),
      status: z.string().nullable(),
      startDate: z.date(),
      endDate: z.date(),
      customerId: z.string().nullable(),
      customerName: z.string(),
      subtotalAmount: z.string().nullable(),
      depositAmount: z.string().nullable(),
      totalAmount: z.string(),
      /** Items of this product in the reservation. */
      quantity: z.number().int(),
      /** Units assigned to it, when the product tracks units. */
      assignedUnitIds: z.array(z.string()),
      /** Everything the reservation holds, in the catalog's order. */
      items: z.array(
        z.object({
          productId: z.string().nullable().optional(),
          name: z.string(),
          quantity: z.number().int(),
          imageUrl: z.string().nullable().optional(),
        }),
      ),
    }),
  ),
  /** Unit downtimes (maintenance, repair) that overlap the window. */
  downtimes: z.array(
    z.object({
      id: z.string(),
      unitId: z.string(),
      reason: z.enum(["maintenance", "repair", "other"]),
      startsAt: z.date(),
      endsAt: z.date().nullable(),
    }),
  ),
});

// --- Seasonal pricing --------------------------------------------------------

const isoDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "A date is YYYY-MM-DD.")
  .describe("A day, YYYY-MM-DD.");
const moneySchema = z
  .string()
  .regex(/^\d+([.,]\d{1,2})?$/, "An amount is a decimal string with at most 2 decimals.");

const seasonalTierInput = z.object({
  price: moneySchema.describe("Total price of a rental of exactly this duration."),
  duration: z.number().int().min(1),
  unit: durationUnitSchema,
});

const SEASON_DESCRIPTION =
  "A season replaces the product's base rate and tiers on the days from startDate to endDate (both included). Seasons of one product never overlap.";

export const listSeasonalPricingsInput = z.object({
  productId: idSchema,
  cursor: cursorSchema,
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(SEASONAL_PRICING_PAGE_MAX)
    .optional()
    .describe(`Seasons per page, ${SEASONAL_PRICING_PAGE_MAX} at most and by default.`),
});

export const createSeasonalPricingInput = z.object({
  productId: idSchema,
  name: z.string().trim().min(1).max(100).describe("A name for the season, e.g. Summer."),
  startDate: isoDaySchema,
  endDate: isoDaySchema,
  price: moneySchema.describe("The season's base price, for the product's base duration."),
  rateTiers: z
    .array(seasonalTierInput)
    .max(50)
    .optional()
    .describe(`The season's tiers, same meaning as the product's rateTiers. ${SEASON_DESCRIPTION}`),
});

/** Partial: a field left out is unchanged; rateTiers sent replaces the season's tiers. */
export const updateSeasonalPricingInput = z.object({
  id: idSchema,
  name: createSeasonalPricingInput.shape.name.optional(),
  startDate: isoDaySchema.optional(),
  endDate: isoDaySchema.optional(),
  price: createSeasonalPricingInput.shape.price.optional(),
  rateTiers: createSeasonalPricingInput.shape.rateTiers,
});

export const seasonalPricingIdInput = z.object({ id: idSchema });

export const seasonalPricingSchema = z.object({
  id: z.string(),
  productId: z.string(),
  name: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  price: z.string(),
  tiers: z.array(
    z.object({
      id: z.string(),
      price: z.string().nullable(),
      /** The tier's duration in minutes. */
      period: z.number().int().nullable(),
      duration: z.number().int().nullable(),
      unit: durationUnitSchema.nullable(),
      /** Former percentage tiers only. */
      minDuration: z.number().int().nullable(),
      discountPercent: z.string().nullable(),
      displayOrder: z.number().int().nullable(),
    }),
  ),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type SeasonalPricing = z.infer<typeof seasonalPricingSchema>;

export const listSeasonalPricingsOutput = z.object({
  items: z.array(seasonalPricingSchema),
  nextCursor: z.string().nullable(),
});

export const deleteSeasonalPricingOutput = z.object({
  id: z.string(),
  productId: z.string(),
});

// --- Errors ------------------------------------------------------------------

export const productErrors = {
  notFound: (id: string) =>
    apiError("NOT_FOUND", "PRODUCT_NOT_FOUND", {
      message: `This store has no product ${id}.`,
      i18nKey: "errors.productNotFound",
      details: { id },
    }),
  invalid: (issues: Array<{ path: string; message: string }>) =>
    apiError("BAD_REQUEST", "PRODUCT_INVALID", {
      message: `The product is not valid: ${issues
        .slice(0, 5)
        .map((issue) => `${issue.path || "input"} (${issue.message})`)
        .join("; ")}.`,
      i18nKey: "errors.invalidData",
      details: { issues },
    }),
  legacyTiersInvalid: (reason: string) =>
    apiError("BAD_REQUEST", "PRODUCT_INVALID", {
      message: `The percentage tiers are not valid: ${reason} Prefer rateTiers.`,
      i18nKey: "errors.invalidData",
      details: { issues: [{ path: "pricingTiers", message: reason }] },
    }),
  duplicateRatePeriods: (duplicateRateTierIndexes: number[]) =>
    apiError("BAD_REQUEST", "PRODUCT_DUPLICATE_RATE_PERIODS", {
      message:
        "Two tiers have the same duration (3 days and 72 hours are one duration). Each duration may appear once.",
      i18nKey: "errors.invalidData",
      details: { duplicateRateTierIndexes },
    }),
  imageNotOwned: () =>
    apiError("BAD_REQUEST", "PRODUCT_IMAGE_INVALID", {
      message:
        "An image URL is not a product image stored for this store. Upload it with products_upload_image, or with products_create_image_upload and products_complete_image_upload, then use the url it returns.",
      i18nKey: "errors.invalidData",
    }),
  unitTrackingInUse: () =>
    apiError("CONFLICT", "PRODUCT_UNIT_TRACKING_IN_USE", {
      message:
        "Unit tracking cannot be turned off: current or future reservations booked specific variants of this product.",
      i18nKey: "errors.cannotDisableUnitTrackingWithCombinations",
    }),
  unitsAssigned: (units: Array<{ id: string; identifier: string }>) =>
    apiError("CONFLICT", "PRODUCT_UNITS_ASSIGNED", {
      message: `These units are assigned to current or future reservations and cannot be deleted: ${units
        .map((unit) => unit.identifier)
        .join(", ")}.`,
      i18nKey: "errors.unitAssigned",
      details: {
        unitIds: units.map((unit) => unit.id),
        identifiers: units.map((unit) => unit.identifier),
      },
    }),
  unitCapacityConflict: () =>
    apiError("CONFLICT", "PRODUCT_UNIT_CAPACITY_CONFLICT", {
      message:
        "With these units, current or future reservations would hold more items than the product has.",
      i18nKey: "errors.unitStatusConflictsWithReservations",
    }),
  stockKindLocked: () =>
    apiError("CONFLICT", "PRODUCT_STOCK_KIND_LOCKED", {
      message:
        "The stock kind cannot change while a confirmed or ongoing reservation holds the product.",
      i18nKey: "errors.cannotChangeStockKindWithActiveReservations",
    }),
  listTooLong: (list: string, max: number, stored: number) =>
    apiError("BAD_REQUEST", "PRODUCT_LIST_TOO_LONG", {
      message: `A product holds at most ${max} ${list}${stored > max ? `; this one already holds ${stored}, so it may keep them but not add more` : ""}.`,
      i18nKey: "errors.invalidData",
      details: { list, max, stored },
    }),
  legacyPageTooDeep: () =>
    apiError("BAD_REQUEST", "LEGACY_PAGE_TOO_DEEP", {
      message: `list_products pages through the first ${LEGACY_PAGE_MAX_OFFSET} products only. Use products_list and follow its nextCursor to read further.`,
      i18nKey: "errors.invalidData",
      details: { maxOffset: LEGACY_PAGE_MAX_OFFSET, tool: "products_list" },
    }),
  invalidCursor: (tool: string) =>
    apiError("BAD_REQUEST", "INVALID_CURSOR", {
      message: `This cursor is not one ${tool} returned. Start again without a cursor.`,
      i18nKey: "errors.invalidData",
    }),
  timelineRange: () =>
    apiError("BAD_REQUEST", "PRODUCT_TIMELINE_RANGE_INVALID", {
      message: `The window must end after it starts, and span at most ${PRODUCT_TIMELINE_MAX_DAYS} days.`,
      i18nKey: "errors.invalidData",
      details: { maxDays: PRODUCT_TIMELINE_MAX_DAYS },
    }),
  seasonalNotFound: (id: string) =>
    apiError("NOT_FOUND", "SEASONAL_PRICING_NOT_FOUND", {
      message: `This store has no seasonal price ${id}.`,
      i18nKey: "errors.notFound",
      details: { id },
    }),
  seasonalDates: () =>
    apiError("BAD_REQUEST", "SEASONAL_PRICING_DATES_INVALID", {
      message: "A season's endDate must come after its startDate.",
      i18nKey: "errors.invalidData",
    }),
  seasonalOverlap: (existing: { id: string; name: string }) =>
    apiError("CONFLICT", "SEASONAL_PRICING_OVERLAP", {
      message: `These dates overlap the season "${existing.name}" of this product. List the product's seasons to pick other dates.`,
      i18nKey: "errors.invalidData",
      details: { overlappingId: existing.id },
    }),
  seasonalFixedProduct: (id: string) =>
    apiError("BAD_REQUEST", "SEASONAL_PRICING_FIXED_PRODUCT", {
      message: `The product ${id} has fixed pricing: seasons apply to duration pricing only.`,
      i18nKey: "errors.invalidData",
      details: { productId: id },
    }),
} as const;
