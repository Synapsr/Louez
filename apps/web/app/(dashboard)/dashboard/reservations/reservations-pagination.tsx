'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@louez/ui'

const PAGE_SIZES = [10, 25, 50] as const

interface ReservationsPaginationProps {
  totalCount: number | null
  currentPage: number
  currentPageSize: number
}

export function ReservationsPagination({
  totalCount,
  currentPage,
  currentPageSize,
}: ReservationsPaginationProps) {
  const t = useTranslations('dashboard.reservations')
  const router = useRouter()
  const searchParams = useSearchParams()

  const totalPages = totalCount != null ? Math.ceil(totalCount / currentPageSize) : 1
  const start = (currentPage - 1) * currentPageSize + 1
  const end = totalCount != null ? Math.min(currentPage * currentPageSize, totalCount) : currentPage * currentPageSize

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

  const handlePageChange = (newPage: number) => {
    updateParams({ page: newPage > 1 ? String(newPage) : null })
  }

  const handlePageSizeChange = (value: string | null) => {
    if (value === null) return
    updateParams({
      pageSize: value !== '25' ? value : null,
      page: null, // reset to first page when changing page size
    })
  }

  // Don't show pagination if there are no results or no total count
  if (totalCount === null || totalCount === 0) return null

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-2">
      <div className="text-sm text-muted-foreground">
        {t('pagination.showing', { start, end, total: totalCount })}
      </div>

      <div className="flex items-center gap-4">
        {/* Page size selector */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{t('pagination.perPage')}</span>
          <Select value={String(currentPageSize)} onValueChange={handlePageSizeChange}>
            <SelectTrigger className="w-[70px] h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)} label={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Page navigation */}
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm px-2 min-w-[80px] text-center">
            {t('pagination.page', { current: currentPage, total: totalPages })}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage >= totalPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
