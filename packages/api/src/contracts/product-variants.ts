import { z } from "zod";

import { apiError } from "../platform/errors";
import { resourceLinksSchema } from "./links";

/**
 * The store's variant catalog (sizes, colors, custom variants and their
 * values), shared by its products. No database here.
 */

/** Most variants a store may hold, and the largest page `products.listVariants` returns. */
export const VARIANT_STORE_MAX = 100;
/** Most values one variant may hold. */
export const VARIANT_VALUE_MAX = 200;
/** Most products a usage entry names; `productCount` counts them all. */
export const VARIANT_USAGE_PRODUCTS_MAX = 200;

const idSchema = z.string().min(1).max(64);
const variantKindSchema = z.enum(["size", "color", "custom"]);
const variantLabelSchema = z.string().trim().min(2).max(50);
const valueLabelSchema = z.string().trim().min(1).max(100);
const colorHexSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "A color is #RRGGBB.")
  .describe("For a color variant: the swatch, #RRGGBB.");

export const variantValueSchema = z.object({
  id: z.string(),
  label: z.string(),
  colorHex: z.string().nullable(),
  position: z.number(),
});

export const variantDefinitionSchema = z.object({
  id: z.string(),
  /** Canonical key products use for this variant in bookingAttributeAxes and unit attributes. */
  key: z.string(),
  label: z.string(),
  kind: variantKindSchema,
  /** Inactive: no longer offered when editing products; products that carry it keep it. */
  isActive: z.boolean(),
  position: z.number(),
  values: z.array(variantValueSchema),
});
export type VariantDefinition = z.infer<typeof variantDefinitionSchema>;

export const listVariantsInput = z.object({
  cursor: z
    .string()
    .max(64)
    .optional()
    .describe("The nextCursor of the previous page. Leave it out for the first page."),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(VARIANT_STORE_MAX)
    .optional()
    .describe(`Variants per page, ${VARIANT_STORE_MAX} at most and by default.`),
});
export const listVariantsOutput = z.object({
  items: z.array(variantDefinitionSchema),
  /** Null on the last page. */
  nextCursor: z.string().nullable(),
});

export const ensureVariantDefinitionInput = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .optional()
    .describe("Canonical key, e.g. size. Default: derived from the label."),
  label: variantLabelSchema.describe("The name shown, e.g. Taille."),
  kind: variantKindSchema.default("custom").describe("size, color or custom (default)."),
  isActive: z.boolean().default(true),
  values: z
    .array(z.object({ label: valueLabelSchema, colorHex: colorHexSchema.optional() }))
    .max(100)
    .default([])
    .describe("Values to start with; only added when the variant has none yet."),
});
export const ensureVariantDefinitionOutput = variantDefinitionSchema.extend({
  /** False when the store already had a variant with this key: it is returned as is. */
  created: z.boolean(),
});

export const updateVariantDefinitionInput = z.object({
  id: idSchema,
  label: variantLabelSchema,
});

export const setVariantDefinitionActiveInput = z.object({
  id: idSchema,
  isActive: z.boolean(),
});
export const setVariantDefinitionActiveOutput = z.object({
  id: z.string(),
  isActive: z.boolean(),
});

export const variantIdInput = z.object({ id: idSchema });
export const deleteVariantDefinitionOutput = z.object({ id: z.string() });

const productRefSchema = z.object({ id: z.string(), name: z.string() });

export const getVariantUsageInput = z.object({
  definitionId: idSchema.optional().describe("One variant only. Default: every variant."),
});
export const getVariantUsageOutput = z.object({
  items: z.array(
    z.object({
      definitionId: z.string(),
      /** Products that use the variant, as a booking axis or through their units' values. */
      productCount: z.number().int(),
      /** The first of them by name, at most VARIANT_USAGE_PRODUCTS_MAX, with their dashboard page. */
      products: z.array(productRefSchema.extend({ links: resourceLinksSchema })),
    }),
  ),
});

export const withdrawVariantOutput = z.object({
  id: z.string(),
  affectedProductCount: z.number().int(),
});

export const createVariantValueInput = z.object({
  definitionId: idSchema,
  label: valueLabelSchema,
  colorHex: colorHexSchema.optional(),
});
export const createVariantValueOutput = variantValueSchema.extend({
  /** False when the variant already had this value (case-insensitive): it is returned, its color updated. */
  created: z.boolean(),
});

/** Partial: a field left out is unchanged; colorHex null clears it. */
export const updateVariantValueInput = z.object({
  id: idSchema,
  label: valueLabelSchema.optional(),
  colorHex: colorHexSchema.nullable().optional(),
});

export const deleteVariantValueOutput = z.object({ id: z.string() });

// --- Errors ------------------------------------------------------------------

export const variantErrors = {
  notFound: (id: string) =>
    apiError("NOT_FOUND", "VARIANT_NOT_FOUND", {
      message: `This store has no variant ${id}. products_list_variants lists them.`,
      i18nKey: "errors.notFound",
      details: { id },
    }),
  valueNotFound: (id: string) =>
    apiError("NOT_FOUND", "VARIANT_VALUE_NOT_FOUND", {
      message: `This store has no variant value ${id}. products_list_variants lists them.`,
      i18nKey: "errors.notFound",
      details: { id },
    }),
  invalidKey: () =>
    apiError("BAD_REQUEST", "VARIANT_INVALID", {
      message: "The variant's key, or its label when no key is sent, has no letter or digit.",
      i18nKey: "errors.invalidData",
    }),
  limitReached: () =>
    apiError("CONFLICT", "VARIANT_LIMIT_REACHED", {
      message: `This store already has ${VARIANT_STORE_MAX} variants, the most it may hold.`,
      i18nKey: "errors.variantLimitReached",
      details: { max: VARIANT_STORE_MAX },
    }),
  valueLimitReached: () =>
    apiError("CONFLICT", "VARIANT_VALUE_LIMIT_REACHED", {
      message: `This variant already has ${VARIANT_VALUE_MAX} values, the most it may hold.`,
      i18nKey: "errors.variantValueLimitReached",
      details: { max: VARIANT_VALUE_MAX },
    }),
  valueExists: (label: string) =>
    apiError("CONFLICT", "VARIANT_VALUE_EXISTS", {
      message: `This variant already has the value "${label}".`,
      i18nKey: "errors.invalidData",
      details: { label },
    }),
  inUse: (products: Array<{ id: string; name: string }>, productCount: number) =>
    apiError("CONFLICT", "VARIANT_IN_USE", {
      message: `${productCount} product(s) still use this variant (${products
        .slice(0, 10)
        .map((product) => product.name)
        .join(", ")}). Withdraw it from them first with products_withdraw_variant, then delete it.`,
      i18nKey: "errors.invalidData",
      details: { productCount, products },
    }),
  invalidCursor: () =>
    apiError("BAD_REQUEST", "INVALID_CURSOR", {
      message:
        "This cursor is not one products_list_variants returned. Start again without a cursor.",
      i18nKey: "errors.invalidData",
    }),
} as const;
