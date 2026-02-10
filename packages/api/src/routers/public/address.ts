import {
  addressAutocompleteInputSchema,
  addressDetailsInputSchema,
} from '@louez/validations'
import { publicProcedure } from '../../procedures'
import { getAddressAutocomplete, getAddressDetails } from '../../services'
import { toORPCError } from '../../utils/orpc-error'

const autocomplete = publicProcedure
  .input(addressAutocompleteInputSchema)
  .handler(async ({ input }) => {
    try {
      return await getAddressAutocomplete({
        query: input.query,
      })
    } catch (error) {
      throw toORPCError(error)
    }
  })

const details = publicProcedure
  .input(addressDetailsInputSchema)
  .handler(async ({ input }) => {
    try {
      return await getAddressDetails({
        placeId: input.placeId,
      })
    } catch (error) {
      throw toORPCError(error)
    }
  })

export const publicAddressRouter = {
  autocomplete,
  details,
}
