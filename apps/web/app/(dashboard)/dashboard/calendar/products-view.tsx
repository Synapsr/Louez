'use client';

import { useMemo, useState } from 'react';
import type {
  KeyboardEvent,
  ReactNode,
  PointerEvent as ReactPointerEvent,
} from 'react';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  ScrollArea,
  ScrollBar,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@louez/ui';
import { cn } from '@louez/utils';

import {
  assignReservationsToSlots,
  generateDateRange,
  isSameDay,
} from './calendar-utils';
import type { ProductSlotGroup, SlotAssignment } from './calendar-utils';
import { ReservationBar } from './reservation-bar';
import type { Product, Reservation, TimelineConfig } from './types';

// =============================================================================
// Constants
// =============================================================================

const ROW_HEIGHT = 44;
const HEADER_HEIGHT = 52;
const PRODUCT_HEADER_HEIGHT = 44;
const DEFAULT_PRODUCT_COLUMN_WIDTH = 220;
const MIN_PRODUCT_COLUMN_WIDTH = 220;
const MAX_PRODUCT_COLUMN_WIDTH = 420;
const BAR_HEIGHT = 32;
const BAR_MARGIN_Y = 6;

// =============================================================================
// Types
// =============================================================================

interface ProductsViewProps {
  reservations: Reservation[];
  products: Product[];
  config: TimelineConfig;
}

// =============================================================================
// Component
// =============================================================================

export function ProductsView({
  reservations,
  products,
  config,
}: ProductsViewProps) {
  const t = useTranslations('dashboard.calendar');

  const [productColumnWidth, setProductColumnWidth] = useState(
    DEFAULT_PRODUCT_COLUMN_WIDTH,
  );

  // Track expanded state for each product
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(
    () => new Set(products.map((p) => p.id)),
  );

  // Generate dates for the visible range
  const dates = useMemo(
    () => generateDateRange(config.startDate, config.daysCount),
    [config.startDate, config.daysCount],
  );

  // Assign reservations to slots
  const productGroups = useMemo(
    () => assignReservationsToSlots(reservations, products, config),
    [reservations, products, config],
  );

  // Toggle product expansion
  const toggleProduct = (productId: string) => {
    setExpandedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  };

  // Day names (short)
  const getDayName = (date: Date): string => {
    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    return t(`dayNames.${dayNames[date.getDay()]}`);
  };

  // Calculate column width percentage
  const dayWidth = `${100 / config.daysCount}%`;

  const resizeProductColumn = (nextWidth: number) => {
    setProductColumnWidth(
      Math.min(
        MAX_PRODUCT_COLUMN_WIDTH,
        Math.max(MIN_PRODUCT_COLUMN_WIDTH, nextWidth),
      ),
    );
  };

  const handleProductColumnResizeStart = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = productColumnWidth;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handlePointerMove = (moveEvent: PointerEvent) => {
      resizeProductColumn(startWidth + moveEvent.clientX - startX);
    };

    const handlePointerUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
  };

  const handleProductColumnResizeKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
  ) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }

    event.preventDefault();
    resizeProductColumn(
      productColumnWidth + (event.key === 'ArrowRight' ? 20 : -20),
    );
  };

  const resizeHandle = (
    <button
      aria-label={t('productsView.resizeProductColumn')}
      aria-orientation="vertical"
      aria-valuemax={MAX_PRODUCT_COLUMN_WIDTH}
      aria-valuemin={MIN_PRODUCT_COLUMN_WIDTH}
      aria-valuenow={productColumnWidth}
      type="button"
      className="after:bg-border hover:after:bg-primary focus-visible:after:bg-primary absolute inset-y-0 right-0 z-20 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-2 after:right-0 after:w-px"
      role="separator"
      onKeyDown={handleProductColumnResizeKeyDown}
      onPointerDown={handleProductColumnResizeStart}
    />
  );

  return (
    <div className="bg-card overflow-hidden rounded-lg border">
      {/* Header with dates */}
      <div className="bg-card sticky top-0 z-20 flex border-b">
        {/* Product column header */}
        <div
          className="bg-muted/50 sticky left-0 z-30 flex shrink-0 items-center border-r px-4"
          style={{ width: productColumnWidth, height: HEADER_HEIGHT }}
        >
          <span className="text-muted-foreground text-sm font-medium">
            {t('productsView.products')}
          </span>
          {resizeHandle}
        </div>

        {/* Date columns */}
        <div className="flex flex-1">
          {dates.map((date, index) => {
            const isToday = isSameDay(date, new Date());
            const isWeekend = date.getDay() === 0 || date.getDay() === 6;

            return (
              <div
                key={index}
                className={cn(
                  'flex flex-col items-center justify-center border-r px-1 text-center last:border-r-0',
                  isWeekend && 'bg-muted/30',
                  isToday && 'bg-primary/10',
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
                        : 'text-muted-foreground',
                  )}
                >
                  {getDayName(date)}
                </span>
                <span
                  className={cn(
                    'mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold',
                    isToday && 'bg-primary text-primary-foreground',
                  )}
                >
                  {date.getDate()}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Products and slots */}
      <ScrollArea className="h-[420px] sm:h-[500px]">
        <div className="relative min-w-full">
          {productGroups.map((group) => (
            <ProductGroup
              key={group.product.id}
              group={group}
              dates={dates}
              isExpanded={expandedProducts.has(group.product.id)}
              onToggle={() => toggleProduct(group.product.id)}
              dayWidth={dayWidth}
              productColumnWidth={productColumnWidth}
              resizeHandle={resizeHandle}
            />
          ))}

          {/* Empty state */}
          {products.length === 0 && (
            <div className="text-muted-foreground flex h-40 items-center justify-center">
              {t('productsView.noProducts')}
            </div>
          )}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}

// =============================================================================
// ProductGroup Component
// =============================================================================

interface ProductGroupProps {
  group: ProductSlotGroup;
  dates: Date[];
  isExpanded: boolean;
  onToggle: () => void;
  dayWidth: string;
  productColumnWidth: number;
  resizeHandle: ReactNode;
}

function ProductGroup({
  group,
  dates,
  isExpanded,
  onToggle,
  dayWidth,
  productColumnWidth,
  resizeHandle,
}: ProductGroupProps) {
  const t = useTranslations('dashboard.calendar');
  const { product, totalUnits, slots, hasReservations } = group;

  // Find today's column index
  const todayIndex = dates.findIndex((d) => isSameDay(d, new Date()));

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      {/* Product header row */}
      <div className="bg-muted/20 flex border-b">
        <div
          className="bg-muted/30 sticky left-0 z-10 shrink-0 border-r"
          style={{ width: productColumnWidth, height: PRODUCT_HEADER_HEIGHT }}
        >
          <CollapsibleTrigger
            render={
              <button
                className={cn(
                  'flex h-full w-full items-center gap-2 px-4 text-left',
                  'hover:bg-muted/50 focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
                )}
              />
            }
          >
            {isExpanded ? (
              <ChevronDown className="text-muted-foreground h-4 w-4" />
            ) : (
              <ChevronRight className="text-muted-foreground h-4 w-4" />
            )}
            {/* <Package className="text-muted-foreground h-4 w-4" /> */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="min-w-0 flex-1 truncate text-sm font-medium" />
                }
              >
                {product.name}
              </TooltipTrigger>
              <TooltipContent side="right" className="px-2">
                {product.name}
              </TooltipContent>
            </Tooltip>
            <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
              {totalUnits}
            </span>
          </CollapsibleTrigger>
          {resizeHandle}
        </div>

        {/* Background grid for header */}
        <div
          className="relative flex-1"
          style={{ height: PRODUCT_HEADER_HEIGHT }}
        >
          <div className="absolute inset-0 flex">
            {dates.map((date, index) => {
              const isToday = isSameDay(date, new Date());
              const isWeekend = date.getDay() === 0 || date.getDay() === 6;

              return (
                <div
                  key={index}
                  className={cn(
                    'border-r last:border-r-0',
                    isWeekend && 'bg-muted/20',
                    isToday && 'bg-primary/5',
                  )}
                  style={{ width: dayWidth }}
                />
              );
            })}
          </div>

          {/* Reservation count badge */}
          {hasReservations && (
            <div className="absolute inset-0 flex items-center px-2">
              <span className="text-muted-foreground text-xs">
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
            productColumnWidth={productColumnWidth}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

// =============================================================================
// SlotRow Component
// =============================================================================

interface SlotRowProps {
  product: Product;
  slotIndex: number;
  assignments: SlotAssignment[];
  dates: Date[];
  todayIndex: number;
  dayWidth: string;
  productColumnWidth: number;
}

function SlotRow({
  product,
  slotIndex,
  assignments,
  dates,
  todayIndex,
  dayWidth,
  productColumnWidth,
}: SlotRowProps) {
  const t = useTranslations('dashboard.calendar');

  return (
    <div className="flex border-b last:border-b-0">
      {/* Slot label */}
      <div
        className="bg-card sticky left-0 z-10 flex shrink-0 items-center border-r pr-4 pl-10"
        style={{ width: productColumnWidth, height: ROW_HEIGHT }}
      >
        <span className="text-muted-foreground truncate text-sm">
          {product.quantity > 1 ? `#${slotIndex + 1}` : t('productsView.unit')}
        </span>
      </div>

      {/* Timeline grid with reservations */}
      <div className="relative flex-1" style={{ height: ROW_HEIGHT }}>
        {/* Background grid */}
        <div className="absolute inset-0 flex">
          {dates.map((date, index) => {
            const isToday = isSameDay(date, new Date());
            const isWeekend = date.getDay() === 0 || date.getDay() === 6;

            return (
              <div
                key={index}
                className={cn(
                  'border-r last:border-r-0',
                  isWeekend && 'bg-muted/10',
                  isToday && 'bg-primary/5',
                )}
                style={{ width: dayWidth }}
              />
            );
          })}
        </div>

        {/* Today indicator line */}
        {todayIndex >= 0 && (
          <div
            className="bg-primary/50 absolute top-0 bottom-0 z-10 w-0.5"
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
            <span className="text-muted-foreground/40 text-xs">
              {t('productsView.available')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
