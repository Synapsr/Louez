'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown, ChevronRight, Package } from 'lucide-react'
import { cn } from '@louez/utils'
import { ScrollArea, ScrollBar } from '@louez/ui'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@louez/ui'
import { ReservationBar } from './reservation-bar'
import {
  assignReservationsToSlots,
  getSlotLabel,
  generateDateRange,
  isSameDay,
} from './calendar-utils'
import type { Reservation, Product, TimelineConfig } from './types'
import type { ProductSlotGroup, SlotAssignment } from './calendar-utils'

// =============================================================================
// Constants
// =============================================================================

const ROW_HEIGHT = 44
const HEADER_HEIGHT = 52
const PRODUCT_HEADER_HEIGHT = 44
const PRODUCT_COLUMN_WIDTH = 220
const BAR_HEIGHT = 32
const BAR_MARGIN_Y = 6

// =============================================================================
// Types
// =============================================================================

interface ProductsViewProps {
  reservations: Reservation[]
  products: Product[]
  config: TimelineConfig
}

// =============================================================================
// Component
// =============================================================================

export function ProductsView({
  reservations,
  products,
  config,
}: ProductsViewProps) {
  const t = useTranslations('dashboard.calendar')

  // Track expanded state for each product
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(
    () => new Set(products.map((p) => p.id))
  )

  // Generate dates for the visible range
  const dates = useMemo(
    () => generateDateRange(config.startDate, config.daysCount),
    [config.startDate, config.daysCount]
  )

  // Assign reservations to slots
  const productGroups = useMemo(
    () => assignReservationsToSlots(reservations, products, config),
    [reservations, products, config]
  )

  // Toggle product expansion
  const toggleProduct = (productId: string) => {
    setExpandedProducts((prev) => {
      const next = new Set(prev)
      if (next.has(productId)) {
        next.delete(productId)
      } else {
        next.add(productId)
      }
      return next
    })
  }

  // Day names (short)
  const getDayName = (date: Date): string => {
    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
    return t(`dayNames.${dayNames[date.getDay()]}`)
  }

  // Calculate column width percentage
  const dayWidth = `${100 / config.daysCount}%`

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      {/* Header with dates */}
      <div className="sticky top-0 z-20 flex border-b bg-card">
        {/* Product column header */}
        <div
          className="sticky left-0 z-30 flex shrink-0 items-center border-r bg-muted/50 px-4"
          style={{ width: PRODUCT_COLUMN_WIDTH, height: HEADER_HEIGHT }}
        >
          <span className="text-sm font-medium text-muted-foreground">
            {t('productsView.products')}
          </span>
        </div>

        {/* Date columns */}
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
                    'text-xs font-medium uppercase',
                    isToday
                      ? 'text-primary'
                      : isWeekend
                        ? 'text-muted-foreground'
                        : 'text-muted-foreground'
                  )}
                >
                  {getDayName(date)}
                </span>
                <span
                  className={cn(
                    'mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold',
                    isToday && 'bg-primary text-primary-foreground'
                  )}
                >
                  {date.getDate()}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Products and slots */}
      <ScrollArea className="h-[500px]">
        <div className="relative min-w-full">
          {productGroups.map((group) => (
            <ProductGroup
              key={group.product.id}
              group={group}
              dates={dates}
              config={config}
              isExpanded={expandedProducts.has(group.product.id)}
              onToggle={() => toggleProduct(group.product.id)}
              dayWidth={dayWidth}
            />
          ))}

          {/* Empty state */}
          {products.length === 0 && (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              {t('productsView.noProducts')}
            </div>
          )}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  )
}

// =============================================================================
// ProductGroup Component
// =============================================================================

interface ProductGroupProps {
  group: ProductSlotGroup
  dates: Date[]
  config: TimelineConfig
  isExpanded: boolean
  onToggle: () => void
  dayWidth: string
}

function ProductGroup({
  group,
  dates,
  config,
  isExpanded,
  onToggle,
  dayWidth,
}: ProductGroupProps) {
  const t = useTranslations('dashboard.calendar')
  const { product, totalUnits, slots, hasReservations } = group

  // Find today's column index
  const todayIndex = dates.findIndex((d) => isSameDay(d, new Date()))

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      {/* Product header row */}
      <div className="flex border-b bg-muted/20">
        <CollapsibleTrigger render={<button
            className={cn(
              'sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r bg-muted/30 px-4 text-left',
              'hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'
            )}
            style={{ width: PRODUCT_COLUMN_WIDTH, height: PRODUCT_HEADER_HEIGHT }}
          />}>
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <Package className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1 truncate text-sm font-medium">
              {product.name}
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {t('productsView.units', { count: totalUnits })}
            </span>
          </button>
        </CollapsibleTrigger>

        {/* Background grid for header */}
        <div className="relative flex-1" style={{ height: PRODUCT_HEADER_HEIGHT }}>
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

          {/* Reservation count badge */}
          {hasReservations && (
            <div className="absolute inset-0 flex items-center px-2">
              <span className="text-xs text-muted-foreground">
                {t('productsView.reservationsCount', {
                  count: slots.flat().length,
                })}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Unit slots */}
      <CollapsibleContent>
        {Array.from({ length: totalUnits }).map((_, slotIndex) => (
          <SlotRow
            key={slotIndex}
            product={product}
            slotIndex={slotIndex}
            assignments={slots[slotIndex] || []}
            dates={dates}
            todayIndex={todayIndex}
            dayWidth={dayWidth}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

// =============================================================================
// SlotRow Component
// =============================================================================

interface SlotRowProps {
  product: Product
  slotIndex: number
  assignments: SlotAssignment[]
  dates: Date[]
  todayIndex: number
  dayWidth: string
}

function SlotRow({
  product,
  slotIndex,
  assignments,
  dates,
  todayIndex,
  dayWidth,
}: SlotRowProps) {
  const t = useTranslations('dashboard.calendar')
  const slotLabel = getSlotLabel(product, slotIndex)

  return (
    <div className="flex border-b last:border-b-0">
      {/* Slot label */}
      <div
        className="sticky left-0 z-10 flex shrink-0 items-center border-r bg-card pl-10 pr-4"
        style={{ width: PRODUCT_COLUMN_WIDTH, height: ROW_HEIGHT }}
      >
        <span className="truncate text-sm text-muted-foreground">
          {product.quantity > 1 ? `#${slotIndex + 1}` : t('productsView.unit')}
        </span>
      </div>

      {/* Timeline grid with reservations */}
      <div className="relative flex-1" style={{ height: ROW_HEIGHT }}>
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
                  isWeekend && 'bg-muted/10',
                  isToday && 'bg-primary/5'
                )}
                style={{ width: dayWidth }}
              />
            )
          })}
        </div>

        {/* Today indicator line */}
        {todayIndex >= 0 && (
          <div
            className="absolute top-0 bottom-0 z-10 w-0.5 bg-primary/50"
            style={{
              left: `calc(${(todayIndex / dates.length) * 100}% + ${100 / dates.length / 2}%)`,
            }}
          />
        )}

        {/* Reservation bars */}
        {assignments.map((assignment, idx) => (
          <ReservationBar
            key={`${assignment.reservation.id}-${idx}`}
            reservation={assignment.reservation}
            continuesBefore={assignment.continuesBefore}
            continuesAfter={assignment.continuesAfter}
            compact
            className="absolute"
            style={{
              left: `${assignment.startPercent}%`,
              width: `${assignment.widthPercent}%`,
              top: BAR_MARGIN_Y,
              height: BAR_HEIGHT,
            }}
          />
        ))}

        {/* Empty state indicator */}
        {assignments.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs text-muted-foreground/40">
              {t('productsView.available')}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
