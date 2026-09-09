import {
  storefrontCartResolveInputSchema,
  storefrontCartResolveOutputSchema,
} from "@louez/validations";

import { storefrontProcedure } from "../../procedures";
import { resolveStorefrontCart } from "../../services";
import { toORPCError } from "../../utils/orpc-error";

const resolve = storefrontProcedure
  .input(storefrontCartResolveInputSchema)
  .output(storefrontCartResolveOutputSchema)
  .handler(async ({ context, input }) => {
    try {
      return await resolveStorefrontCart({
        store: context.store,
        lines: input.lines,
        memo: context.availabilityMemo,
      });
    } catch (error) {
      throw toORPCError(error);
    }
  });

export const storefrontCartRouter = {
  resolve,
};
