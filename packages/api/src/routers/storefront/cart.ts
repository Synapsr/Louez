import { storefrontCartResolveInputSchema } from '@louez/validations';

import { storefrontProcedure } from '../../procedures';
import { resolveStorefrontCart } from '../../services';
import { toORPCError } from '../../utils/orpc-error';

const resolve = storefrontProcedure
  .input(storefrontCartResolveInputSchema)
  .handler(async ({ context, input }) => {
    try {
      return await resolveStorefrontCart({
        storeSlug: context.storeSlug,
        lines: input.lines,
      });
    } catch (error) {
      throw toORPCError(error);
    }
  });

export const storefrontCartRouter = {
  resolve,
};
