import {
  storefrontAvailabilityInputSchema,
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
  resolveCombination,
};
