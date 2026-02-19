import { createORPCReactQueryUtils } from '@orpc/react-query'
import { orpcClient } from './client'

/**
 * TanStack Query utilities for oRPC
 *
 * Provides type-safe query options for use with TanStack Query hooks.
 *
 * Usage:
 * ```tsx
 * import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
 * import { orpc } from '@/lib/orpc/react'
 *
 * function MyComponent() {
 *   // Query
 *   const { data, isLoading } = useQuery(
 *     orpc.dashboard.ping.queryOptions({
 *       input: { message: 'hello' }
 *     })
 *   )
 *
 *   // Mutation
 *   const mutation = useMutation(
 *     orpc.dashboard.someAction.mutationOptions({
 *       onSuccess: () => {
 *         // Invalidate related queries
 *         queryClient.invalidateQueries({ queryKey: orpc.dashboard.ping.key() })
 *       }
 *     })
 *   )
 *
 *   // Infinite query (for pagination)
 *   const { data, fetchNextPage } = useInfiniteQuery(
 *     orpc.dashboard.list.infiniteOptions({
 *       input: (pageParam) => ({ cursor: pageParam, limit: 10 }),
 *       initialPageParam: undefined,
 *       getNextPageParam: (lastPage) => lastPage.nextCursor,
 *     })
 *   )
 * }
 * ```
 */
export const orpc = createORPCReactQueryUtils(orpcClient)

// Re-export client for direct usage when needed
export { orpcClient } from './client'
