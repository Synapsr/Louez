import {
  addressAutocompleteInputSchema,
  addressResolveInputSchema,
  addressDetailsInputSchema,
  addressReverseGeocodeInputSchema,
  routeDistanceInputSchema,
} from '@louez/validations'
import { publicProcedure } from '../../procedures'
import {
  getAddressAutocomplete,
  getAddressDetails,
  getRouteDistance,
  resolveAddressQuery,
  reverseGeocode,
} from '../../services'
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

const resolve = publicProcedure
  .input(addressResolveInputSchema)
  .handler(async ({ input }) => {
    try {
      return await resolveAddressQuery({
        query: input.query,
      })
    } catch (error) {
      throw toORPCError(error)
    }
  })

const reverseGeocodeRoute = publicProcedure
  .input(addressReverseGeocodeInputSchema)
  .handler(async ({ input }) => {
    try {
      return await reverseGeocode(input)
    } catch (error) {
      throw toORPCError(error)
    }
  })

const distance = publicProcedure
  .input(routeDistanceInputSchema)
  .handler(async ({ input }) => {
    try {
      return await getRouteDistance(input)
    } catch (error) {
      throw toORPCError(error)
    }
  })

export const publicAddressRouter = {
  autocomplete,
  details,
  resolve,
  reverseGeocode: reverseGeocodeRoute,
  distance,
}
