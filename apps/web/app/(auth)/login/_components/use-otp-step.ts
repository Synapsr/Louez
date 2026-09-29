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
import { rememberLastSignInMethod } from './util.last-sign-in-method';

/**
 * What a valid code does. Signing in consumes it on the spot; a password
 * reset only checks it here and hands it over — better-auth consumes it
 * together with the new password, on the next screen.
 */
export type OtpStepFlow =
  | { purpose: 'sign-in' }
  | { purpose: 'forget-password'; onVerified: (otp: string) => void };

interface UseOtpStepParams {
  email: string;
  flow: OtpStepFlow;
}

export const useOtpStep = ({ email, flow }: UseOtpStepParams) => {
  const t = useTranslations('auth');
  const callbackUrl = useCallbackUrl();
  const [rootError, setRootError] = useState<string | null>(null);

  const verifyOtpMutation = useMutation({
    mutationFn: async (otp: string) => {
      const result =
        flow.purpose === 'sign-in'
          ? await authClient.signIn.emailOtp({ email, otp })
          : await authClient.emailOtp.checkVerificationOtp({
              email,
              otp,
              type: 'forget-password',
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
      } catch (error) {
        setRootError(resolveAuthErrorMessage(t, getMutationAuthCode(error)));
        return;
      }

      if (flow.purpose === 'forget-password') {
        flow.onVerified(value.otp);
        return;
      }

      rememberLastSignInMethod('emailOtp');
      window.location.href = callbackUrl;
    },
  });

  return { form, isPending: verifyOtpMutation.isPending, rootError };
};
