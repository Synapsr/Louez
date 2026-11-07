'use client';

import { useSearchParams } from 'next/navigation';

import { usePublicEnv } from '@/components/shared/public-env-provider';
import { sanitizeCallbackUrl } from '@/lib/utils/util.url';

import { oauthAuthorizeUrl } from './util.oauth-authorize-url';

/**
 * Where every sign-in method goes once it succeeds: the authorization an
 * agent is waiting for, else the sanitized `callbackUrl`.
 */
export const useCallbackUrl = () => {
  const searchParams = useSearchParams();
  const { NEXT_PUBLIC_APP_URL: appUrl } = usePublicEnv();

  return (
    oauthAuthorizeUrl(new URLSearchParams(searchParams.toString())) ??
    sanitizeCallbackUrl(searchParams.get('callbackUrl'), appUrl)
  );
};
