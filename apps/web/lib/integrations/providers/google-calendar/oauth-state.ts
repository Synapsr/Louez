import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '@/env';

type GoogleCalendarOAuthState = {
  storeId: string;
  userId: string;
  returnTo: string;
  exp: number;
};

function getStateSecret(): string {
  if (!env.INTEGRATION_ENCRYPTION_KEY) {
    throw new Error(
      'INTEGRATION_ENCRYPTION_KEY is required for integration OAuth',
    );
  }

  return env.INTEGRATION_ENCRYPTION_KEY;
}

function signPayload(payload: string): string {
  return createHmac('sha256', getStateSecret())
    .update(payload)
    .digest('base64url');
}

export function createGoogleCalendarOAuthState(input: {
  storeId: string;
  userId: string;
  returnTo: string;
}): string {
  const payload = Buffer.from(
    JSON.stringify({
      ...input,
      exp: Date.now() + 10 * 60 * 1000,
    } satisfies GoogleCalendarOAuthState),
    'utf8',
  ).toString('base64url');
  const signature = signPayload(payload);

  return `${payload}.${signature}`;
}

export function parseGoogleCalendarOAuthState(
  state: string,
): GoogleCalendarOAuthState | null {
  const [payload, signature] = state.split('.');
  if (!payload || !signature) return null;

  const expected = signPayload(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  let parsed: GoogleCalendarOAuthState;
  try {
    parsed = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as GoogleCalendarOAuthState;
  } catch {
    return null;
  }

  if (parsed.exp < Date.now()) return null;
  return parsed;
}
