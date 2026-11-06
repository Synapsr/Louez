'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

import { Pagination } from '@/components/ui/pagination'

const PAGE_SIZES = [10, 25, 50] as const

interface ReservationsPaginationProps {
  totalCount: number | null
  currentPage: number
  currentPageSize: number
}

/** The reservations list keeps its page in the router's search params; the footer itself is shared. */
export function ReservationsPagination({
  totalCount,
  currentPage,
  currentPageSize,
}: ReservationsPaginationProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(updates)) {
        if (value === null) {
          params.delete(key)
        } else {
          params.set(key, value)
        }
      }
      router.push(`/dashboard/reservations?${params.toString()}`)
    },
    [searchParams, router]
  )

  // Don't show pagination if there are no results or no total count
  if (totalCount === null) return null

  return (
    <Pagination
      page={currentPage}
      pageSize={currentPageSize}
      totalCount={totalCount}
      pageSizes={PAGE_SIZES}
      onPageChange={(page) => updateParams({ page: page > 1 ? String(page) : null })}
      onPageSizeChange={(pageSize) =>
        updateParams({
          pageSize: pageSize !== 25 ? String(pageSize) : null,
          page: null, // reset to first page when changing page size
        })
      }
    />
  )
}
