import { z } from "zod";

import { apiError } from "../platform/errors";
import { resourceLinksSchema } from "./links";

/**
 * The categories contract: what callers send and get back on every transport,
 * and the domain's errors. No database here.
 */

/** Largest page `categories.list` returns, and its default. */
export const CATEGORY_PAGE_MAX = 500;

/**
 * Most categories a store may hold, and so the most `categories.reorder`
 * takes: the dashboard reads them all, page by page.
 */
export const CATEGORY_STORE_MAX = 2000;

const idSchema = z.string().min(1).max(64);
const nameSchema = z
  .string()
  .trim()
  .min(2, "A category name has at least 2 characters.")
  .max(255, "A category name has at most 255 characters.");
const descriptionSchema = z.string().trim().max(5000).nullable();
const imageUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .nullable()
  .describe(
    "Public URL of an image stored for this store, as categories_complete_image_upload returns it.",
  );

export const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  /** URL segment of the storefront category page; null on categories older than slugs. */
  slug: z.string().nullable(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  /** Place in the store's order, smallest first. */
  position: z.number().int(),
  /** Products linked to the category. */
  productCount: z.number().int(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Category = z.infer<typeof categorySchema>;

/** A category as the procedures return it: the record and its links. */
export const categoryOutput = categorySchema.extend({
  /** The dashboard's categories page, and the storefront catalog filtered on it once the store is online. */
  links: resourceLinksSchema,
});

export const listCategoriesInput = z.object({
  cursor: z
    .string()
    .max(64)
    .optional()
    .describe("The nextCursor of the previous page. Leave it out for the first page."),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(CATEGORY_PAGE_MAX)
    .optional()
    .describe(`Categories per page, ${CATEGORY_PAGE_MAX} at most and by default.`),
});
export const listCategoriesOutput = z.object({
  items: z.array(categoryOutput),
  /** Null on the last page. */
  nextCursor: z.string().nullable(),
});

export const getCategoryInput = z.object({ id: idSchema });

export const createCategoryInput = z.object({
  name: nameSchema,
  description: descriptionSchema.optional(),
  imageUrl: imageUrlSchema.optional(),
});
export const createCategoryOutput = categoryOutput.extend({
  /** False when a category with the same name already existed and was returned as is. */
  created: z.boolean(),
});

/** Partial: a field left out is unchanged, `null` clears it. */
export const updateCategoryInput = z.object({
  id: idSchema,
  name: nameSchema.optional(),
  description: descriptionSchema.optional(),
  imageUrl: imageUrlSchema.optional(),
});

export const deleteCategoryInput = z.object({
  id: idSchema,
  replacementCategoryId: idSchema
    .nullable()
    .optional()
    .describe(
      "Optional. Another category of the store that takes over the deleted one's products.",
    ),
});
export const deleteCategoryOutput = z.object({
  id: z.string(),
  /** Products that were linked to the deleted category. */
  affectedProductCount: z.number().int(),
  replacementCategoryId: z.string().nullable(),
});

export const reorderCategoriesInput = z.object({
  ids: z
    .array(idSchema)
    .min(1)
    .max(CATEGORY_STORE_MAX)
    .describe("Every category of the store, each once, in the new order."),
});
export const reorderCategoriesOutput = z.object({
  items: z.array(z.object({ id: z.string(), position: z.number().int() })),
});

export const categoryErrors = {
  notFound: (id: string) =>
    apiError("NOT_FOUND", "CATEGORY_NOT_FOUND", {
      message: `This store has no category ${id}.`,
      i18nKey: "errors.categoryNotFound",
      details: { id },
    }),
  replacementNotFound: (id: string) =>
    apiError("BAD_REQUEST", "CATEGORY_REPLACEMENT_INVALID", {
      message: `The replacement category ${id} is not another category of this store.`,
      i18nKey: "errors.categoryNotFound",
      details: { replacementCategoryId: id },
    }),
  nameTaken: (name: string, existingId: string) =>
    apiError("CONFLICT", "CATEGORY_NAME_TAKEN", {
      message: `Another category of this store is already named "${name}".`,
      i18nKey: "errors.invalidData",
      details: { name, existingId },
    }),
  imageNotOwned: () =>
    apiError("BAD_REQUEST", "CATEGORY_IMAGE_INVALID", {
      message:
        "The image URL is not a category image stored for this store. Upload it with categories_create_image_upload, then use the url categories_complete_image_upload returns.",
      i18nKey: "errors.invalidData",
    }),
  orderMismatch: (details: { missing: string[]; unknown: string[]; duplicates: string[] }) =>
    apiError("BAD_REQUEST", "CATEGORY_ORDER_MISMATCH", {
      message:
        "Send every category of the store exactly once. List the categories to get their ids.",
      i18nKey: "errors.invalidData",
      details,
    }),
  limitReached: () =>
    apiError("CONFLICT", "CATEGORY_LIMIT_REACHED", {
      message: `This store already has ${CATEGORY_STORE_MAX} categories, the most it may hold.`,
      i18nKey: "errors.invalidData",
      details: { max: CATEGORY_STORE_MAX },
    }),
  invalidCursor: () =>
    apiError("BAD_REQUEST", "INVALID_CURSOR", {
      message: "This cursor is not one categories_list returned. Start again without a cursor.",
      i18nKey: "errors.invalidData",
    }),
} as const;
