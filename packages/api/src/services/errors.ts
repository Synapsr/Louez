export type ApiServiceErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INTERNAL_SERVER_ERROR'

export class ApiServiceError extends Error {
  code: ApiServiceErrorCode
  key: string
  details?: unknown

  constructor(code: ApiServiceErrorCode, key: string, details?: unknown) {
    super(key)
    this.code = code
    this.key = key
    this.details = details
  }
}
