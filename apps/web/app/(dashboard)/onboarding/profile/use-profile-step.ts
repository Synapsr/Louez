'use client';

import { useEffect } from 'react';

import { useRouter } from 'next/navigation';

import { revalidateLogic, useStore } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { z } from 'zod';

import { type BusinessType, createProfileSchema } from '@louez/validations';

import { useAppForm } from '@/hooks/form/form';

import { useOnboardingErrorToast } from '../_lib/onboarding-error-toast';
import { useOnboardingPreview } from '../_lib/preview-context';
import { updateUserProfile } from '../profile-actions';

interface ProfileFormValues {
  name: string;
  businessType: BusinessType | null;
  // data URI for a new photo, null when removed, initialImage when untouched
  image: string | null;
}

interface UseProfileStepParams {
  initialName: string;
  initialImage: string | null;
  initialBusinessType: BusinessType | null;
}

export const useProfileStep = ({
  initialName,
  initialImage,
  initialBusinessType,
}: UseProfileStepParams) => {
  const router = useRouter();
  const tValidation = useTranslations('validation');
  const showError = useOnboardingErrorToast();
  const { updatePreview } = useOnboardingPreview();

  const profileSchema = createProfileSchema(tValidation).extend({
    image: z.string().nullable(),
  });

  const mutation = useMutation({
    mutationFn: async (value: ProfileFormValues) => {
      const result = await updateUserProfile({
        name: value.name,
        businessType: value.businessType,
        // undefined = keep the current image, null = remove it, string = new data URI
        imageDataUri: value.image === initialImage ? undefined : value.image,
      });
      if (result.error) {
        throw new Error(result.error);
      }
      return result;
    },
  });

  const form = useAppForm({
    defaultValues: {
      name: initialName,
      businessType: initialBusinessType as BusinessType | null,
      image: initialImage,
    } as ProfileFormValues,
    validationLogic: revalidateLogic({
      mode: 'submit',
      modeAfterSubmission: 'change',
    }),
    validators: { onSubmit: profileSchema },
    onSubmit: async ({ value }) => {
      try {
        await mutation.mutateAsync(value);
        router.push('/onboarding');
      } catch (error) {
        showError(error);
      }
    },
  });

  const formValues = useStore(form.store, (s) => s.values);

  useEffect(() => {
    updatePreview({ userName: formValues.name, userImage: formValues.image });
  }, [formValues.name, formValues.image, updatePreview]);

  return { form };
};
