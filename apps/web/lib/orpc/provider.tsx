'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

interface ORPCProviderProps {
  children: React.ReactNode
}

/**
 * Provider component for TanStack Query
 *
 * This should wrap the application root to enable oRPC queries.
 * Creates a new QueryClient instance per request to avoid data leaks
 * between different users in SSR.
 */
export function ORPCProvider({ children }: ORPCProviderProps) {
  // Create a new QueryClient instance for each component mount
  // This prevents data from being shared between users in SSR
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Don't refetch on window focus by default (can be overridden per-query)
            refetchOnWindowFocus: false,
            // Stale time: how long data is considered fresh (5 seconds)
            staleTime: 5 * 1000,
            // Retry failed requests once
            retry: 1,
          },
        },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}
