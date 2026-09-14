import { updateOnlineStoreInputSchema } from "@louez/validations";
import { z } from "zod";

import { dashboardProcedure } from "../../procedures";
import { updateOnlineStore } from "../../services";
import { toORPCError } from "../../utils/orpc-error";

/**
 * One save for the whole online store editor: the client sends the sections
 * it changed, the service writes them in one update.
 */
const update = dashboardProcedure
  .input(updateOnlineStoreInputSchema)
  .output(z.object({ success: z.literal(true) }))
  .handler(async ({ context, input }) => {
    try {
      const result = await updateOnlineStore({ storeId: context.store.id, input });
      // The theme mode and colour are served from a per-store cache; both
      // travel in the identity section.
      if (input.identity) {
        await context.invalidateStoreViewport?.(context.store.slug);
      }
      return result;
    } catch (error) {
      throw toORPCError(error);
    }
  });

export const dashboardOnlineStoreRouter = {
  update,
};
