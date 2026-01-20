'use client'

import { useState, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Calendar as CalendarIcon,
  Download,
  LayoutGrid,
  Rows3,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn, formatDateShort } from '@/lib/utils'
import { CalendarExportModal } from './calendar-export-modal'
import { WeekView } from './week-view'
import { TimelineView } from './timeline-view'
import { MonthView } from './month-view'
import {
  createWeekConfig,
  createTwoWeekConfig,
  createMonthConfig,
  getWeekStart,
  getWeekEnd,
} from './calendar-utils'
import type { Reservation, Product, ViewMode, ReservationStatus, TimelineConfig } from './types'

// =============================================================================
// Constants
// =============================================================================

const STATUS_COLORS: Record<ReservationStatus, string> = {
  pending: 'bg-yellow-500',
  confirmed: 'bg-green-500',
  ongoing: 'bg-blue-500',
  completed: 'bg-gray-400',
  cancelled: 'bg-red-300',
  rejected: 'bg-red-400',
}

// =============================================================================
// Types
// =============================================================================

interface CalendarViewProps {
  initialReservations: Reservation[]
  products: Product[]
  storeId: string
}

// =============================================================================
// Component
// =============================================================================

export function CalendarView({
  initialReservations,
  products,
  storeId,
}: CalendarViewProps) {
  const t = useTranslations('dashboard.calendar')

  // State
  const [currentDate, setCurrentDate] = useState(new Date())
  const [viewMode, setViewMode] = useState<ViewMode>('week')
  const [selectedProductId, setSelectedProductId] = useState<string>('all')
  const [reservations] = useState(initialReservations)
  const [exportModalOpen, setExportModalOpen] = useState(false)

  // Status labels for legend
  const statusLabels: Record<ReservationStatus, string> = useMemo(
    () => ({
      pending: t('status.pending'),
      confirmed: t('status.confirmed'),
      ongoing: t('status.ongoing'),
      completed: t('status.completed'),
      cancelled: t('status.cancelled'),
      rejected: t('status.rejected'),
    }),
    [t]
  )

  // Timeline configuration
  const timelineConfig = useMemo((): TimelineConfig => {
    if (viewMode === 'timeline') {
      return createTwoWeekConfig(currentDate)
    }
    if (viewMode === 'month') {
      return createMonthConfig(currentDate)
    }
    return createWeekConfig(currentDate)
  }, [currentDate, viewMode])

  // Filter reservations by product
  const filteredReservations = useMemo(() => {
    if (selectedProductId === 'all') return reservations
    return reservations.filter((r) =>
      r.items.some((item) => item.product?.id === selectedProductId)
    )
  }, [reservations, selectedProductId])

  // Navigation
  const goToPrevious = useCallback(() => {
    setCurrentDate((prev) => {
      const newDate = new Date(prev)
      if (viewMode === 'month') {
        newDate.setMonth(newDate.getMonth() - 1)
      } else if (viewMode === 'timeline') {
        newDate.setDate(newDate.getDate() - 14)
      } else {
        newDate.setDate(newDate.getDate() - 7)
      }
      return newDate
    })
  }, [viewMode])

  const goToNext = useCallback(() => {
    setCurrentDate((prev) => {
      const newDate = new Date(prev)
      if (viewMode === 'month') {
        newDate.setMonth(newDate.getMonth() + 1)
      } else if (viewMode === 'timeline') {
        newDate.setDate(newDate.getDate() + 14)
      } else {
        newDate.setDate(newDate.getDate() + 7)
      }
      return newDate
    })
  }, [viewMode])

  const goToToday = useCallback(() => {
    setCurrentDate(new Date())
  }, [])

  // Period label
  const periodLabel = useMemo(() => {
    if (viewMode === 'month') {
      return new Intl.DateTimeFormat('fr-FR', {
        month: 'long',
        year: 'numeric',
      }).format(currentDate)
    }

    const start = viewMode === 'timeline'
      ? timelineConfig.startDate
      : getWeekStart(currentDate)
    const end = viewMode === 'timeline'
      ? timelineConfig.endDate
      : getWeekEnd(currentDate)

    return `${formatDateShort(start)} - ${formatDateShort(end)} ${end.getFullYear()}`
  }, [currentDate, viewMode, timelineConfig])

  // View mode icons
  const viewModeIcons: Record<ViewMode, React.ReactNode> = {
    week: <CalendarIcon className="h-4 w-4" />,
    month: <LayoutGrid className="h-4 w-4" />,
    timeline: <Rows3 className="h-4 w-4" />,
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            {/* Navigation */}
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={goToPrevious}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={goToNext}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={goToToday}>
                {t('today')}
              </Button>
              <span className="ml-2 text-lg font-semibold capitalize">
                {periodLabel}
              </span>
            </div>

            {/* Filters and actions */}
            <div className="flex flex-wrap items-center gap-2">
              {/* View mode selector */}
              <Select
                value={viewMode}
                onValueChange={(v) => setViewMode(v as ViewMode)}
              >
                <SelectTrigger className="w-[150px]">
                  {viewModeIcons[viewMode]}
                  <SelectValue className="ml-2" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="week">
                    <div className="flex items-center gap-2">
                      <CalendarIcon className="h-4 w-4" />
                      {t('views.week')}
                    </div>
                  </SelectItem>
                  <SelectItem value="month">
                    <div className="flex items-center gap-2">
                      <LayoutGrid className="h-4 w-4" />
                      {t('views.month')}
                    </div>
                  </SelectItem>
                  <SelectItem value="timeline">
                    <div className="flex items-center gap-2">
                      <Rows3 className="h-4 w-4" />
                      {t('views.timeline')}
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>

              {/* Product filter */}
              <Select
                value={selectedProductId}
                onValueChange={setSelectedProductId}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder={t('filterByProduct')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allProducts')}</SelectItem>
                  {products.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Export button */}
              <Button
                variant="outline"
                size="icon"
                onClick={() => setExportModalOpen(true)}
                title={t('export.button')}
              >
                <Download className="h-4 w-4" />
              </Button>

              {/* New reservation button */}
              <Button asChild>
                <Link href="/dashboard/reservations/new">
                  <Plus className="mr-2 h-4 w-4" />
                  {t('new')}
                </Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Calendar View */}
      {viewMode === 'week' && (
        <WeekView
          reservations={filteredReservations}
          currentDate={currentDate}
          selectedProductId={selectedProductId}
        />
      )}

      {viewMode === 'month' && (
        <MonthView
          reservations={filteredReservations}
          currentDate={currentDate}
          selectedProductId={selectedProductId}
        />
      )}

      {viewMode === 'timeline' && (
        <TimelineView
          reservations={filteredReservations}
          products={products}
          config={timelineConfig}
          selectedProductId={selectedProductId}
        />
      )}

      {/* Legend */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-medium">{t('legend')}</CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <div className="flex flex-wrap gap-4">
            {(Object.entries(statusLabels) as [ReservationStatus, string][]).map(
              ([status, label]) => (
                <div key={status} className="flex items-center gap-2">
                  <div className={cn('h-3 w-3 rounded', STATUS_COLORS[status])} />
                  <span className="text-sm text-muted-foreground">{label}</span>
                </div>
              )
            )}
          </div>
        </CardContent>
      </Card>

      {/* Export Modal */}
      <CalendarExportModal
        open={exportModalOpen}
        onOpenChange={setExportModalOpen}
        storeId={storeId}
      />
    </div>
  )
}
