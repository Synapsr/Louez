import { dashboardReservationPollInputSchema } from '@louez/validations'
import { dashboardProcedure } from '../../procedures'
import { getReservationPollData } from '../../services'
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

export const dashboardReservationsRouter = {
  poll,
}
