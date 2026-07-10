'use client';

import { useEffect } from 'react';

import { useRouter } from 'next/navigation';

import { useStore } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import { toastManager } from '@louez/ui';
import { isValidImageUrlClient, stripeSetupSchema } from '@louez/validations';

import { orpc } from '@/lib/orpc/react';

import { useAppForm } from '@/hooks/form/form';

import { useOnboardingErrorToast } from '../_lib/onboarding-error-toast';
import { useOnboardingPreview } from '../_lib/preview-context';
import { useOnboardingDraft } from '../_lib/use-onboarding-draft';

interface UseStripeStepParams {
  nextPath: string;
}

export const useStripeStep = ({ nextPath }: UseStripeStepParams) => {
  const router = useRouter();
  const t = useTranslations('onboarding.stripe');
  const showError = useOnboardingErrorToast();
  const { updatePreview } = useOnboardingPreview();

  const completeOnboardingMutation = useMutation(
    orpc.dashboard.onboarding.complete.mutationOptions(),
  );

  const draftQuery = useOnboardingDraft();

  const form = useAppForm({
    defaultValues: {
      reservationMode: 'request' as 'request' | 'payment',
    },
    validators: {
      onSubmit: stripeSetupSchema,
    },
    onSubmit: async ({ value }) => {
      try {
        await completeOnboardingMutation.mutateAsync(value);
        toastManager.add({ title: t('configComplete'), type: 'success' });
        // Signal the welcome animation via sessionStorage (more reliable than URL params)
        sessionStorage.setItem('louez-show-welcome', '1');
        router.push(nextPath);
      } catch (error) {
        showError(error);
      }
    },
  });

  const reservationMode = useStore(form.store, (s) => s.values.reservationMode);

  // Keep the live preview in sync with the draft (after a reload) and the mode
  useEffect(() => {
    const data = draftQuery.data;
    if (!data?.store) return;

    const branding = data.branding;
    updatePreview({
      storeName: data.store.name || '',
      slug: data.store.slug || '',
      ...(branding
        ? {
            logoUrl:
              branding.logoUrl && isValidImageUrlClient(branding.logoUrl)
                ? branding.logoUrl
                : null,
            primaryColor: branding.primaryColor || '#0066FF',
            theme: branding.theme === 'dark' ? 'dark' : 'light',
          }
        : {}),
    });
  }, [draftQuery.data, updatePreview]);

  useEffect(() => {
    updatePreview({ reservationMode });
  }, [reservationMode, updatePreview]);

  return {
    form,
    reservationMode,
    isPending: completeOnboardingMutation.isPending,
  };
};
