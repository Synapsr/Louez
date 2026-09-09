import { updateStoreAppearanceInputSchema, updateStoreLegalInputSchema } from "@louez/validations";
import { dashboardProcedure } from "../../procedures";
import { updateStoreAppearance, updateStoreLegal } from "../../services";
import { toORPCError } from "../../utils/orpc-error";
import { z } from "zod";

const updateLegal = dashboardProcedure
  .input(updateStoreLegalInputSchema)
  .handler(async ({ context, input }) => {
    try {
      return await updateStoreLegal({
        storeId: context.store.id,
        input,
      });
    } catch (error) {
      throw toORPCError(error);
    }
  });

const updateAppearance = dashboardProcedure
  .input(updateStoreAppearanceInputSchema)
  .output(z.object({ success: z.literal(true) }))
  .handler(async ({ context, input }) => {
    try {
      const result = await updateStoreAppearance({
        storeId: context.store.id,
        input,
      });
      await context.invalidateStoreViewport?.(context.store.slug);
      return result;
    } catch (error) {
      throw toORPCError(error);
    }
  });

export const dashboardSettingsRouter = {
  updateLegal,
  updateAppearance,
};
