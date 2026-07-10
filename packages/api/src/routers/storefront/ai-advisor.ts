import { db } from '@louez/db';
import {
  advisorConversationStatusInputSchema,
  advisorConversationStatusOutputSchema,
} from '@louez/validations';

import { storefrontProcedure } from '../../procedures';
import { getAdvisorConversationStatus } from '../../services';
import { toORPCError } from '../../utils/orpc-error';

/**
 * Validation state of an advisor conversation, consumed by the checkout gate
 * when the store requires advisor validation before booking. Anonymous access
 * model: possession of the unguessable conversation id (like the cart).
 */
const getConversationStatus = storefrontProcedure
  .input(advisorConversationStatusInputSchema)
  .output(advisorConversationStatusOutputSchema)
  .handler(async ({ context, input }) => {
    try {
      return await getAdvisorConversationStatus({
        db,
        storeId: context.store.id,
        conversationId: input.conversationId,
      });
    } catch (error) {
      throw toORPCError(error);
    }
  });

export const storefrontAiAdvisorRouter = {
  getConversationStatus,
};
