import { reservationSignInputSchema } from '@louez/validations'
import { ORPCError } from '@orpc/server'
import { storefrontAuthProcedure } from '../../procedures'
import { signReservationAsCustomer } from '../../services'
import { toORPCError } from '../../utils/orpc-error'

const sign = storefrontAuthProcedure
  .input(reservationSignInputSchema)
  .handler(async ({ context, input }) => {
    if (!context.customer) {
      throw new ORPCError('UNAUTHORIZED', {
        message: 'errors.customerNotAuthenticated',
      })
    }

    try {
      return await signReservationAsCustomer({
        reservationId: input.reservationId,
        storeId: context.store.id,
        customerId: context.customer.id,
        headers: context.headers,
        regenerateContract: context.regenerateContract,
      })
    } catch (error) {
      throw toORPCError(error)
    }
  })

export const storefrontReservationsRouter = {
  sign,
}
