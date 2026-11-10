import { ORPCError } from '@orpc/server';

import { sanitizeText } from '../platform/sanitize-error';
import { ApiServiceError } from '../services/errors';

function toDebugErrorMessage(error: unknown) {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const redactedMessage = sanitizeText(message);

  return redactedMessage.length > 500
    ? `${redactedMessage.slice(0, 500)}...`
    : redactedMessage;
}

export function toORPCError(error: unknown) {
  if (error instanceof ORPCError) {
    return error;
  }

  if (error instanceof ApiServiceError) {
    return new ORPCError(error.code, {
      message: error.key,
      data: error.details,
    });
  }

  console.error('[api][toORPCError] unexpected error', error);

  // The original stays as `cause`, which no transport sends: error tracking
  // reports the fault itself (platform/error-reporting.ts `rootFault`).
  return new ORPCError('INTERNAL_SERVER_ERROR', {
    message:
      process.env.NODE_ENV === 'production'
        ? 'errors.internalServerError'
        : toDebugErrorMessage(error),
    cause: error,
  });
}
