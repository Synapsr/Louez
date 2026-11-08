import { z } from "zod";

import { dashboardProcedure } from "../../procedures";
import { getOnboardingDraft } from "../../services";
import { toORPCError } from "../../utils/orpc-error";

// The branding step saves through onlineStore.updateAppearance, and the last
// step through stores.completeOnboarding.

const getDraft = dashboardProcedure.input(z.object({})).handler(async ({ context }) => {
  try {
    return await getOnboardingDraft({
      storeId: context.store.id,
    });
  } catch (error) {
    throw toORPCError(error);
  }
});

export const dashboardOnboardingRouter = {
  getDraft,
};
