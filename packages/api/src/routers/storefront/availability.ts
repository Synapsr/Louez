import {
  storefrontAvailabilityInputSchema,
  storefrontResolveCombinationInputSchema,
} from '@louez/validations'
import { storefrontProcedure } from '../../procedures'
import { getStorefrontAvailability, resolveStorefrontCombination } from '../../services'
import { toORPCError } from '../../utils/orpc-error'

const get = storefrontProcedure
  .input(storefrontAvailabilityInputSchema)
  .handler(async ({ context, input }) => {
    try {
      return await getStorefrontAvailability({
        storeSlug: context.storeSlug,
        startDate: input.startDate,
        endDate: input.endDate,
        productIds: input.productIds,
      })
    } catch (error) {
      throw toORPCError(error)
    }
  })

const resolveCombination = storefrontProcedure
  .input(storefrontResolveCombinationInputSchema)
  .handler(async ({ context, input }) => {
    try {
      return await resolveStorefrontCombination({
        storeSlug: context.storeSlug,
        productId: input.productId,
        quantity: input.quantity,
        startDate: input.startDate,
        endDate: input.endDate,
        selectedAttributes: input.selectedAttributes,
      })
    } catch (error) {
      throw toORPCError(error)
    }
  })

export const storefrontAvailabilityRouter = {
  get,
  resolveCombination,
}
