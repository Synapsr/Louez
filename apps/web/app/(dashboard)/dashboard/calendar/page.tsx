import { redirect } from 'next/navigation';

import { and, eq, gte, lte, or } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { db } from '@louez/db';
import { products, reservations } from '@louez/db';

import { getCurrentStore } from '@/lib/store-context';

import {
  getCalendarVisibleRange,
  parseCalendarQueryState,
} from './calendar-query';
import { sortProductsByUsage } from './calendar-utils';
import { CalendarView } from './calendar-view';

async function getStoreData() {
  const store = await getCurrentStore();

  if (!store) {
    redirect('/onboarding');
  }

  return store;
}

async function getReservationsForPeriod(
  storeId: string,
  startDate: Date,
  endDate: Date,
) {
  // Get reservations that overlap with the period
  const storeReservations = await db.query.reservations.findMany({
    where: and(
      eq(reservations.storeId, storeId),
      or(
        // Reservation starts within the period
        and(
          gte(reservations.startDate, startDate),
          lte(reservations.startDate, endDate),
        ),
        // Reservation ends within the period
        and(
          gte(reservations.endDate, startDate),
          lte(reservations.endDate, endDate),
        ),
        // Reservation spans the entire period
        and(
          lte(reservations.startDate, startDate),
          gte(reservations.endDate, endDate),
        ),
      ),
    ),
    with: {
      customer: true,
      items: {
        with: {
          product: true,
        },
      },
    },
    orderBy: (reservations, { asc }) => [asc(reservations.startDate)],
  });

  return storeReservations;
}

async function getProducts(storeId: string) {
  // Only select columns needed for the calendar to avoid MySQL sort memory issues
  return db
    .select({
      id: products.id,
      name: products.name,
      quantity: products.quantity,
    })
    .from(products)
    .where(and(eq(products.storeId, storeId), eq(products.status, 'active')))
    .orderBy(products.name);
}

interface CalendarPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CalendarPage({
  searchParams,
}: CalendarPageProps) {
  const store = await getStoreData();
  const t = await getTranslations('dashboard.calendar');
  const params = await searchParams;

  const now = new Date();
  const initialState = parseCalendarQueryState(params, now);
  const visibleRange = getCalendarVisibleRange(initialState);

  const [storeReservations, storeProducts] = await Promise.all([
    getReservationsForPeriod(store.id, visibleRange.start, visibleRange.end),
    getProducts(store.id),
  ]);

  // Sort products by usage (products with active reservations today appear first)
  const sortedProducts = sortProductsByUsage(
    storeProducts,
    storeReservations,
    now,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
      </div>

      <CalendarView
        initialReservations={storeReservations}
        products={sortedProducts}
        storeId={store.id}
      />
    </div>
  );
}
