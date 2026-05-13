import { env } from '@/env';

const DEFAULT_CALLBACK_URL = '/dashboard';
const RELATIVE_CALLBACK_PATTERN = /^\/(?!\/)[a-zA-Z0-9\-_/?&=#%]*$/;

export function sanitizeCallbackUrl(input: string | null | undefined): string {
  if (!input) {
    return DEFAULT_CALLBACK_URL;
  }

  if (RELATIVE_CALLBACK_PATTERN.test(input)) {
    return input;
  }

  try {
    const parsedCallbackUrl = new URL(input);
    const appDomain = new URL(env.NEXT_PUBLIC_APP_URL).hostname;

    if (
      parsedCallbackUrl.hostname === appDomain ||
      parsedCallbackUrl.hostname.endsWith(`.${appDomain}`)
    ) {
      return input;
    }
  } catch {
    return DEFAULT_CALLBACK_URL;
  }

  return DEFAULT_CALLBACK_URL;
}
