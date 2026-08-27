const DEFAULT_CALLBACK_URL = '/dashboard';
const RELATIVE_CALLBACK_PATTERN = /^\/(?!\/)[a-zA-Z0-9\-_/?&=#%]*$/;

export const LOGIN_CALLBACK_PATH_HEADER = 'x-louez-login-callback-path';

export function sanitizeCallbackUrl(
  input: string | null | undefined,
  appUrl?: string,
): string {
  if (!input) {
    return DEFAULT_CALLBACK_URL;
  }

  if (RELATIVE_CALLBACK_PATTERN.test(input)) {
    return input;
  }

  if (!appUrl) {
    return DEFAULT_CALLBACK_URL;
  }

  try {
    const parsedCallbackUrl = new URL(input);
    const appDomain = new URL(appUrl).hostname;

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

export function createLoginUrl(
  callbackUrl: string | null | undefined,
  appUrl?: string,
): string {
  const searchParams = new URLSearchParams({
    callbackUrl: sanitizeCallbackUrl(callbackUrl, appUrl),
  });

  return `/login?${searchParams.toString()}`;
}
