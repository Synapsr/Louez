'use client';

import { useMemo, useState } from 'react';

import { revalidateLogic } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { z } from 'zod';

import { authClient } from '@louez/auth/client';

import {
  createAuthMutationError,
  getAuthErrorCode,
  getMutationAuthCode,
  resolveAuthErrorMessage,
} from '@/lib/utils/util.auth-error';

import { useAppForm } from '@/hooks/form/form';

import { useCallbackUrl } from './use-callback-url';

interface UseOtpStepParams {
  email: string;
}

export const useOtpStep = ({ email }: UseOtpStepParams) => {
  const t = useTranslations('auth');
  const callbackUrl = useCallbackUrl();
  const [rootError, setRootError] = useState<string | null>(null);

  const verifyOtpMutation = useMutation({
    mutationFn: async (otp: string) => {
      const result = await authClient.signIn.emailOtp({
        email,
        otp,
      });

      if (result.error) {
        throw createAuthMutationError(getAuthErrorCode(result.error));
      }
    },
  });

  const otpSchema = useMemo(
    () =>
      z.object({
        otp: z.string().length(6, t('errors.default')),
      }),
    [t],
  );

  const form = useAppForm({
    defaultValues: {
      otp: '',
    },
    validationLogic: revalidateLogic({
      mode: 'submit',
      modeAfterSubmission: 'change',
    }),
    validators: {
      onSubmit: otpSchema,
    },
    onSubmit: async ({ value }) => {
      setRootError(null);

      try {
        await verifyOtpMutation.mutateAsync(value.otp);
        window.location.href = callbackUrl;
      } catch (error) {
        setRootError(resolveAuthErrorMessage(t, getMutationAuthCode(error)));
      }
    },
  });

  return { form, isPending: verifyOtpMutation.isPending, rootError };
};
