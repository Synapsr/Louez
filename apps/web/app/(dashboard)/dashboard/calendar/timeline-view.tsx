'use client'

import { useMemo, useRef, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Package } from 'lucide-react'
import { cn, formatDateShort } from '@louez/utils'
import { ScrollArea, ScrollBar } from '@louez/ui'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@louez/ui'
import { ReservationBar } from './reservation-bar'
import {
  groupReservationsByProduct,
  calculateTimelinePosition,
  assignRowsToReservations,
  isSameDay,
  generateDateRange,
} from './calendar-utils'
import type {
  Reservation,
  Product,
  TimelineConfig,
  PositionedReservation,
} from './types'

// =============================================================================
// Constants
// =============================================================================

const ROW_HEIGHT = 40 // Height of each product row in pixels
const HEADER_HEIGHT = 48 // Height of the date header
const PRODUCT_COLUMN_WIDTH = 200 // Width of the product name column
const MIN_DAY_WIDTH = 80 // Minimum width per day column
const BAR_HEIGHT = 28 // Height of reservation bars
const BAR_GAP = 4 // Gap between stacked bars
const BAR_MARGIN_Y = 6 // Vertical margin in the row

// =============================================================================
// Types
// =============================================================================

interface TimelineViewProps {
  reservations: Reservation[]
  products: Product[]
  config: TimelineConfig
  selectedProductId?: string
}

// =============================================================================
// Component
// =============================================================================

export function TimelineView({
  reservations,
  products,
  config,
  selectedProductId,
}: TimelineViewProps) {
  const t = useTranslations('dashboard.calendar')
  const scrollRef = useRef<HTMLDivElement>(null)
  const [todayPosition, setTodayPosition] = useState<number | null>(null)

  // Filter products if a specific one is selected
  const displayProducts = useMemo(() => {
    if (selectedProductId && selectedProductId !== 'all') {
      return products.filter((p) => p.id === selectedProductId)
    }
    return products
  }, [products, selectedProductId])

  // Generate date range for the timeline
  const dates = useMemo(
    () => generateDateRange(config.startDate, config.daysCount),
    [config.startDate, config.daysCount]
  )

  // Group reservations by product
  const productRows = useMemo(
    () => groupReservationsByProduct(reservations, displayProducts),
    [reservations, displayProducts]
  )

  // Calculate positioned reservations for each product
  const positionedByProduct = useMemo(() => {
    const result = new Map<string, PositionedReservation[]>()

    productRows.forEach(({ product, reservations: productReservations }) => {
      const positioned = productReservations.map((r) =>
        calculateTimelinePosition(r, config)
      )
      const withRows = assignRowsToReservations(positioned)
      result.set(product.id, withRows)
    })

    return result
  }, [productRows, config])

  // Calculate maximum rows per product for proper height
  const maxRowsByProduct = useMemo(() => {
    const result = new Map<string, number>()
    positionedByProduct.forEach((positions, productId) => {
      const maxRow = positions.reduce((max, p) => Math.max(max, p.row), 0)
      result.set(productId, maxRow + 1)
    })
    return result
  }, [positionedByProduct])

  // Calculate today's position
  useEffect(() => {
    const today = new Date()
    const todayIndex = dates.findIndex((d) => isSameDay(d, today))
    if (todayIndex >= 0) {
      const position =
        PRODUCT_COLUMN_WIDTH +
        (todayIndex * (100 - (PRODUCT_COLUMN_WIDTH / window.innerWidth) * 100)) /
          config.daysCount
      setTodayPosition(todayIndex)
    } else {
      setTodayPosition(null)
    }
  }, [dates, config.daysCount])

  // Day width calculation
  const dayWidth = `${100 / config.daysCount}%`

  return (
    <div className="relative overflow-hidden rounded-lg border bg-card">
      {/* Sticky header with dates */}
      <div className="sticky top-0 z-20 flex border-b bg-card">
        {/* Product column header */}
        <div
          className="sticky left-0 z-30 flex shrink-0 items-center border-r bg-muted/50 px-4"
          style={{ width: PRODUCT_COLUMN_WIDTH, height: HEADER_HEIGHT }}
        >
          <span className="text-sm font-medium text-muted-foreground">
            {t('timeline.products')}
          </span>
        </div>

        {/* Date headers */}
        <div className="flex flex-1">
          {dates.map((date, index) => {
            const isToday = isSameDay(date, new Date())
            const isWeekend = date.getDay() === 0 || date.getDay() === 6

            return (
              <div
                key={index}
                className={cn(
                  'flex flex-col items-center justify-center border-r px-1 text-center last:border-r-0',
                  isWeekend && 'bg-muted/30',
                  isToday && 'bg-primary/10'
                )}
                style={{ width: dayWidth, height: HEADER_HEIGHT }}
              >
                <span
                  className={cn(
                    'text-xs font-medium',
                    isToday
                      ? 'text-primary'
                      : isWeekend
                        ? 'text-muted-foreground'
                        : 'text-foreground'
                  )}
                >
                  {t(`dayNames.${['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][date.getDay()]}`)}
                </span>
                <span
                  className={cn(
                    'text-sm font-semibold',
                    isToday && 'rounded-full bg-primary px-2 text-primary-foreground'
                  )}
                >
                  {date.getDate()}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Scrollable content area */}
      <ScrollArea className="h-[500px]">
        <div className="relative min-w-full">
          {/* Product rows */}
          {productRows.map(({ product, reservations: productReservations }) => {
            const positions = positionedByProduct.get(product.id) || []
            const maxRows = maxRowsByProduct.get(product.id) || 1
            const rowHeight = Math.max(
              ROW_HEIGHT,
              maxRows * (BAR_HEIGHT + BAR_GAP) + BAR_MARGIN_Y * 2
            )

            return (
              <div key={product.id} className="flex border-b last:border-b-0">
                {/* Product name (sticky) */}
                <div
                  className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r bg-card px-4"
                  style={{ width: PRODUCT_COLUMN_WIDTH, minHeight: rowHeight }}
                >
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="truncate text-sm font-medium">
                        {product.name}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      <div>
                        <div className="font-medium">{product.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {t('timeline.quantity', { count: product.quantity })}
                        </div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                  {productReservations.length > 0 && (
                    <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {productReservations.length}
                    </span>
                  )}
                </div>

                {/* Timeline grid with reservations */}
                <div className="relative flex-1" style={{ minHeight: rowHeight }}>
                  {/* Background grid */}
                  <div className="absolute inset-0 flex">
                    {dates.map((date, index) => {
                      const isToday = isSameDay(date, new Date())
                      const isWeekend = date.getDay() === 0 || date.getDay() === 6

                      return (
                        <div
                          key={index}
                          className={cn(
                            'border-r last:border-r-0',
                            isWeekend && 'bg-muted/20',
                            isToday && 'bg-primary/5'
                          )}
                          style={{ width: dayWidth }}
                        />
                      )
                    })}
                  </div>

                  {/* Today indicator line */}
                  {todayPosition !== null && (
                    <div
                      className="absolute top-0 bottom-0 z-10 w-0.5 bg-primary"
                      style={{
                        left: `calc(${(todayPosition / config.daysCount) * 100}% + ${100 / config.daysCount / 2}%)`,
                      }}
                    />
                  )}

                  {/* Reservation bars */}
                  {positions.map((positioned) => (
                    <ReservationBar
                      key={positioned.reservation.id}
                      reservation={positioned.reservation}
                      continuesBefore={positioned.continuesBefore}
                      continuesAfter={positioned.continuesAfter}
                      compact
                      className="absolute"
                      style={{
                        left: `${positioned.startPercent}%`,
                        width: `${positioned.widthPercent}%`,
                        top: BAR_MARGIN_Y + positioned.row * (BAR_HEIGHT + BAR_GAP),
                        height: BAR_HEIGHT,
                      }}
                    />
                  ))}

                  {/* Empty state */}
                  {positions.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-xs text-muted-foreground/50">
                        {t('timeline.available')}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {/* Empty state when no products */}
          {displayProducts.length === 0 && (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              {t('timeline.noProducts')}
            </div>
          )}
        </div>

        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  )
}
