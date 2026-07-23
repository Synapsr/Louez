import { z } from "zod";

import { brandingSchema, stripeSetupSchema } from "@louez/validations";

import { dashboardProcedure } from "../../procedures";
import { completeOnboarding, getOnboardingDraft, updateOnboardingBranding } from "../../services";
import { toORPCError } from "../../utils/orpc-error";

const updateBranding = dashboardProcedure
  .input(brandingSchema)
  .handler(async ({ context, input }) => {
    try {
      return await updateOnboardingBranding({
        storeId: context.store.id,
        input,
      });
    } catch (error) {
      throw toORPCError(error);
    }
  });

const complete = dashboardProcedure.input(stripeSetupSchema).handler(async ({ context, input }) => {
  try {
    return await completeOnboarding({
      storeId: context.store.id,
      input,
      notifyStoreCreated: context.notifyStoreCreated,
    });
  } catch (error) {
    throw toORPCError(error);
  }
});

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
  updateBranding,
  complete,
};
