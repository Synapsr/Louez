/**
 * Sanitize pagination parameters with safe defaults and limits.
 */
export function paginationParams(input: {
  page?: number
  pageSize?: number
}): { limit: number; offset: number; page: number; pageSize: number } {
  const page = Math.max(1, input.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 50))
  return {
    limit: pageSize,
    offset: (page - 1) * pageSize,
    page,
    pageSize,
  }
}
