import { storefrontCartResolveInputSchema } from '@louez/validations';
import { z } from 'zod';

import { storefrontProcedure } from '../../procedures';
import { resolveStorefrontCart } from '../../services';
import { toORPCError } from '../../utils/orpc-error';

const seasonalPricingSchema = z.object({
  id: z.string(),
  name: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  basePrice: z.number(),
  tiers: z.array(
    z.object({
      id: z.string(),
      minDuration: z.number().nullable(),
      discountPercent: z.number().nullable(),
      displayOrder: z.number(),
    }),
  ),
  rates: z.array(
    z.object({
      id: z.string(),
      price: z.number(),
      period: z.number(),
      displayOrder: z.number(),
    }),
  ),
});

const cartLineResolutionSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('resolved'),
    lineId: z.string(),
    parentLineId: z.string().optional(),
    productId: z.string(),
    productName: z.string(),
    productImage: z.string().nullable(),
    price: z.number(),
    deposit: z.number(),
    maxQuantity: z.number(),
    quantity: z.number(),
    pricingKind: z.enum(['duration', 'fixed']),
    stockKind: z.enum(['returnable', 'consumable']),
    required: z.boolean(),
    requiredQuantity: z.number().nullable(),
    requiredAccessories: z.array(
      z.object({
        productId: z.string(),
        required: z.literal(true),
        quantity: z.number().int().min(1),
      }),
    ),
    pricingMode: z.enum(['hour', 'day', 'week']),
    productPricingMode: z.enum(['hour', 'day', 'week']),
    basePeriodMinutes: z.number().nullable(),
    enforceStrictTiers: z.boolean(),
    pricingTiers: z.array(
      z.object({
        id: z.string(),
        minDuration: z.number(),
        discountPercent: z.number(),
        period: z.number().nullable(),
        price: z.number().nullable(),
      }),
    ),
    seasonalPricings: z.array(seasonalPricingSchema).optional(),
  }),
  z.object({
    status: z.literal('unavailable'),
    lineId: z.string(),
    parentLineId: z.string().optional(),
    productId: z.string(),
    reason: z.enum([
      'product_unavailable',
      'insufficient_stock',
      'required_accessory_unavailable',
    ]),
    maxQuantity: z.number().optional(),
  }),
]);

const storefrontCartResolveOutputSchema = z.object({
  lines: z.array(cartLineResolutionSchema),
});

const resolve = storefrontProcedure
  .input(storefrontCartResolveInputSchema)
  .output(storefrontCartResolveOutputSchema)
  .handler(async ({ context, input }) => {
    try {
      return await resolveStorefrontCart({
        storeSlug: context.storeSlug,
        lines: input.lines,
      });
    } catch (error) {
      throw toORPCError(error);
    }
  });

export const storefrontCartRouter = {
  resolve,
};
