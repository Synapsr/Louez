const DEFAULT_CALLBACK_URL = '/dashboard';
const RELATIVE_CALLBACK_PATTERN = /^\/(?!\/)[a-zA-Z0-9\-_/?&=#%]*$/;
const REFERRAL_CODE_PATTERN = /^LOUEZ[A-HJ-NP-Z2-9]{7}$/;

export function sanitizeCallbackUrl(input: string | null | undefined): string {
  if (!input) {
    return DEFAULT_CALLBACK_URL;
  }

  if (RELATIVE_CALLBACK_PATTERN.test(input)) {
    return input;
  }

  try {
    const parsedCallbackUrl = new URL(input);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;

    if (!appUrl) {
      return DEFAULT_CALLBACK_URL;
    }

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

export function mapAuthErrorCodeToMessageKey(
  code: string | null | undefined,
): string | null {
  if (!code) {
    return null;
  }

  switch (code) {
    case 'OAuthAccountNotLinked':
      return 'errors.accountNotLinked';
    case 'OAuthSignin':
    case 'OAuthCallback':
      return 'errors.oauthError';
    case 'AccessDenied':
      return 'errors.accessDenied';
    case 'Verification':
      return 'errors.verification';
    default:
      return 'errors.default';
  }
}

export function isValidReferralCode(ref: string | null | undefined): boolean {
  if (!ref) {
    return false;
  }

  return REFERRAL_CODE_PATTERN.test(ref);
}
