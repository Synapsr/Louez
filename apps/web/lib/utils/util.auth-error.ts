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

export function hasAuthError(result: unknown): result is { error: unknown } {
  const errorDescriptor =
    typeof result === 'object' && result !== null
      ? Object.getOwnPropertyDescriptor(result, 'error')
      : undefined;

  return Boolean(errorDescriptor?.value);
}

function getStringProperty(input: unknown, property: string): string | null {
  const descriptor =
    typeof input === 'object' && input !== null
      ? Object.getOwnPropertyDescriptor(input, property)
      : undefined;

  return typeof descriptor?.value === 'string' ? descriptor.value : null;
}

export function getAuthErrorCode(error: unknown): string | null {
  return getStringProperty(error, 'code');
}

interface AuthMutationError extends Error {
  authCode?: string;
}

export function createAuthMutationError(
  authCode: string | null,
): AuthMutationError {
  return Object.assign(new Error(authCode ?? 'AUTH_DEFAULT'), {
    authCode: authCode ?? undefined,
  });
}

export function getMutationAuthCode(error: unknown): string | null {
  return getStringProperty(error, 'authCode');
}
