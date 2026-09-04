'use client';

import { useSearchParams } from 'next/navigation';

import { usePublicEnv } from '@/components/shared/public-env-provider';
import { sanitizeCallbackUrl } from '@/lib/utils/util.url';

export const useCallbackUrl = () => {
  const searchParams = useSearchParams();
  const { NEXT_PUBLIC_APP_URL: appUrl } = usePublicEnv();

  return sanitizeCallbackUrl(searchParams.get('callbackUrl'), appUrl);
};
