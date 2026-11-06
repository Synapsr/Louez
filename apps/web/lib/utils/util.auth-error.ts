export function mapAuthErrorCodeToMessageKey(
  code: string | null | undefined,
): string | null {
  if (!code) {
    return null;
  }

  switch (code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
      return 'errors.invalidCredentials';
    case 'USER_ALREADY_EXISTS':
      return 'errors.emailAlreadyExists';
    case 'REGISTRATION_CLOSED':
      return 'errors.registrationClosed';
    case 'EMAIL_PASSWORD_SIGN_UP_DISABLED':
      return 'errors.passwordSignUpDisabled';
    case 'INVALID_OTP':
    // Checking a reset code for an address without an account answers
    // USER_NOT_FOUND; saying so would reveal which addresses have one.
    case 'USER_NOT_FOUND':
      return 'errors.invalidCode';
    case 'OTP_EXPIRED':
      return 'errors.codeExpired';
    case 'TOO_MANY_ATTEMPTS':
      return 'errors.tooManyAttempts';
    case 'TOO_MANY_REQUESTS':
      return 'errors.tooManyRequests';
    case 'PASSWORD_TOO_SHORT':
      return 'errors.passwordTooShort';
    case 'PASSWORD_TOO_LONG':
      return 'errors.passwordTooLong';
    case 'INVALID_PASSWORD':
      return 'errors.invalidPassword';
    case 'PASSWORD_ALREADY_SET':
      return 'errors.passwordAlreadySet';
    case 'CREDENTIAL_ACCOUNT_NOT_FOUND':
      return 'errors.passwordNotSet';
    case 'PASSWORD_REMOVAL_UNAVAILABLE':
      return 'errors.passwordRemovalUnavailable';
    case 'UNAUTHORIZED':
      return 'errors.sessionExpired';
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

export function resolveAuthErrorMessage(
  t: (key: string) => string,
  errorCode: string | null,
): string {
  const messageKey = mapAuthErrorCodeToMessageKey(errorCode);
  return t(messageKey ?? 'errors.default');
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

const TOO_MANY_REQUESTS_STATUS = 429;

export function getAuthErrorCode(error: unknown): string | null {
  const code = getStringProperty(error, 'code');
  if (code) {
    return code;
  }

  // The rate limiter answers before any endpoint runs: a bare 429, no code.
  const status: unknown =
    typeof error === 'object' && error !== null
      ? Object.getOwnPropertyDescriptor(error, 'status')?.value
      : undefined;

  return status === TOO_MANY_REQUESTS_STATUS ? 'TOO_MANY_REQUESTS' : null;
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
