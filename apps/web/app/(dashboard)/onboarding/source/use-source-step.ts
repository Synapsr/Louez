'use client';

import { useRouter } from 'next/navigation';

import { revalidateLogic, useStore } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';

import {
  ACQUISITION_CHANNELS,
  type AcquisitionChannel,
  type AcquisitionInput,
} from '@louez/validations';

import { useAppForm } from '@/hooks/form/form';

import { useOnboardingErrorToast } from '../_lib/onboarding-error-toast';
import { saveAcquisitionChannel } from '../profile-actions';

// Form-shaped schema: the channel starts empty until the user picks one
const sourceFormSchema = z.object({
  channel: z
    .union([z.enum(ACQUISITION_CHANNELS), z.literal('')])
    .refine((value) => value !== ''),
  other: z.string().max(255),
});

export const useSourceStep = () => {
  const router = useRouter();
  const showError = useOnboardingErrorToast();

  const mutation = useMutation({
    mutationFn: async (value: AcquisitionInput) => {
      const result = await saveAcquisitionChannel(value);
      if (result.error) {
        throw new Error(result.error);
      }
      return result;
    },
  });

  const form = useAppForm({
    defaultValues: {
      channel: '' as AcquisitionChannel | '',
      other: '',
    },
    validationLogic: revalidateLogic({
      mode: 'submit',
      modeAfterSubmission: 'change',
    }),
    validators: { onSubmit: sourceFormSchema },
    onSubmit: async ({ value }) => {
      if (!value.channel) return;
      try {
        await mutation.mutateAsync({
          channel: value.channel,
          other: value.other,
        });
        router.push('/dashboard');
      } catch (error) {
        showError(error);
      }
    },
  });

  const channel = useStore(form.store, (s) => s.values.channel);

  const handleSkip = async () => {
    try {
      await mutation.mutateAsync({ channel: 'skipped', other: '' });
    } catch {
      // Skipping must never block the user from reaching the dashboard.
    }
    router.push('/dashboard');
  };

  return { form, channel, handleSkip, isPending: mutation.isPending };
};
