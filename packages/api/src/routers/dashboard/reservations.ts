import {
  dashboardReservationPollInputSchema,
  reservationSignInputSchema,
} from '@louez/validations'
import { dashboardProcedure } from '../../procedures'
import { getReservationPollData, signReservationAsAdmin } from '../../services'
import { toORPCError } from '../../utils/orpc-error'

const poll = dashboardProcedure
  .input(dashboardReservationPollInputSchema)
  .handler(async ({ context }) => {
    try {
      return await getReservationPollData({
        storeId: context.store.id,
      })
    } catch (error) {
      throw toORPCError(error)
    }
  })

const sign = dashboardProcedure
  .input(reservationSignInputSchema)
  .handler(async ({ context, input }) => {
    try {
      return await signReservationAsAdmin({
        reservationId: input.reservationId,
        storeId: context.store.id,
        headers: context.headers,
        regenerateContract: context.regenerateContract,
      })
    } catch (error) {
      throw toORPCError(error)
    }
  })

export const dashboardReservationsRouter = {
  poll,
  sign,
}
