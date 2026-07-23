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

export type PasswordMode = 'signIn' | 'signUp';

// better-auth's default minimum password length.
const MIN_PASSWORD_LENGTH = 8;

export const usePasswordStep = () => {
  const t = useTranslations('auth');
  const callbackUrl = useCallbackUrl();
  const [mode, setMode] = useState<PasswordMode>('signIn');
  const [rootError, setRootError] = useState<string | null>(null);

  const signInMutation = useMutation({
    mutationFn: async (value: { email: string; password: string }) => {
      const result = await authClient.signIn.email({
        email: value.email,
        password: value.password,
      });

      if (result.error) {
        throw createAuthMutationError(getAuthErrorCode(result.error));
      }
    },
  });

  const signUpMutation = useMutation({
    mutationFn: async (value: {
      name: string;
      email: string;
      password: string;
    }) => {
      const result = await authClient.signUp.email({
        name: value.name,
        email: value.email,
        password: value.password,
      });

      if (result.error) {
        throw createAuthMutationError(getAuthErrorCode(result.error));
      }
    },
  });

  const passwordSchema = useMemo(
    () =>
      z.object({
        name:
          mode === 'signUp'
            ? z.string().min(1, t('errors.default'))
            : z.string(),
        email: z.email(t('errors.invalidEmail')),
        password: z.string().min(MIN_PASSWORD_LENGTH, t('errors.passwordTooShort')),
      }),
    [mode, t],
  );

  const form = useAppForm({
    defaultValues: {
      name: '',
      email: '',
      password: '',
    },
    validationLogic: revalidateLogic({
      mode: 'submit',
      modeAfterSubmission: 'change',
    }),
    validators: {
      onSubmit: passwordSchema,
    },
    onSubmit: async ({ value }) => {
      setRootError(null);

      try {
        if (mode === 'signUp') {
          await signUpMutation.mutateAsync(value);
        } else {
          await signInMutation.mutateAsync(value);
        }
        window.location.href = callbackUrl;
      } catch (error) {
        setRootError(resolveAuthErrorMessage(t, getMutationAuthCode(error)));
      }
    },
  });

  const toggleMode = () => {
    setRootError(null);
    setMode((prev) => (prev === 'signIn' ? 'signUp' : 'signIn'));
  };

  const isPending = signInMutation.isPending || signUpMutation.isPending;

  return { form, mode, toggleMode, isPending, rootError };
};
