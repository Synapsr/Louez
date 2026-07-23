'use client';

import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import { authClient } from '@louez/auth/client';

import {
  createAuthMutationError,
  getAuthErrorCode,
  getMutationAuthCode,
  resolveAuthErrorMessage,
} from '@/lib/utils/util.auth-error';

import { useCallbackUrl } from './use-callback-url';

export const useGoogleSignIn = (onError: (message: string) => void) => {
  const t = useTranslations('auth');
  const callbackUrl = useCallbackUrl();

  const mutation = useMutation({
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
      onError(resolveAuthErrorMessage(t, getMutationAuthCode(error)));
    },
  });

  return { signIn: () => mutation.mutate(), isPending: mutation.isPending };
};
