import { z } from "zod";

export const catalogListRouteQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const catalogDeletionsRouteQuerySchema = catalogListRouteQuerySchema.extend({
  since: z.iso.datetime({ offset: true }),
});

export const directoryClaimSchema = z.object({
  businessId: z.string().trim().min(1).max(255),
});

export const dismissDirectoryClaimSchema = z.object({});

export const marketplaceChannelEnableSchema = z.object({
  acceptTerms: z.boolean().default(false),
});

export const marketplaceCategoryMappingsSchema = z
  .array(
    z.object({
      categoryId: z.string().length(21),
      marketplaceCategorySlug: z
        .string()
        .trim()
        .min(1)
        .max(160)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    }),
  )
  .max(500)
  .superRefine((mappings, context) => {
    const categoryIds = new Set<string>();
    for (const [index, mapping] of mappings.entries()) {
      if (categoryIds.has(mapping.categoryId)) {
        context.addIssue({
          code: "custom",
          message: "Category mappings must contain unique category ids",
          path: [index, "categoryId"],
        });
      }
      categoryIds.add(mapping.categoryId);
    }
  });

export type MarketplaceChannelEnableInput = z.infer<typeof marketplaceChannelEnableSchema>;
export type MarketplaceCategoryMappingsInput = z.infer<typeof marketplaceCategoryMappingsSchema>;
