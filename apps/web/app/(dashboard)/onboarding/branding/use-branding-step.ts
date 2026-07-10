'use client';

import { useCallback, useEffect, useRef } from 'react';

import { useRouter } from 'next/navigation';

import { useStore } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import {
  type BrandingInput,
  createBrandingSchema,
  isValidImageUrlClient,
} from '@louez/validations';

import { orpc } from '@/lib/orpc/react';

import { useAppForm } from '@/hooks/form/form';

import { useOnboardingErrorToast } from '../_lib/onboarding-error-toast';
import { useOnboardingPreview } from '../_lib/preview-context';
import { useOnboardingDraft } from '../_lib/use-onboarding-draft';

const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const useBrandingStep = () => {
  const router = useRouter();
  const tValidation = useTranslations('validation');
  const showError = useOnboardingErrorToast();
  const { updatePreview } = useOnboardingPreview();

  const brandingSchema = createBrandingSchema(tValidation);

  const uploadImageMutation = useMutation(
    orpc.dashboard.onboarding.uploadImage.mutationOptions(),
  );
  const draftQuery = useOnboardingDraft();
  const updateBrandingMutation = useMutation(
    orpc.dashboard.onboarding.updateBranding.mutationOptions(),
  );

  const form = useAppForm({
    defaultValues: {
      logoUrl: '',
      primaryColor: '#0066FF',
      theme: 'light' as 'light' | 'dark',
    } as BrandingInput,
    validators: { onSubmit: brandingSchema },
    onSubmit: async ({ value }) => {
      try {
        const sanitizedLogoUrl =
          value.logoUrl && isValidImageUrlClient(value.logoUrl)
            ? value.logoUrl
            : '';

        await updateBrandingMutation.mutateAsync({
          ...value,
          logoUrl: sanitizedLogoUrl,
        });
        router.push('/onboarding/stripe');
      } catch (error) {
        showError(error);
      }
    },
  });

  const hasHydratedDraft = useRef(false);

  useEffect(() => {
    if (hasHydratedDraft.current) return;

    const draft = draftQuery.data?.branding;
    if (!draft) return;

    const logoUrl =
      draft.logoUrl && isValidImageUrlClient(draft.logoUrl)
        ? draft.logoUrl
        : '';

    form.setFieldValue('logoUrl', logoUrl);
    form.setFieldValue('primaryColor', draft.primaryColor || '#0066FF');
    form.setFieldValue('theme', draft.theme === 'dark' ? 'dark' : 'light');

    hasHydratedDraft.current = true;
  }, [draftQuery.data, form]);

  // Keep the live preview in sync with the store draft and the form values
  useEffect(() => {
    const store = draftQuery.data?.store;
    if (!store) return;

    updatePreview({ storeName: store.name || '', slug: store.slug || '' });
  }, [draftQuery.data, updatePreview]);

  const brandingValues = useStore(form.store, (s) => s.values);

  useEffect(() => {
    updatePreview({
      logoUrl: brandingValues.logoUrl || null,
      theme: brandingValues.theme === 'dark' ? 'dark' : 'light',
      ...(HEX_COLOR_PATTERN.test(brandingValues.primaryColor)
        ? { primaryColor: brandingValues.primaryColor }
        : {}),
    });
  }, [
    brandingValues.logoUrl,
    brandingValues.primaryColor,
    brandingValues.theme,
    updatePreview,
  ]);

  // Show the local file right away, then swap it for the uploaded URL
  const handleLogoSelected = useCallback(
    async (dataUri: string) => {
      const previousLogoUrl = form.getFieldValue('logoUrl');
      form.setFieldValue('logoUrl', dataUri);

      try {
        const uploaded = await uploadImageMutation.mutateAsync({
          image: dataUri,
          type: 'logo',
          filename: 'store-logo',
        });

        form.setFieldValue('logoUrl', uploaded.url);
      } catch (error) {
        showError(error);
        form.setFieldValue('logoUrl', previousLogoUrl || '');
      }
    },
    [form, showError, uploadImageMutation],
  );

  return {
    form,
    handleLogoSelected,
    isUploading: uploadImageMutation.isPending,
    isBusy: updateBrandingMutation.isPending || uploadImageMutation.isPending,
  };
};
