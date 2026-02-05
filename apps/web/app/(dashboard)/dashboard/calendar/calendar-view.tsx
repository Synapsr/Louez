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
} from 'lucide-react'
import { Button } from '@louez/ui'
import { Card, CardContent, CardHeader, CardTitle } from '@louez/ui'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui'
import { cn, formatDateShort } from '@louez/utils'
import { CalendarExportModal } from './calendar-export-modal'
import { ViewModeToggle, type CalendarViewMode } from './view-mode-toggle'
import { WeekView } from './week-view'
import { MonthView } from './month-view'
import { ProductsView } from './products-view'
import {
  createWeekConfig,
  createTwoWeekConfig,
  createMonthConfig,
  getWeekStart,
  getWeekEnd,
} from './calendar-utils'
import type { Reservation, Product, ReservationStatus, TimelineConfig } from './types'

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

// Calendar sub-view options
type CalendarPeriod = 'week' | 'month'
type ProductsPeriod = 'week' | 'twoWeeks' | 'month'

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

  // Main view mode: calendar vs products
  const [viewMode, setViewMode] = useState<CalendarViewMode>('calendar')

  // Sub-view options
  const [calendarPeriod, setCalendarPeriod] = useState<CalendarPeriod>('week')
  const [productsPeriod, setProductsPeriod] = useState<ProductsPeriod>('week')

  // Date navigation
  const [currentDate, setCurrentDate] = useState(new Date())

  // Filters
  const [selectedProductId, setSelectedProductId] = useState<string>('all')

  // Data
  const [reservations] = useState(initialReservations)

  // Modals
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

  // Timeline configuration for products view
  const productsConfig = useMemo((): TimelineConfig => {
    if (productsPeriod === 'month') {
      return createMonthConfig(currentDate)
    }
    if (productsPeriod === 'twoWeeks') {
      return createTwoWeekConfig(currentDate)
    }
    return createWeekConfig(currentDate)
  }, [currentDate, productsPeriod])

  // Filter reservations by product (only for calendar mode)
  const filteredReservations = useMemo(() => {
    if (selectedProductId === 'all') return reservations
    return reservations.filter((r) =>
      r.items.some((item) => item.product?.id === selectedProductId)
    )
  }, [reservations, selectedProductId])

  // Filter products (for products view when a specific product is selected)
  const displayProducts = useMemo(() => {
    if (selectedProductId === 'all') return products
    return products.filter((p) => p.id === selectedProductId)
  }, [products, selectedProductId])

  // Navigation step based on current view
  const getNavigationStep = useCallback(() => {
    if (viewMode === 'products') {
      if (productsPeriod === 'month') return { type: 'month' as const }
      if (productsPeriod === 'twoWeeks') return { type: 'days' as const, days: 14 }
      return { type: 'days' as const, days: 7 }
    }
    if (calendarPeriod === 'month') return { type: 'month' as const }
    return { type: 'days' as const, days: 7 }
  }, [viewMode, calendarPeriod, productsPeriod])

  // Navigation
  const goToPrevious = useCallback(() => {
    const step = getNavigationStep()
    setCurrentDate((prev) => {
      const newDate = new Date(prev)
      if (step.type === 'month') {
        newDate.setMonth(newDate.getMonth() - 1)
      } else {
        newDate.setDate(newDate.getDate() - step.days)
      }
      return newDate
    })
  }, [getNavigationStep])

  const goToNext = useCallback(() => {
    const step = getNavigationStep()
    setCurrentDate((prev) => {
      const newDate = new Date(prev)
      if (step.type === 'month') {
        newDate.setMonth(newDate.getMonth() + 1)
      } else {
        newDate.setDate(newDate.getDate() + step.days)
      }
      return newDate
    })
  }, [getNavigationStep])

  const goToToday = useCallback(() => {
    setCurrentDate(new Date())
  }, [])

  // Period label
  const periodLabel = useMemo(() => {
    // For month view
    const isMonthView =
      (viewMode === 'calendar' && calendarPeriod === 'month') ||
      (viewMode === 'products' && productsPeriod === 'month')

    if (isMonthView) {
      return new Intl.DateTimeFormat('fr-FR', {
        month: 'long',
        year: 'numeric',
      }).format(currentDate)
    }

    // For week/twoWeeks view
    const config =
      viewMode === 'products' ? productsConfig : createWeekConfig(currentDate)

    return `${formatDateShort(config.startDate)} - ${formatDateShort(config.endDate)} ${config.endDate.getFullYear()}`
  }, [currentDate, viewMode, calendarPeriod, productsPeriod, productsConfig])

  // Current period selector value
  const currentPeriod = viewMode === 'calendar' ? calendarPeriod : productsPeriod

  // Handle period change
  const handlePeriodChange = (value: string) => {
    if (viewMode === 'calendar') {
      setCalendarPeriod(value as CalendarPeriod)
    } else {
      setProductsPeriod(value as ProductsPeriod)
    }
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-4">
            {/* Top row: Navigation + Period label */}
            <div className="flex items-center justify-between">
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

              {/* Actions */}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setExportModalOpen(true)}
                  title={t('export.button')}
                >
                  <Download className="h-4 w-4" />
                </Button>

                <Button asChild>
                  <Link href="/dashboard/reservations/new">
                    <Plus className="mr-2 h-4 w-4" />
                    {t('new')}
                  </Link>
                </Button>
              </div>
            </div>

            {/* Bottom row: View toggle (centered) + Filters */}
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
              {/* Left side: Period selector */}
              <Select value={currentPeriod} onValueChange={handlePeriodChange}>
                <SelectTrigger className="w-[160px]">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="week">
                    <div className="flex items-center gap-2">
                      {t('periods.week')}
                    </div>
                  </SelectItem>
                  {viewMode === 'products' && (
                    <SelectItem value="twoWeeks">
                      <div className="flex items-center gap-2">
                        {t('periods.twoWeeks')}
                      </div>
                    </SelectItem>
                  )}
                  <SelectItem value="month">
                    <div className="flex items-center gap-2">
                      {t('periods.month')}
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>

              {/* Center: View mode toggle */}
              <ViewModeToggle value={viewMode} onChange={setViewMode} />

              {/* Right side: Product filter */}
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
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main View */}
      {viewMode === 'calendar' && calendarPeriod === 'week' && (
        <WeekView
          reservations={filteredReservations}
          currentDate={currentDate}
          selectedProductId={selectedProductId}
        />
      )}

      {viewMode === 'calendar' && calendarPeriod === 'month' && (
        <MonthView
          reservations={filteredReservations}
          currentDate={currentDate}
          selectedProductId={selectedProductId}
        />
      )}

      {viewMode === 'products' && (
        <ProductsView
          reservations={reservations}
          products={displayProducts}
          config={productsConfig}
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
