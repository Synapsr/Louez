import { z } from 'zod';

import { brandingSchema, stripeSetupSchema } from '@louez/validations';

import { dashboardProcedure } from '../../procedures';
import {
  completeOnboarding,
  updateOnboardingBranding,
  uploadOnboardingImage,
} from '../../services';
import { toORPCError } from '../../utils/orpc-error';

const uploadOnboardingImageInputSchema = z.object({
  image: z.string().min(1),
  type: z.enum(['logo', 'hero', 'product']),
  filename: z
    .string()
    .max(100)
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      'Filename can only contain letters, numbers, dashes, and underscores',
    )
    .optional(),
});

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

const complete = dashboardProcedure
  .input(stripeSetupSchema)
  .handler(async ({ context, input }) => {
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

const uploadImage = dashboardProcedure
  .input(uploadOnboardingImageInputSchema)
  .handler(async ({ context, input }) => {
    try {
      if (!context.uploadImageToStorage || !context.getStorageKey) {
        throw new Error('Storage context not configured');
      }

      return await uploadOnboardingImage({
        storeId: context.store.id,
        image: input.image,
        type: input.type,
        filename: input.filename,
        uploadImageToStorage: context.uploadImageToStorage,
        getStorageKey: context.getStorageKey,
      });
    } catch (error) {
      throw toORPCError(error);
    }
  });

export const dashboardOnboardingRouter = {
  updateBranding,
  complete,
  uploadImage,
};
