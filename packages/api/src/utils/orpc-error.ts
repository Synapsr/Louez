import { ORPCError } from '@orpc/server';

import { ApiServiceError } from '../services/errors';

function redactSensitiveErrorParts(message: string) {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(
      /(authorization|cookie|password|secret|token|api[_-]?key|client[_-]?secret)(["'\s:=]+)([^"',\s]+)/gi,
      '$1$2[redacted]',
    );
}

function toDebugErrorMessage(error: unknown) {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const redactedMessage = redactSensitiveErrorParts(message);

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

  return new ORPCError('INTERNAL_SERVER_ERROR', {
    message:
      process.env.NODE_ENV === 'production'
        ? 'errors.internalServerError'
        : toDebugErrorMessage(error),
  });
}
