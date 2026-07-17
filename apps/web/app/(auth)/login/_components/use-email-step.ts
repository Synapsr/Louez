'use client';

import { useEffect, useMemo, useState } from 'react';

import { useSearchParams } from 'next/navigation';

import { revalidateLogic } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { z } from 'zod';

import { authClient } from '@louez/auth/client';

import {
  createAuthMutationError,
  getAuthErrorCode,
  getMutationAuthCode,
  hasAuthError,
  resolveAuthErrorMessage,
} from '@/lib/utils/util.auth-error';

import { useAppForm } from '@/hooks/form/form';

import { useCallbackUrl } from './use-callback-url';

interface UseEmailStepParams {
  onOtpSent: (email: string) => void;
}

export const useEmailStep = ({ onOtpSent }: UseEmailStepParams) => {
  const t = useTranslations('auth');
  const callbackUrl = useCallbackUrl();

  // The `error` search param comes from the OAuth callback redirect, so it
  // only concerns this step.
  const initialErrorCode = useSearchParams().get('error');

  const initialErrorMessage = useMemo(
    () => resolveAuthErrorMessage(t, initialErrorCode),
    [initialErrorCode, t],
  );
  const [rootError, setRootError] = useState<string | null>(
    initialErrorCode ? initialErrorMessage : null,
  );

  useEffect(() => {
    if (!initialErrorCode) {
      return;
    }

    setRootError(initialErrorMessage);
  }, [initialErrorCode, initialErrorMessage]);

  const sendOtpMutation = useMutation({
    mutationFn: async (email: string) => {
      const result = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: 'sign-in',
      });

      if (hasAuthError(result)) {
        throw createAuthMutationError(getAuthErrorCode(result.error));
      }
    },
  });

  const googleSignInMutation = useMutation({
    mutationFn: async () => {
      const result = await authClient.signIn.social({
        provider: 'google',
        callbackURL: callbackUrl,
      });

      if (result.error) {
        throw createAuthMutationError(getAuthErrorCode(result.error));
      }
    },
    onError: (error) => {
      setRootError(resolveAuthErrorMessage(t, getMutationAuthCode(error)));
    },
  });

  const emailSchema = useMemo(
    () =>
      z.object({
        email: z.email(t('errors.invalidEmail')),
      }),
    [t],
  );

  const form = useAppForm({
    defaultValues: {
      email: '',
    },
    validationLogic: revalidateLogic({
      mode: 'submit',
      modeAfterSubmission: 'change',
    }),
    validators: {
      onSubmit: emailSchema,
    },
    onSubmit: async ({ value }) => {
      setRootError(null);

      try {
        await sendOtpMutation.mutateAsync(value.email);
        onOtpSent(value.email);
      } catch (error) {
        setRootError(resolveAuthErrorMessage(t, getMutationAuthCode(error)));
      }
    },
  });

  const handleGoogleSignIn = () => {
    setRootError(null);
    googleSignInMutation.mutate();
  };

  const isPending = sendOtpMutation.isPending || googleSignInMutation.isPending;

  return { form, handleGoogleSignIn, isPending, rootError };
};
