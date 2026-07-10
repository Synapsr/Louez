'use client';

import { useCallback } from 'react';

import { useTranslations } from 'next-intl';

import { toastManager } from '@louez/ui';

function resolveErrorMessage(
  tErrors: (key: string) => string,
  error: unknown,
): string {
  if (error instanceof Error) {
    if (error.message.startsWith('errors.')) {
      return tErrors(error.message.replace('errors.', ''));
    }
    if (error.message.trim().length > 0) {
      return error.message;
    }
  }

  return tErrors('generic');
}

export function useOnboardingErrorToast() {
  const tErrors = useTranslations('errors');

  return useCallback(
    (error: unknown) => {
      toastManager.add({
        title: resolveErrorMessage(tErrors, error),
        type: 'error',
      });
    },
    [tErrors],
  );
}
