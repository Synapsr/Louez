import {
  createMonthConfig,
  createTwoWeekConfig,
  getWeekEnd,
  getWeekStart,
} from './calendar-utils';
import type { CalendarViewMode } from './view-mode-toggle';

export const CALENDAR_VIEW_MODES = ['calendar', 'products'] as const;
export const CALENDAR_PERIODS = ['week', 'month'] as const;
export const PRODUCTS_PERIODS = ['week', 'twoWeeks', 'month'] as const;

export type CalendarPeriod = (typeof CALENDAR_PERIODS)[number];
export type ProductsPeriod = (typeof PRODUCTS_PERIODS)[number];

export interface CalendarQueryState {
  date: Date;
  view: CalendarViewMode;
  calendarPeriod: CalendarPeriod;
  productsPeriod: ProductsPeriod;
  productId: string;
}

export function toCalendarDateParam(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export function parseCalendarDateParam(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

export function getCalendarVisibleRange({
  date,
  view,
  calendarPeriod,
  productsPeriod,
}: Pick<
  CalendarQueryState,
  'date' | 'view' | 'calendarPeriod' | 'productsPeriod'
>) {
  const isMonthView =
    (view === 'calendar' && calendarPeriod === 'month') ||
    (view === 'products' && productsPeriod === 'month');

  if (isMonthView) {
    const config = createMonthConfig(date);
    return { start: config.startDate, end: config.endDate };
  }

  if (view === 'products' && productsPeriod === 'twoWeeks') {
    const config = createTwoWeekConfig(date);
    return { start: config.startDate, end: config.endDate };
  }

  return { start: getWeekStart(date), end: getWeekEnd(date) };
}

export function parseCalendarQueryState(
  searchParams: Record<string, string | string[] | undefined>,
  fallbackDate = new Date(),
): CalendarQueryState {
  const getParam = (key: string) => {
    const value = searchParams[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const date = parseCalendarDateParam(getParam('date')) ?? fallbackDate;
  const view = CALENDAR_VIEW_MODES.includes(
    getParam('view') as CalendarViewMode,
  )
    ? (getParam('view') as CalendarViewMode)
    : 'calendar';
  const calendarPeriod = CALENDAR_PERIODS.includes(
    getParam('calendarPeriod') as CalendarPeriod,
  )
    ? (getParam('calendarPeriod') as CalendarPeriod)
    : 'week';
  const productsPeriod = PRODUCTS_PERIODS.includes(
    getParam('productsPeriod') as ProductsPeriod,
  )
    ? (getParam('productsPeriod') as ProductsPeriod)
    : 'week';

  return {
    date,
    view,
    calendarPeriod,
    productsPeriod,
    productId: getParam('productId') || 'all',
  };
}
