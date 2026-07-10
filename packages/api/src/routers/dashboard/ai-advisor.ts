import { db } from '@louez/db';
import {
  advisorConversationByReservationInputSchema,
  advisorConversationGetInputSchema,
  advisorConversationsListInputSchema,
  advisorConversationsListOutputSchema,
  advisorConversationTranscriptSchema,
} from '@louez/validations';

import { dashboardProcedure } from '../../procedures';
import {
  getAdvisorConversation,
  getAdvisorConversationByReservation,
  listAdvisorConversations,
} from '../../services';
import { toORPCError } from '../../utils/orpc-error';

const listConversations = dashboardProcedure
  .input(advisorConversationsListInputSchema)
  .output(advisorConversationsListOutputSchema)
  .handler(async ({ context, input }) => {
    try {
      return await listAdvisorConversations({
        db,
        storeId: context.store.id,
        filter: input.filter,
        page: input.page,
        pageSize: input.pageSize,
      });
    } catch (error) {
      throw toORPCError(error);
    }
  });

const getConversation = dashboardProcedure
  .input(advisorConversationGetInputSchema)
  .output(advisorConversationTranscriptSchema)
  .handler(async ({ context, input }) => {
    try {
      return await getAdvisorConversation({
        db,
        storeId: context.store.id,
        conversationId: input.conversationId,
      });
    } catch (error) {
      throw toORPCError(error);
    }
  });

const getByReservation = dashboardProcedure
  .input(advisorConversationByReservationInputSchema)
  .output(advisorConversationTranscriptSchema.nullable())
  .handler(async ({ context, input }) => {
    try {
      return await getAdvisorConversationByReservation({
        db,
        storeId: context.store.id,
        reservationId: input.reservationId,
      });
    } catch (error) {
      throw toORPCError(error);
    }
  });

export const dashboardAiAdvisorRouter = {
  listConversations,
  getConversation,
  getByReservation,
};
