import { ORPCError } from '@orpc/server'
import { ApiServiceError } from '../services/errors'

export function toORPCError(error: unknown) {
  if (error instanceof ORPCError) {
    return error
  }

  if (error instanceof ApiServiceError) {
    return new ORPCError(error.code, {
      message: error.key,
      data: error.details,
    })
  }

  return new ORPCError('INTERNAL_SERVER_ERROR', {
    message: 'errors.internalServerError',
  })
}
