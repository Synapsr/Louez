'use client';

import { useEffect, useMemo, useState } from 'react';

import { revalidateLogic } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { z } from 'zod';

import { authClient } from '@louez/auth/client';

import { isValidReferralCode } from '@/lib/utils/referral';
import {
  createAuthMutationError,
  getAuthErrorCode,
  getMutationAuthCode,
  hasAuthError,
  mapAuthErrorCodeToMessageKey,
} from '@/lib/utils/util.auth-error';

import { useAppForm } from '@/hooks/form/form';

interface UseLoginFormParams {
  callbackUrl: string;
  initialErrorCode: string | null;
  refCode: string | null;
}

const resolveAuthErrorMessage = (
  t: (key: string) => string,
  errorCode: string | null,
): string => {
  const messageKey = mapAuthErrorCodeToMessageKey(errorCode);
  return t(messageKey ?? 'errors.default');
};

export const useLoginForm = ({
  callbackUrl,
  initialErrorCode,
  refCode,
}: UseLoginFormParams) => {
  const t = useTranslations('auth');
  const [submittedEmail, setSubmittedEmail] = useState('');
  const [otpSent, setOtpSent] = useState(false);

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

  useEffect(() => {
    if (!refCode || !isValidReferralCode(refCode)) {
      return;
    }

    document.cookie = `louez_referral=${refCode}; path=/; max-age=${60 * 60 * 24 * 7}; samesite=lax`;
  }, [refCode]);

  const verifyOtpMutation = useMutation({
    mutationFn: async ({ email, otp }: { email: string; otp: string }) => {
      const result = await authClient.signIn.emailOtp({
        email,
        otp,
      });

      if (result.error) {
        throw createAuthMutationError(getAuthErrorCode(result.error));
      }
    },
    onSuccess: () => {
      window.location.href = callbackUrl;
    },
    onError: (error) => {
      setRootError(resolveAuthErrorMessage(t, getMutationAuthCode(error)));
    },
  });

  const otpSchema = useMemo(
    () =>
      z.object({
        otp: z.string().length(6, t('errors.default')),
      }),
    [t],
  );

  const otpForm = useAppForm({
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
    onSubmit: ({ value }) => {
      setRootError(null);

      verifyOtpMutation.mutate({
        email: submittedEmail,
        otp: value.otp,
      });
    },
  });

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
    onSuccess: (_, email) => {
      setSubmittedEmail(email);
      setRootError(null);
      otpForm.reset();
      setOtpSent(true);
    },
    onError: (error) => {
      setRootError(resolveAuthErrorMessage(t, getMutationAuthCode(error)));
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

  const isPending =
    sendOtpMutation.isPending ||
    verifyOtpMutation.isPending ||
    googleSignInMutation.isPending;

  const emailSchema = useMemo(
    () =>
      z.object({
        email: z.email(t('errors.invalidEmail')),
      }),
    [t],
  );

  const emailForm = useAppForm({
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
    onSubmit: ({ value }) => {
      setRootError(null);

      sendOtpMutation.mutate(value.email);
    },
  });

  const handleGoogleSignIn = () => {
    setRootError(null);
    googleSignInMutation.mutate();
  };

  const handleUseDifferentEmail = () => {
    setOtpSent(false);
    setRootError(null);
  };

  return {
    emailForm,
    handleGoogleSignIn,
    handleUseDifferentEmail,
    isPending,
    otpForm,
    otpSent,
    rootError,
    submittedEmail,
    t,
  };
};

export type LoginFormState = ReturnType<typeof useLoginForm>;
