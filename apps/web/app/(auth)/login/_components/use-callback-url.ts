'use client';

import { useSearchParams } from 'next/navigation';

import { sanitizeCallbackUrl } from '@/lib/utils/util.url';

export const useCallbackUrl = () => {
  const searchParams = useSearchParams();

  return sanitizeCallbackUrl(searchParams.get('callbackUrl'));
};
