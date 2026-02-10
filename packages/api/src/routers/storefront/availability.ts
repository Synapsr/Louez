import { storefrontAvailabilityInputSchema } from '@louez/validations'
import { storefrontProcedure } from '../../procedures'
import { getStorefrontAvailability } from '../../services'
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

export const storefrontAvailabilityRouter = {
  get,
}
