import { subDays } from "date-fns";

import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import type { Locale } from "@/i18n/config";
import type {
  MultiStoreMetrics,
  Period,
  StorePerformance,
  StorePlanLimit,
  StoreRevenueTrend,
} from "@/lib/dashboard/multi-store-metrics";
import { resolveFormatLocale } from "@/lib/i18n/format-locale";
import { getDemoProducts } from "@/lib/landing-demos/fixtures";
import { getDemoToday } from "@/lib/landing-demos/reservations";

export const DEMO_MULTI_STORES = [
  {
    id: "demo-store",
    name: "Maison du Vélo Nantes",
    slug: "maison-du-velo-nantes",
    logoUrl: null,
    role: "owner",
  },
  {
    id: "demo-store-reze",
    name: "Maison du Vélo Rezé",
    slug: "maison-du-velo-reze",
    logoUrl: null,
    role: "owner",
  },
  {
    id: "demo-store-pornic",
    name: "Maison du Vélo Pornic",
    slug: "maison-du-velo-pornic",
    logoUrl: null,
    role: "owner",
  },
] satisfies { id: string; name: string; slug: string; logoUrl: string | null; role: "owner" }[];

const PERIOD_DAYS: Record<Period, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "6m": 180,
  "12m": 365,
};

interface DemoMultiStoreData {
  metrics: MultiStoreMetrics;
  performance: StorePerformance[];
  data: StoreRevenueTrend[];
  storeNames: string[];
  limits: StorePlanLimit[];
}

/** All views use the same daily bike rentals, so table, legend and totals agree. */
export const createDemoMultiStoreData = (
  period: RentalPeriodValue,
  selectedPeriod: Period,
  locale: Locale,
): DemoMultiStoreData => {
  const today = getDemoToday(period);
  const days = PERIOD_DAYS[selectedPeriod];
  const prices = getDemoProducts(locale).map((product) => Number(product.price));
  const dateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const labelFormatter = new Intl.DateTimeFormat(resolveFormatLocale(locale).intl, {
    timeZone: "Europe/Paris",
    day: "numeric",
    month: "short",
  });
  const completedReservations = DEMO_MULTI_STORES.map(() => 0);
  const data = Array.from({ length: days }, (_, index): StoreRevenueTrend => {
    const date = subDays(today, days - index - 1);
    const day = Math.floor(date.getTime() / 86_400_000);
    const row: StoreRevenueTrend = {
      date: dateFormatter.format(date),
      label: labelFormatter.format(date),
    };
    for (const [storeIndex, store] of DEMO_MULTI_STORES.entries()) {
      const rentals = 7 - storeIndex * 2 + ((day + storeIndex) % 4);
      completedReservations[storeIndex] += rentals;
      row[store.name] = Array.from(
        { length: rentals },
        (_, rentalIndex) => prices[(day + rentalIndex) % prices.length],
      ).reduce((total, price) => total + price, 0);
    }
    return row;
  });
  let previousPeriodRevenue = 0;
  const performance = DEMO_MULTI_STORES.map((store, index): StorePerformance => {
    const revenue = data.reduce((total, row) => {
      const value = row[store.name];
      return total + (typeof value === "number" ? value : 0);
    }, 0);
    const previousRevenue = Math.round(revenue / (index === 2 ? 0.96 : 1.14 - index * 0.05));
    previousPeriodRevenue += previousRevenue;
    const pendingReservations = 6 - index * 2;
    return {
      storeId: store.id,
      storeName: store.name,
      storeSlug: store.slug,
      logoUrl: store.logoUrl,
      planSlug: "ultra",
      planName: "Ultra",
      revenue,
      revenueChange: ((revenue - previousRevenue) / previousRevenue) * 100,
      reservations: completedReservations[index] + pendingReservations,
      pendingReservations,
      customers: 1400 - index * 350,
    };
  });
  const totalRevenue = performance.reduce((total, store) => total + store.revenue, 0);
  return {
    metrics: {
      totalRevenue,
      previousPeriodRevenue,
      revenueGrowth: ((totalRevenue - previousPeriodRevenue) / previousPeriodRevenue) * 100,
      totalReservations: performance.reduce((total, store) => total + store.reservations, 0),
      pendingReservations: performance.reduce(
        (total, store) => total + store.pendingReservations,
        0,
      ),
      totalCustomers: performance.reduce((total, store) => total + store.customers, 0),
      newCustomers: Math.floor(
        completedReservations.reduce((total, count) => total + count, 0) / 4,
      ),
      storeCount: DEMO_MULTI_STORES.length,
    },
    performance,
    data,
    storeNames: DEMO_MULTI_STORES.map((store) => store.name),
    // All three stores have unlimited Ultra capacity, so the real alert stays hidden.
    limits: [],
  };
};
