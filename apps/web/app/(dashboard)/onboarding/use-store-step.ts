'use client';

import { useEffect, useRef } from 'react';

import { useRouter } from 'next/navigation';

import { revalidateLogic, useStore } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import {
  type StoreInfoInput,
  createStoreInfoSchema,
  isValidImageUrlClient,
} from '@louez/validations';

import { getDefaultCurrencyForCountry } from '@/lib/utils/currency';
import {
  ONBOARDING_FALLBACK_COUNTRY,
  detectCountryFromBrowser,
} from '@/lib/utils/util.browser-country-detection';

import { useAppForm } from '@/hooks/form/form';

import { useOnboardingErrorToast } from './_lib/onboarding-error-toast';
import { useOnboardingPreview } from './_lib/preview-context';
import { useOnboardingDraft } from './_lib/use-onboarding-draft';
import { createStore } from './actions';

export const useStoreStep = () => {
  const router = useRouter();
  const tErrors = useTranslations('errors');
  const tValidation = useTranslations('validation');
  const showError = useOnboardingErrorToast();

  const storeInfoSchema = createStoreInfoSchema(tValidation);

  const mutation = useMutation({
    mutationFn: async (value: StoreInfoInput) => {
      const result = await createStore(value);
      if (result.error) {
        throw new Error(result.error);
      }
      return result;
    },
  });

  const setSlugTakenError = () => {
    form.setFieldMeta('slug', (prev) => ({
      ...prev,
      isTouched: true,
      errorMap: {
        ...prev.errorMap,
        onSubmit: tErrors('slugTaken'),
      },
    }));
  };

  const clearSlugSubmitError = () => {
    form.setFieldMeta('slug', (prev) => ({
      ...prev,
      errorMap: {
        ...prev.errorMap,
        onSubmit: undefined,
      },
    }));
  };

  const form = useAppForm({
    defaultValues: {
      name: '',
      slug: '',
      country: ONBOARDING_FALLBACK_COUNTRY,
      currency: getDefaultCurrencyForCountry(
        ONBOARDING_FALLBACK_COUNTRY,
      ) as string,
      address: '',
      latitude: null as number | null,
      longitude: null as number | null,
      email: '',
      phone: '',
    },
    validationLogic: revalidateLogic({
      mode: 'submit',
      modeAfterSubmission: 'change',
    }),
    validators: {
      onSubmit: storeInfoSchema,
    },
    onSubmit: async ({ value }) => {
      try {
        await mutation.mutateAsync(value);
        router.push('/onboarding/branding');
      } catch (error) {
        // Map the slug conflict to a field-level error, everything else to a toast
        if (error instanceof Error && error.message === 'errors.slugTaken') {
          setSlugTakenError();
          return;
        }
        showError(error);
      }
    },
  });

  const draftQuery = useOnboardingDraft();

  const hasHydratedDraft = useRef(false);
  const hasAppliedBrowserDefaults = useRef(false);
  const formValues = useStore(form.store, (s) => s.values);
  const { updatePreview } = useOnboardingPreview();

  useEffect(() => {
    updatePreview({ storeName: formValues.name, slug: formValues.slug });
  }, [formValues.name, formValues.slug, updatePreview]);

  const hasSeededBrandingPreview = useRef(false);

  useEffect(() => {
    if (hasSeededBrandingPreview.current) return;

    const branding = draftQuery.data?.branding;
    if (!branding) return;

    updatePreview({
      logoUrl:
        branding.logoUrl && isValidImageUrlClient(branding.logoUrl)
          ? branding.logoUrl
          : null,
      primaryColor: branding.primaryColor || '#0066FF',
      theme: branding.theme === 'dark' ? 'dark' : 'light',
    });

    hasSeededBrandingPreview.current = true;
  }, [draftQuery.data, updatePreview]);

  useEffect(() => {
    if (hasHydratedDraft.current) return;

    const draft = draftQuery.data?.store;
    if (!draft) return;

    const hasLocalInput = Boolean(
      formValues.name ||
      formValues.slug ||
      formValues.address ||
      formValues.email ||
      formValues.phone,
    );
    if (hasLocalInput) {
      hasHydratedDraft.current = true;
      return;
    }

    form.setFieldValue('name', draft.name || '');
    form.setFieldValue('slug', draft.slug || '');
    form.setFieldValue('address', draft.address || '');
    form.setFieldValue('latitude', draft.latitude ?? null);
    form.setFieldValue('longitude', draft.longitude ?? null);
    form.setFieldValue('email', draft.email || '');
    form.setFieldValue('phone', draft.phone || '');
    if (draft.country) {
      form.setFieldValue('country', draft.country);
    }
    if (draft.currency) {
      form.setFieldValue('currency', draft.currency);
    }

    hasHydratedDraft.current = true;
    hasAppliedBrowserDefaults.current = true;
  }, [
    draftQuery.data,
    form,
    formValues.address,
    formValues.email,
    formValues.name,
    formValues.phone,
    formValues.slug,
  ]);

  useEffect(() => {
    if (hasAppliedBrowserDefaults.current) return;

    const detection = detectCountryFromBrowser();
    const detectedCurrency = getDefaultCurrencyForCountry(detection.country);

    form.setFieldValue('country', detection.country);
    form.setFieldValue('currency', detectedCurrency);

    hasAppliedBrowserDefaults.current = true;
  }, [form]);

  const handleCountryChange = (newCountry: string) => {
    form.setFieldValue('country', newCountry);
    form.setFieldValue('currency', getDefaultCurrencyForCountry(newCountry));
  };

  return {
    form,
    clearSlugSubmitError,
    handleCountryChange,
    country: formValues.country,
    latitude: formValues.latitude,
    longitude: formValues.longitude,
  };
};
