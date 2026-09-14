import {
  storefrontAvailabilityInputSchema,
  storefrontCalendarInputSchema,
  storefrontCalendarOutputSchema,
  storefrontAvailabilityOutputSchema,
  storefrontResolveCombinationInputSchema,
  storefrontResolveCombinationOutputSchema,
} from "@louez/validations";
import { storefrontProcedure } from "../../procedures";
import { getStorefrontAvailability, resolveStorefrontCombination } from "../../services";
import { toORPCError } from "../../utils/orpc-error";

const get = storefrontProcedure
  .input(storefrontAvailabilityInputSchema)
  .output(storefrontAvailabilityOutputSchema)
  .handler(async ({ context, input }) => {
    try {
      return await getStorefrontAvailability({
        store: context.store,
        startDate: input.startDate,
        endDate: input.endDate,
        productIds: input.productIds,
        memo: context.availabilityMemo,
      });
    } catch (error) {
      throw toORPCError(error);
    }
  });

const calendar = storefrontProcedure
  .input(storefrontCalendarInputSchema)
  .output(storefrontCalendarOutputSchema)
  .handler(async ({ context, input }) => {
    try {
      if (input.periods.length === 0) return [];
      const coveringPeriod = {
        startDate: new Date(
          Math.min(...input.periods.map((period) => Date.parse(period.startDate))),
        ).toISOString(),
        endDate: new Date(
          Math.max(...input.periods.map((period) => Date.parse(period.endDate))),
        ).toISOString(),
      };
      const coveringAvailability = await getStorefrontAvailability({
        store: context.store,
        ...coveringPeriod,
        productIds: [input.productId],
        memo: context.availabilityMemo,
      });
      const coveringProduct = coveringAvailability.products.find(
        (product) => product.productId === input.productId,
      );
      if (coveringProduct && coveringProduct.availableQuantity !== 0) {
        return input.periods.map(() => ({ available: true }));
      }
      const results: Array<{ available: boolean }> = [];
      for (let offset = 0; offset < input.periods.length; offset += 4) {
        const batch = await Promise.all(
          input.periods.slice(offset, offset + 4).map(async (period) => {
            const result = await getStorefrontAvailability({
              store: context.store,
              ...period,
              productIds: [input.productId],
              memo: context.availabilityMemo,
            });
            const product = result.products.find((entry) => entry.productId === input.productId);
            return { available: Boolean(product && product.availableQuantity !== 0) };
          }),
        );
        results.push(...batch);
      }
      return results;
    } catch (error) {
      throw toORPCError(error);
    }
  });

const resolveCombination = storefrontProcedure
  .input(storefrontResolveCombinationInputSchema)
  .output(storefrontResolveCombinationOutputSchema)
  .handler(async ({ context, input }) => {
    try {
      return await resolveStorefrontCombination({
        store: context.store,
        productId: input.productId,
        quantity: input.quantity,
        startDate: input.startDate,
        endDate: input.endDate,
        selectedAttributes: input.selectedAttributes,
        memo: context.availabilityMemo,
      });
    } catch (error) {
      throw toORPCError(error);
    }
  });

export const storefrontAvailabilityRouter = {
  get,
  calendar,
  resolveCombination,
};
