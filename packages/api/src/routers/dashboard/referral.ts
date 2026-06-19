import { ORPCError } from '@orpc/server';
import { z } from 'zod';

import { dashboardProcedure } from '../../procedures';
import { toORPCError } from '../../utils/orpc-error';

const rewardSummarySchema = z
  .object({
    /** Free reservations the Referrer earns per qualified referral. */
    referrerReward: z.number(),
    /** Indicative euro value of that reward at the store's entry-tier tariff, in cents. */
    rewardValueCents: z.number(),
    currency: z.string(),
    /** The store's current free-reservation balance. */
    freeReservationsRemaining: z.number(),
    /** Total free reservations ever granted to the store (for a gauge). */
    freeReservationsGranted: z.number(),
  })
  .nullable();

/**
 * Indicative Referrer Reward summary for the current store — the headline free-reservation
 * count and its euro value. Powers the self-contained referral nudge, which fetches its own
 * data over oRPC rather than threading props through the deeply-nested payment UI. The
 * compute lives in the app layer (it needs store billing + program config), so it is reached
 * through the injected {@link context.dashboardReferralActions}.
 */
const getRewardSummary = dashboardProcedure
  .input(z.object({}))
  .output(rewardSummarySchema)
  .handler(async ({ context }) => {
    try {
      const fn = context.dashboardReferralActions?.getRewardSummary;
      if (!fn) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'dashboardReferralActions.getRewardSummary not provided',
        });
      }
      return await fn();
    } catch (error) {
      throw toORPCError(error);
    }
  });

export const dashboardReferralRouter = {
  getRewardSummary,
};
