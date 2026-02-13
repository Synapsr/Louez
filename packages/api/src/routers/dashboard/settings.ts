import {
  updateStoreAppearanceInputSchema,
  updateStoreLegalInputSchema,
} from '@louez/validations'
import { dashboardProcedure } from '../../procedures'
import { updateStoreAppearance, updateStoreLegal } from '../../services'
import { toORPCError } from '../../utils/orpc-error'

const updateLegal = dashboardProcedure
  .input(updateStoreLegalInputSchema)
  .handler(async ({ context, input }) => {
    try {
      return await updateStoreLegal({
        storeId: context.store.id,
        input,
      })
    } catch (error) {
      throw toORPCError(error)
    }
  })

const updateAppearance = dashboardProcedure
  .input(updateStoreAppearanceInputSchema)
  .handler(async ({ context, input }) => {
    try {
      return await updateStoreAppearance({
        storeId: context.store.id,
        input,
      })
    } catch (error) {
      throw toORPCError(error)
    }
  })

export const dashboardSettingsRouter = {
  updateLegal,
  updateAppearance,
}
